import { resolve } from "node:path";
import type { PackageJson } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { Dependency } from "../../deps/types.js";
import type { EnvironmentSnapshot, EnvironmentSnapshotSource } from "../../environment/snapshot.js";
import { resolveLocalSources } from "../sources/local-sources.js";
import {
    overrideDependencies,
    type PackageManifestSnapshot,
    resolveLocalDeps,
    restorePackageManifest,
    snapshotPackageManifest,
    writeManifest,
} from "../sources/manifest-restore.js";
import type { InstallOptions, InstallOrchestratorDeps } from "../types.js";
import { detectFullReload, finalizeInstall } from "./install-reload.js";
import { beginInstallLog, recordSnapshotSafely } from "./install-reporting.js";
import { createInstallHistoryChanges, formatDeps, requiresPackageManager } from "./planner.js";
import { runPackageManager } from "./runner.js";

/** 安装执行器依赖面：宿主 deps + 环境快照记录回调（由 InstallOrchestrator 提供）。 */
export interface InstallExecutorDeps extends InstallOrchestratorDeps {
    recordEnvironmentSnapshot: (
        source: EnvironmentSnapshotSource,
        operationId?: string,
    ) => Promise<EnvironmentSnapshot>;
}

/** 安装执行器：串行锁内快照 → 来源校验 → 包管理器 → 回滚/刷新/重载（自 InstallOrchestrator 拆出）。 */
export class InstallExecutor {
    private readonly deps: InstallExecutorDeps;

    constructor(deps: InstallExecutorDeps) {
        this.deps = deps;
    }

    /** 安装主流程（旧 _installLocked）：快照 → 来源校验 → 包管理器 → 回滚/刷新/重载。 */
    async installLocked(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown | Promise<unknown>,
        options: InstallOptions = {},
    ): Promise<number> {
        options ||= {};
        const start = Date.now();
        const depCache = this.deps.resolver.getDeps({ background: false }) as Dict<Dependency>;
        return this.runInstallLocked(deps, forced, beforeReload, options, start, depCache);
    }

    /** 运行包管理器；失败时回滚清单并返回退出码。 */
    private async runPackageManagerPhase(
        deps: Dict<string>,
        snapshot: PackageManifestSnapshot,
        options: InstallOptions,
    ): Promise<number | undefined> {
        this.deps.logs.emit("stdout", "running package manager install…");
        const code = await this.installWithRegistry(options);
        if (!code) return;
        await restorePackageManifest(
            this.deps.cwd,
            snapshot,
            deps,
            `package manager exited with code ${code}`,
            this.deps.log,
        );
        await this.deps.resolver.reload();
        await this.deps.refreshChannels();
        return code;
    }

    /** 安装前准备：快照 → 本地依赖解析 → 历史变化 → 开始日志（含快照有效性校验）。 */
    private async prepareInstallRun(
        deps: Dict<string>,
        forced: boolean | undefined,
        options: InstallOptions,
    ): Promise<{ snapshot: PackageManifestSnapshot; localDeps: Dict<Dependency> }> {
        let snapshot: PackageManifestSnapshot | undefined;
        let snapshotError: unknown;
        try {
            snapshot = await snapshotPackageManifest(this.deps.cwd);
        } catch (error) {
            snapshotError = error;
        }
        const localDeps = resolveLocalDeps(deps, this.deps.cwd);
        const changes = snapshot
            ? createInstallHistoryChanges(snapshot.dependencies, deps, localDeps)
            : [];
        await recordSnapshotSafely(this.deps, "external");
        const validated = await beginInstallLog(
            this.deps,
            deps,
            forced,
            options,
            changes,
            localDeps,
            snapshot,
            snapshotError,
        );
        return { snapshot: validated, localDeps };
    }

    /** 安装成功收尾：刷新依赖状态 → 重载判定 → 前置钩子 → 环境快照与整帧重载。 */
    private async finalizeSuccessRun(
        deps: Dict<string>,
        localDeps: Dict<Dependency>,
        snapshot: PackageManifestSnapshot,
        beforeReload: (() => unknown | Promise<unknown>) | undefined,
        needsPackageManager: boolean,
        start: number,
    ) {
        await this.refreshDependencyState();
        const newDeps = this.deps.resolver.getDeps({
            background: false,
        }) as Dict<Dependency>;
        const shouldReload = detectFullReload(
            this.deps,
            localDeps,
            newDeps,
            snapshot.dependencies,
            deps,
        );
        if (beforeReload) {
            this.deps.log.debug("run pre-reload dependency hook");
            await beforeReload();
        }
        await this.deps.refreshChannels();
        await finalizeInstall(this.deps, deps, needsPackageManager, shouldReload, start);
    }

    /** 来源校验 + 清单覆盖（跑包管理器前的准备阶段）。 */
    private async prepareAndApplyChanges(
        deps: Dict<string>,
        forced: boolean | undefined,
        options: InstallOptions,
        depCache: Dict<Dependency>,
    ): Promise<{
        snapshot: PackageManifestSnapshot;
        localDeps: Dict<Dependency>;
        needsPackageManager: boolean;
    }> {
        const { snapshot, localDeps } = await this.prepareInstallRun(deps, forced, options);
        const needsPackageManager = requiresPackageManager(
            deps,
            localDeps,
            snapshot.dependencies,
            depCache,
            forced,
        );
        if (needsPackageManager) {
            await resolveLocalSources(this.deps, depCache, deps);
        }
        await this.applyOverride(snapshot.manifest, deps);
        this.deps.logs.emit(
            "stdout",
            "package.json dependencies updated, preparing package manager workflow…",
        );
        return { snapshot, localDeps, needsPackageManager };
    }

    private async runInstallLocked(
        deps: Dict<string>,
        forced: boolean | undefined,
        beforeReload: (() => unknown | Promise<unknown>) | undefined,
        options: InstallOptions,
        start: number,
        depCache: Dict<Dependency>,
    ): Promise<number> {
        let resultCode: number | undefined;
        let logResult: { code?: number | null; failed?: boolean; reason?: string } | undefined;
        try {
            const { snapshot, localDeps, needsPackageManager } = await this.prepareAndApplyChanges(
                deps,
                forced,
                options,
                depCache,
            );

            if (needsPackageManager) {
                const code = await this.runPackageManagerPhase(deps, snapshot, options);
                if (code !== undefined) {
                    resultCode = code;
                    logResult = { code };
                    return code;
                }
            }

            await this.finalizeSuccessRun(
                deps,
                localDeps,
                snapshot,
                beforeReload,
                needsPackageManager,
                start,
            );
            resultCode = 0;
            logResult = { code: 0 };
            return 0;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logResult = { code: resultCode ?? null, failed: true, reason };
            this.deps.logs.emit("stderr", `dependency operation failed: ${reason}`);
            throw error;
        } finally {
            await this.deps.logs.finish(logResult).catch((error) => {
                this.deps.log.warn(
                    `failed to finish dependency install log: ${error instanceof Error ? error.message : error}`,
                );
            });
        }
    }

    private async applyOverride(manifest: PackageJson, deps: Dict<string>) {
        const filename = resolve(this.deps.cwd, "package.json");
        this.deps.log.debug(
            `override package dependencies: file=${filename}, changes=${formatDeps(deps)}`,
        );
        overrideDependencies(manifest, deps);
        await writeManifest(this.deps.cwd, manifest);
        this.deps.log.info(
            `package dependencies updated: changes=${formatDeps(deps)}, total=${Object.keys(manifest.dependencies ?? {}).length}`,
        );
    }

    private installWithRegistry(options: InstallOptions) {
        options ||= {};
        const args: string[] = [];
        const endpoint =
            options.installEndpoint ||
            (this.deps.config.endpoint ? this.deps.registry.endpoint : "");
        if (endpoint) args.push("--registry", endpoint);
        return runPackageManager(args, {
            cwd: this.deps.cwd,
            agent: this.deps.agent,
            log: this.deps.log,
            emitLog: (type, line) => this.deps.logs.emit(type, line),
        });
    }

    /** 安装前的依赖状态全量重置（旧 refresh() 主流程）。 */
    async refreshDependencyState() {
        this.deps.scope.advance("dependency refresh superseded");
        await this.deps.registry.resetEndpoint();
        this.deps.clearRegistryStatus();
        this.deps.resolver.resetForRefresh();
    }
}

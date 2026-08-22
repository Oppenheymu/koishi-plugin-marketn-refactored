/**
 * @file 安装执行器(core/install/pipeline 域):installLocked 的流程本体。
 *
 * 完整流程:依赖缓存取数 → 快照 package.json → 本地依赖解析 → 是否需要
 * 包管理器判定 → 本地来源补齐 → 覆盖 package.json → 运行包管理器
 * (失败则回滚清单)→ 依赖状态重置 → 整帧重载判定 → 收尾(环境快照/日志)。
 *
 * 关键设计:
 * - 包管理器非零退出不抛异常而是返回退出码,同时回滚 package.json 到快照;
 * - 失败路径统一在 runInstallLocked 的 catch/finally 收口:
 *   异常上抛但安装日志(logs.finish)必定定稿;
 * - 环境快照经由编排器注入的 recordEnvironmentSnapshot 记录,
 *   "external"(操作前)与"operation"(操作后)各一次。
 *
 * 架构位置:自旧 InstallOrchestrator 拆出,由编排器在串行锁内调用;
 * 成块移植自旧 Installer 的 _installLocked,流程未改。
 */
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
        // 先取一份不加后台刷新的依赖缓存:后面 requiresPackageManager 判定以它为基准
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
        // code 为 0(falsy)时走到 undefined 返回值,表示"包管理器阶段成功"
        if (!code) return;
        // 非零退出:把 package.json 回滚到安装前快照,并重建依赖状态,原样返回退出码
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
            // 快照失败不在此时抛:先让 beginInstallLog 记录请求日志,再由它统一抛出
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
        // 重置后取新鲜依赖缓存,用于判定本地依赖版本是否真的发生了变化
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
            // 本地来源(file:/workspace)需要先补齐/校验,才能交给包管理器解析
            await resolveLocalSources(this.deps, depCache, deps);
        }
        await this.applyOverride(snapshot.manifest, deps);
        this.deps.logs.emit(
            "stdout",
            "package.json dependencies updated, preparing package manager workflow…",
        );
        return { snapshot, localDeps, needsPackageManager };
    }

    /**
     * 锁内安装的顶层流程:准备并覆盖清单 → (按需)跑包管理器 → 成功收尾;
     * 包管理器非零退出码直接返回,异常上抛;finally 里无论如何都定稿安装日志。
     */
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
                    // 非零退出:清单已回滚,直接把退出码交还调用方,不进成功收尾
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
            // 日志定稿失败只告警:不能让收尾失败掩盖安装本身的结果
            await this.deps.logs.finish(logResult).catch((error) => {
                this.deps.log.warn(
                    `failed to finish dependency install log: ${error instanceof Error ? error.message : error}`,
                );
            });
        }
    }

    /** 把目标依赖覆盖写进 package.json(空串请求 = 删除该依赖)。 */
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

    /** 计算并运行包管理器:优先本次安装的临时 endpoint,其次配置指定的 registry。 */
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
        // 先推进竞速失效域:让此前发出的旧 registry 请求全部作废
        this.deps.scope.advance("dependency refresh superseded");
        await this.deps.registry.resetEndpoint();
        this.deps.clearRegistryStatus();
        this.deps.resolver.resetForRefresh();
    }
}

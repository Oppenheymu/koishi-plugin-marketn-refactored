import { resolve } from "node:path";
import type { PackageJson } from "@koishijs/registry";
import type { Dict } from "koishi";
import {
    classifyDependencySource,
    findDependenciesNeedingSourceCheck,
    findUnboundLocalDependencies,
} from "../../shared/dependency-source.js";
import type { DependencyResolver } from "../deps/resolver.js";
import type { Dependency } from "../deps/types.js";
import { buildEnvironmentDependencies } from "../environment/apply.js";
import {
    createEnvironmentSnapshot,
    type EnvironmentSnapshot,
    type EnvironmentSnapshotSource,
    type EnvironmentSnapshotStore,
} from "../environment/snapshot.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { PackageCache } from "../registry/cache.js";
import type { RegistryClient } from "../registry/client.js";
import { SECOND } from "../utils/time.js";
import type { InstallLogStore } from "./logs/store.js";
import {
    overrideDependencies,
    type PackageManifestSnapshot,
    resolveLocalDeps,
    restorePackageManifest,
    snapshotPackageManifest,
    writeManifest,
} from "./manifest-restore.js";
import {
    createInstallHistoryChanges,
    formatDeps,
    formatLocalDeps,
    requiresPackageManager,
} from "./planner.js";
import type { InstallQueue } from "./queue.js";
import { type PackageManagerAgent, runPackageManager } from "./runner.js";
import type { InstallLogger, InstallOptions } from "./types.js";

const FULL_RELOAD_DELAY = SECOND;

export interface InstallOrchestratorConfig {
    endpoint?: string | undefined;
    timeout?: number | undefined;
}

export interface InstallOrchestratorDeps {
    cwd: string;
    log: InstallLogger;
    config: InstallOrchestratorConfig;
    scope: RequestScope;
    registry: RegistryClient;
    packages: PackageCache;
    resolver: DependencyResolver;
    environments: EnvironmentSnapshotStore;
    queue: InstallQueue;
    logs: InstallLogStore;
    agent: PackageManagerAgent | undefined;
    /** console.refresh ×4（dependencies/registry/registryStatus/packages） */
    refreshChannels: () => Promise<unknown>;
    /** console.refresh('dependencies') 单通道 */
    refreshDependenciesChannel: () => Promise<unknown> | undefined;
    clearRegistryStatus: () => void;
    fullReload: () => void;
    isActive: () => boolean;
    /** require.resolve(name) in require.cache 的等价判定（含解析失败 → true） */
    isPackageLoaded: (name: string) => boolean;
}

/** 安装编排：串行锁 + 快照/回滚 + 包管理器执行。环境快照读写在 EnvironmentSnapshotOps。 */
export class InstallOrchestrator {
    private readonly deps: InstallOrchestratorDeps;

    constructor(deps: InstallOrchestratorDeps) {
        this.deps = deps;
    }

    get isInstalling() {
        return this.deps.queue.isInstalling;
    }

    install(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown | Promise<unknown>,
        options: InstallOptions = {},
    ) {
        return this.deps.queue.withLock(`deps=${formatDeps(deps)}`, () =>
            this.installLocked(deps, forced, beforeReload, options),
        );
    }

    /** 安装前的依赖状态全量重置（旧 refresh() 主流程）。 */
    async refreshDependencyState() {
        this.deps.scope.advance("dependency refresh superseded");
        await this.deps.registry.resetEndpoint();
        this.deps.clearRegistryStatus();
        this.deps.resolver.resetForRefresh();
    }

    async captureCurrentEnvironmentSnapshot(
        source: EnvironmentSnapshotSource,
        operationId?: string,
    ): Promise<EnvironmentSnapshot> {
        const manifest = await snapshotPackageManifest(this.deps.cwd);
        const local = resolveLocalDeps(manifest.dependencies, this.deps.cwd);
        const dependencies = buildEnvironmentDependencies(manifest.dependencies, local);
        return createEnvironmentSnapshot(dependencies, source, operationId);
    }

    async recordCurrentEnvironmentSnapshot(
        source: EnvironmentSnapshotSource,
        operationId?: string,
    ) {
        const snapshot = await this.captureCurrentEnvironmentSnapshot(source, operationId);
        await this.deps.environments.record(snapshot);
        return snapshot;
    }

    /** 安装主流程（旧 _installLocked）：快照 → 来源校验 → 包管理器 → 回滚/刷新/重载。 */
    installLocked(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown | Promise<unknown>,
        options: InstallOptions = {},
    ): Promise<number> {
        options ||= {};
        const start = Date.now();
        let resultCode: number | undefined;
        let logResult: { code?: number | null; failed?: boolean; reason?: string } | undefined;
        let snapshot: PackageManifestSnapshot | undefined;
        let snapshotError: unknown;
        const depCache = this.deps.resolver.getDeps({ background: false }) as Dict<Dependency>;

        const run = async (): Promise<number> => {
            try {
                snapshot = await snapshotPackageManifest(this.deps.cwd);
            } catch (error) {
                snapshotError = error;
            }
            const localDeps = resolveLocalDeps(deps, this.deps.cwd);
            const changes = snapshot
                ? createInstallHistoryChanges(snapshot.dependencies, deps, localDeps)
                : [];
            await this.recordCurrentEnvironmentSnapshot("external").catch((error) => {
                this.deps.log.warn(
                    `failed to record pre-operation environment snapshot: ${error instanceof Error ? error.message : error}`,
                );
            });
            await this.deps.logs.start(deps, forced, options, changes).catch((error) => {
                this.deps.log.warn(
                    `failed to start dependency install log: ${error instanceof Error ? error.message : error}`,
                );
            });
            this.deps.log.info(
                `dependency install requested: deps=${formatDeps(deps)}, forced=${!!forced}, installEndpoint=${options.installEndpoint || "(default)"}`,
            );
            try {
                this.deps.logs.emit(
                    "stdout",
                    `dependency install requested: ${formatDeps(deps) || "(none)"}`,
                );
                if (options.installEndpoint) {
                    this.deps.logs.emit(
                        "stdout",
                        `using temporary npm registry: ${options.installEndpoint}`,
                    );
                }
                if (snapshotError) throw snapshotError;
                if (!snapshot)
                    throw new Error("failed to snapshot package.json before dependency operation");
                this.deps.log.debug(
                    `dependency install local state: ${formatLocalDeps(localDeps)}`,
                );
                const needsPackageManager = requiresPackageManager(
                    deps,
                    localDeps,
                    snapshot.dependencies,
                    depCache,
                    forced,
                );

                if (needsPackageManager) {
                    await this.resolveLocalSources(depCache, deps);
                }

                await this.applyOverride(snapshot.manifest, deps);
                this.deps.logs.emit(
                    "stdout",
                    "package.json dependencies updated, preparing package manager workflow…",
                );

                if (needsPackageManager) {
                    this.deps.logs.emit("stdout", "running package manager install…");
                    const code = await this.installWithRegistry(options);
                    if (code) {
                        resultCode = code;
                        logResult = { code };
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
                }

                await this.refreshDependencyState();
                const newDeps = this.deps.resolver.getDeps({
                    background: false,
                }) as Dict<Dependency>;
                let shouldReload = false;
                for (const name in localDeps) {
                    const resolved = localDeps[name]?.resolved;
                    if (!newDeps[name]) continue;
                    const requestChanged = snapshot.dependencies[name] !== deps[name];
                    const localRequestChanged =
                        requestChanged &&
                        classifyDependencySource(deps[name] ?? "", {
                            workspace: newDeps[name]?.workspace,
                            installed: !!newDeps[name]?.resolved,
                        }).local;
                    if (newDeps[name]?.resolved === resolved && !localRequestChanged) continue;
                    if (this.deps.isPackageLoaded(name)) shouldReload = true;
                    this.deps.log.debug(
                        `dependency changed may require full reload: ${name}, previous=${resolved ?? "-"}, current=${newDeps[name]?.resolved ?? "-"}`,
                    );
                }
                if (beforeReload) {
                    this.deps.log.debug("run pre-reload dependency hook");
                    await beforeReload();
                }
                await this.deps.refreshChannels();
                await this.recordCurrentEnvironmentSnapshot(
                    "operation",
                    this.deps.logs.activeMetadata?.id,
                ).catch((error) => {
                    this.deps.log.warn(
                        `failed to record dependency environment snapshot: ${error instanceof Error ? error.message : error}`,
                    );
                });
                this.deps.log.info(
                    `dependency install completed: deps=${formatDeps(deps)}, forced=${!!needsPackageManager}, fullReload=${shouldReload}, elapsed=${Date.now() - start}ms`,
                );
                if (shouldReload) {
                    this.deps.logs.emit(
                        "stdout",
                        `full reload scheduled in ${FULL_RELOAD_DELAY}ms`,
                    );
                    this.deps.log.info(
                        `dependency install triggers full reload after ${FULL_RELOAD_DELAY}ms`,
                    );
                    setTimeout(() => {
                        if (this.deps.isActive()) this.deps.fullReload();
                    }, FULL_RELOAD_DELAY);
                }
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
        };
        return run();
    }

    /** 跑包管理器前确认已安装插件来源（避免把本地插件误当 npm 包下载）。 */
    private async resolveLocalSources(depCache: Dict<Dependency>, deps: Dict<string>) {
        let sourceStateChanged = false;
        const completedSourceChecks = Object.keys(this.deps.packages.fullCache);
        const unresolved = findDependenciesNeedingSourceCheck(
            depCache,
            deps,
            completedSourceChecks,
        );
        if (unresolved.length) {
            this.deps.log.info(
                `resolve possible local plugin sources before package manager: ${unresolved.join(", ")}`,
            );
            const unresolvedErrors = await Promise.all(
                unresolved.map(async (name) => {
                    try {
                        const versions = await this.deps.packages.getPackage(name);
                        if (versions) return undefined;
                        if (this.deps.packages.isNotFoundCached(name)) {
                            sourceStateChanged =
                                this.deps.resolver.markRegistryNotFoundDependency(name) ||
                                sourceStateChanged;
                            return undefined;
                        }
                        return {
                            name,
                            error: Object.assign(
                                new Error("npm metadata check completed without a result"),
                                { marketNextReason: "unknown" },
                            ),
                        };
                    } catch (error) {
                        if (this.deps.registry.formatError(error).reason === "not-found") {
                            sourceStateChanged =
                                this.deps.resolver.markRegistryNotFoundDependency(name) ||
                                sourceStateChanged;
                            return undefined;
                        }
                        return { name, error };
                    }
                }),
            );
            const uncertain = unresolvedErrors.filter(
                (item): item is { name: string; error: unknown } => {
                    if (!item) return false;
                    return this.deps.registry.formatError(item.error).reason !== "not-found";
                },
            );
            if (sourceStateChanged) {
                await this.deps.refreshDependenciesChannel();
            }
            if (uncertain.length) {
                throw new Error(
                    `暂时无法确认以下已安装插件是否来自 npm：${uncertain.map((item) => item.name).join(", ")}。为避免包管理器误下载本地插件，本次操作已取消；请检查 npm 网络后重试。`,
                );
            }
        }
        const blockers = findUnboundLocalDependencies(depCache, deps);
        if (blockers.length) {
            throw new Error(
                `检测到来源未绑定的本地插件，继续安装会让包管理器尝试从 npm 下载它们：${blockers.join(", ")}。请先在“本地插件”分组中绑定来源或移除这些依赖。`,
            );
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
}

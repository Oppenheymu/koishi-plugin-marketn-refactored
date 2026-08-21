import type { Dict } from "koishi";
import { buildEnvironmentDependencies } from "../../environment/apply.js";
import {
    createEnvironmentSnapshot,
    type EnvironmentSnapshot,
    type EnvironmentSnapshotSource,
} from "../../environment/snapshot.js";
import { resolveLocalDeps, snapshotPackageManifest } from "../sources/manifest-restore.js";
import type { InstallOptions, InstallOrchestratorDeps } from "../types.js";
import { InstallExecutor, type InstallExecutorDeps } from "./install-executor.js";
import { formatDeps } from "./planner.js";

/** 安装编排：串行锁 + 快照/回滚 + 包管理器执行。环境快照读写在 EnvironmentSnapshotOps。 */
export class InstallOrchestrator {
    private readonly deps: InstallOrchestratorDeps;
    private readonly executor: InstallExecutor;

    constructor(deps: InstallOrchestratorDeps) {
        this.deps = deps;
        const executorDeps: InstallExecutorDeps = {
            ...deps,
            recordEnvironmentSnapshot: (source, operationId) =>
                this.recordCurrentEnvironmentSnapshot(source, operationId),
        };
        this.executor = new InstallExecutor(executorDeps);
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

    /** 安装主流程（旧 _installLocked）：快照 → 来源校验 → 包管理器 → 回滚/刷新/重载。 */
    installLocked(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown | Promise<unknown>,
        options: InstallOptions = {},
    ) {
        return this.executor.installLocked(deps, forced, beforeReload, options);
    }

    /** 安装前的依赖状态全量重置（旧 refresh() 主流程）。 */
    async refreshDependencyState() {
        await this.executor.refreshDependencyState();
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
}

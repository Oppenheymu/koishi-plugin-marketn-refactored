import type { DependencyResolver } from "../deps/resolver.js";
import type { EnvironmentSnapshotStore } from "../environment/snapshot.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { PackageCache } from "../registry/cache/index.js";
import type { RegistryClient } from "../registry/client/index.js";
import type { InstallLogStore } from "./logs/store.js";
import type { InstallQueue } from "./pipeline/queue.js";
import type { PackageManagerAgent } from "./pipeline/runner.js";

export interface InstallLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: unknown): void;
    error(message: unknown): void;
}

export interface InstallOptions {
    installEndpoint?: string | undefined;
}

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

export type InstallHistoryStatus = "running" | "success" | "error" | "unknown";

export interface InstallHistoryChange {
    name: string;
    beforeRequest: string | null;
    beforeResolved: string | null;
    afterRequest: string | null;
    afterResolved: string | null;
}

export interface InstallHistoryEntry {
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    duration?: number | undefined;
    status: InstallHistoryStatus;
    deps: string;
    forced: boolean;
    installEndpoint?: string | undefined;
    size: number;
    changes: InstallHistoryChange[];
}

export interface LocalBindingResult {
    request: string;
    filename: string;
    size: number;
}

export interface InstallLogDetail extends InstallHistoryEntry {
    content: string;
    truncated: boolean;
}

/** 安装日志的持久化元数据（.log.json）。 */
export interface InstallHistoryMetadata {
    version: 1;
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    status: InstallHistoryStatus;
    deps: string;
    forced: boolean;
    installEndpoint?: string | undefined;
    changes: InstallHistoryChange[];
}

import { resolve } from "node:path";
import type { Registry } from "@koishijs/registry";
import getRegistry from "get-registry";
import type { Context, Dict, Logger } from "koishi";
import { DependencyResolver } from "../../core/deps/resolver.js";
import type { Dependency } from "../../core/deps/types.js";
import { EnvironmentSnapshotStore } from "../../core/environment/snapshot.js";
import { EnvironmentSnapshotOps } from "../../core/install/environment.js";
import { getInstallLogRetention, InstallLogRetention } from "../../core/install/logs/retention.js";
import { InstallLogStore } from "../../core/install/logs/store.js";
import { InstallOrchestrator } from "../../core/install/pipeline/orchestrator.js";
import { InstallQueue } from "../../core/install/pipeline/queue.js";
import type { PackageManagerAgent } from "../../core/install/pipeline/runner.js";
import { LocalPackageUploadService } from "../../core/install/sources/upload.js";
import type { InstallLogger } from "../../core/install/types.js";
import { RequestScope } from "../../core/racing/request-scope.js";
import { RouteStatsBook } from "../../core/racing/stats.js";
import { PackageCache } from "../../core/registry/cache/index.js";
import type { RegistryStatsStore } from "../../core/registry/cache/stats-file.js";
import { RegistryClient } from "../../core/registry/client/index.js";
import { type RegistryReason, registryFailurePenalty } from "../../core/registry/errors.js";
import { LocalPackageUploadStore } from "../../core/upload/session.js";
import { JsonStore } from "../../core/utils/json-store.js";
import type { RegistryStatus } from "../../shared/types.js";
import { refreshConsole } from "../console/refresh.js";
import type { InstallerConfig } from "./config.js";

const REGISTRY_FAST_ROUTE_THRESHOLD = 800;

export function createInstallLogger(logger: Logger): InstallLogger {
    return {
        debug: (message) => logger.debug(message),
        info: (message) => logger.info(message),
        warn: (message) => logger.warn(message),
        error: (message) => logger.error(message),
    };
}

/** installer 构造期间 core 各入口类需要回掉的宿主面（由 Installer 提供）。 */
export interface InstallerWireOwner {
    log: InstallLogger;
    cwd: string;
    agent: PackageManagerAgent;
    setRegistryStatus(name: string, status: Partial<RegistryStatus>, serial: number): void;
    refreshData(): Promise<unknown>;
    clearRegistryStatus(): void;
    isPackageLoaded(name: string): boolean;
    /** 取出并清空待广播的 registry 状态增量（保持 tempRegistryStatus 单点归属）。 */
    drainRegistryStatus(): Dict<RegistryStatus>;
}

/** installer 构造组装出的 core 入口类集合。 */
export interface InstallerCore {
    scope: RequestScope;
    stats: RouteStatsBook;
    statsFile: JsonStore<RegistryStatsStore>;
    registry: RegistryClient;
    packages: PackageCache;
    resolver: DependencyResolver;
    environments: EnvironmentSnapshotStore;
    queue: InstallQueue;
    logs: InstallLogStore;
    orchestrator: InstallOrchestrator;
    envOps: EnvironmentSnapshotOps;
    retention: InstallLogRetention;
    uploads: LocalPackageUploadStore;
    uploadService: LocalPackageUploadService;
    flushRegistryStatus: () => void;
}

/** 组装 Installer 依赖的 core 入口类（保持构造顺序与共享引用不变）。 */
export function createInstallerCore(
    ctx: Context,
    config: InstallerConfig,
    owner: InstallerWireOwner,
): InstallerCore {
    const scope = new RequestScope({ isActive: () => ctx.scope.isActive });
    const stats = new RouteStatsBook({
        fastThreshold: REGISTRY_FAST_ROUTE_THRESHOLD,
        successClamp: [-6, 3],
        failureClamp: [-8, 3],
        failurePenalty: (options) =>
            Math.min(1.5, registryFailurePenalty(options.reason as RegistryReason | undefined)),
        cooldown: () => 0,
        roundAverage: true,
        trackFailureMeta: true,
    });
    const statsFile = new JsonStore<RegistryStatsStore>(
        resolve(ctx.baseDir, "cache", "market-next-registry-stats.json"),
        {
            isActive: () => ctx.scope.isActive,
            onError: (error) =>
                owner.log.debug(
                    `failed to write registry route stats: ${error instanceof Error ? error.message : error}`,
                ),
        },
    );

    const flushRegistryStatus = ctx.throttle(() => {
        const status = owner.drainRegistryStatus();
        void ctx.get("console")?.broadcast("market/registry-status", { ...status });
    }, 200);

    const registry = new RegistryClient(
        {
            httpFactory: (endpoint) => ({
                get: (path, cfg) =>
                    ctx.http
                        .extend({
                            endpoint,
                            ...(config.timeout === undefined ? {} : { timeout: config.timeout }),
                        })
                        .get(path, cfg) as Promise<Registry>,
            }),
            isHttpError: (error) => ctx.http.isError(error),
            stats,
            statsFile,
            scope,
            defaultEndpoint: async () => (await getRegistry()) ?? "https://registry.npmjs.org",
            statusSink: (name, status, serial) => owner.setRegistryStatus(name, status, serial),
            log: owner.log,
        },
        {
            endpoint: config.endpoint,
            timeout: config.timeout,
            autoRoute: config.autoRoute,
            retry: config.retry,
        },
    );

    const packages = new PackageCache({
        client: registry,
        scope,
        log: owner.log,
        onFlush: ctx.throttle(() => {
            void ctx.get("console")?.broadcast("market/registry", {
                ...packages.tempCache,
            });
            packages.tempCache = {};
        }, 500),
    });

    const resolver = new DependencyResolver({
        cwd: () => owner.cwd,
        cache: packages,
        scope,
        concurrency: () => config.concurrency,
        formatError: (error) => registry.formatError(error),
        ensureProbe: (name) => registry.ensureMetadataEndpoint(name, scope.current),
        log: owner.log,
        onMetadataRefreshed: () => void refreshConsole(ctx, ["dependencies"]),
    });

    const environments = new EnvironmentSnapshotStore(
        resolve(ctx.baseDir, "data", "market-next-environment-snapshots.json"),
        (message) => owner.log.warn(message),
    );

    const queue = new InstallQueue(owner.log);
    const retention = new InstallLogRetention(
        owner.cwd,
        () => getInstallLogRetention(config),
        owner.log,
    );

    const logs = new InstallLogStore({
        cwd: owner.cwd,
        log: owner.log,
        retention,
        broadcast: (type, line) =>
            void ctx.get("console")?.broadcast("market/install-log", { type, line }),
        resolveAfter: (name) =>
            (resolver.getDeps({ background: false }) as Dict<Dependency>)[name]?.resolved,
    });

    const orchestrator = new InstallOrchestrator({
        cwd: owner.cwd,
        log: owner.log,
        config: { endpoint: config.endpoint, timeout: config.timeout },
        scope,
        registry,
        packages,
        resolver,
        environments,
        queue,
        logs,
        agent: owner.agent,
        refreshChannels: () => owner.refreshData(),
        refreshDependenciesChannel: () => refreshConsole(ctx, ["dependencies"]),
        clearRegistryStatus: () => owner.clearRegistryStatus(),
        fullReload: () => ctx.loader.fullReload(),
        isActive: () => ctx.scope.isActive,
        isPackageLoaded: (name) => owner.isPackageLoaded(name),
    });

    const envOps = new EnvironmentSnapshotOps({
        log: owner.log,
        environments,
        queue,
        orchestrator,
    });

    const uploads = new LocalPackageUploadStore(ctx.baseDir, (message) => owner.log.warn(message));
    const uploadService = new LocalPackageUploadService({
        cwd: owner.cwd,
        log: owner.log,
        timeout: config.timeout,
        uploads,
        resolver,
    });

    return {
        scope,
        stats,
        statsFile,
        registry,
        packages,
        resolver,
        environments,
        queue,
        logs,
        orchestrator,
        envOps,
        retention,
        uploads,
        uploadService,
        flushRegistryStatus,
    };
}

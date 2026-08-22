/**
 * @file Installer 的 core 装配线:把 core 领域入口类组装进 koishi 上下文。
 *
 * 模块职责:
 * - createInstallerCore:按依赖顺序构造 core 全部入口类(RequestScope/
 *   RouteStatsBook/RegistryClient/PackageCache/DependencyResolver/安装编排
 *   器/环境快照/安装日志/本地上传等),并注入 koishi 侧的 I/O 适配
 *   (ctx.http、loader.fullReload、console broadcast 等);
 * - InstallerWireOwner:core 各入口类回写宿主(广播 registry 状态、触发
 *   刷新)时依赖的宿主面,由 Installer 类实现;
 * - createInstallLogger:把 koishi Logger 适配成 core 的 InstallLogger 接口。
 *
 * 关键设计:
 * - 这是 core 层"禁 koishi、构造注入 I/O"约定的落点:所有 ctx.* 调用
 *   集中在本文件,core 类只见回调与接口;
 * - 共享引用(scope/stats/cache 等)只构造一次、多处复用,保证竞速失效
 *   与缓存全局一致;
 * - 广播一律走 ctx.throttle 节流(registry-status 200ms / registry
 *   500ms),避免高频更新打爆 WebSocket。
 *
 * 架构位置:node 适配层 installer 模块,由 installer/index.ts 的 Installer
 * 构造函数调用一次。
 */
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

/** registry 请求耗时低于该阈值(ms)计为"快路由",参与路由竞速统计。 */
const REGISTRY_FAST_ROUTE_THRESHOLD = 800;

/** koishi Logger -> core InstallLogger 的窄接口适配(core 不 import koishi)。 */
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
    /** 竞速失效域:请求序号判定,新一轮刷新作废上一轮的迟到结果 */
    scope: RequestScope;
    /** registry 多端点路由竞速统计(内存) */
    stats: RouteStatsBook;
    /** 路由统计的磁盘持久化(cache/market-next-registry-stats.json) */
    statsFile: JsonStore<RegistryStatsStore>;
    /** registry HTTP 客户端(多端点竞速/重试/自动路由) */
    registry: RegistryClient;
    /** 包版本元数据缓存(含 404 负缓存) */
    packages: PackageCache;
    /** 宿主依赖快照与 latest 元数据刷新 */
    resolver: DependencyResolver;
    /** 环境快照存储(安装前后的 package.json 快照) */
    environments: EnvironmentSnapshotStore;
    /** 安装任务串行队列 */
    queue: InstallQueue;
    /** 安装日志存储与实时广播 */
    logs: InstallLogStore;
    /** 安装编排器(override 合并/执行/回滚的主流程) */
    orchestrator: InstallOrchestrator;
    /** 环境快照操作(预览/应用) */
    envOps: EnvironmentSnapshotOps;
    /** 安装日志保留策略(清理过期日志) */
    retention: InstallLogRetention;
    /** 本地 .tgz 上传会话存储 */
    uploads: LocalPackageUploadStore;
    /** 本地包上传服务(分块接收/预览/提交) */
    uploadService: LocalPackageUploadService;
    /** 节流后的 registry 状态广播(手动触发用) */
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
        // 成功加分/失败扣分都做钳制:单次结果不会让某端点权重失真
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

    // registry 状态广播节流 200ms:客户端只感知聚合后的结果,不逐请求推送
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
        // 缓存回填按 500ms 节流批量广播,而不是每个包一次
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

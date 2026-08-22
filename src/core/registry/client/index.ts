/**
 * @file npm registry 元数据客户端(core/registry/client 域)。
 *
 * RegistryClient 是 registry 域的门面:组合路由探测(RouteProbe,一个探针
 * 包竞速全部端点选出 metadataEndpoint)、多端点竞速拉取(route-fetch)、
 * 带重试的获取主循环(fetch)与端点评分(endpoints);路由学习统计经
 * statsFile 防抖持久化,重启后恢复。
 *
 * 关键设计:
 * - endpoint(主端点,配置/默认值)与 metadataEndpoint(探测胜出的实际
 *   端点)分离,resetEndpoint 时统一复位并重置路由统计;
 * - 失败记录只对值得惩罚的归因生效(shouldPenalizeRegistryRoute),
 *   避免 404 之类把镜像打进冷却;
 * - 状态变化经 statusSink 上报,携带 serial 供前端过滤过期状态。
 *
 * 架构位置:被 deps/resolver(元数据刷新)、registry/cache(包缓存)、
 * node 适配层(端点状态展示)消费;HTTP 通道经 httpFactory 注入。
 */
import type { RegistryStatus } from "../../../shared/types.js";
import type { RequestScope } from "../../racing/request-scope.js";
import { registryFallbackDelay, routeScore } from "../../racing/score.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { JsonStore } from "../../utils/json-store.js";
import {
    type RegistryStatsStore,
    restoreRegistryStats,
    serializeRegistryStats,
} from "../cache/stats-file.js";
import { formatRegistryError, type RegistryErrorDetail, type RegistryReason } from "../errors.js";
import type { Registry } from "../manifest.js";
import {
    installFallbackCandidate,
    preferredMetadataEndpoint,
    type RegistryClientConfig,
    registryRouteScores,
    sortRouteProbeEndpoints,
} from "./endpoints.js";
import { fetchRegistryWithRetry, type RegistryFetchHost } from "./fetch.js";
import { RouteProbe } from "./probe.js";
import {
    fetchRegistryByRoute,
    type RegistryHttpClient,
    type RegistryRouteDeps,
} from "./route-fetch.js";

/** "快端点"阈值:800ms 内返回视为快(评分与慢端点降级阈值)。 */
const FAST_ROUTE_THRESHOLD = 800;

export type { RegistryHttpClient };

/** RegistryClient 的构造注入面:HTTP 工厂、统计本、快照文件与状态通道。 */
export interface RegistryClientDeps {
    /** 按 endpoint 构造 HTTP 客户端(node 层注入,core 不依赖网络栈) */
    httpFactory: (endpoint: string) => RegistryHttpClient;
    /** 判定异常是否 HTTP 类(错误归因用) */
    isHttpError: (error: unknown) => boolean;
    /** 路由学习统计本 */
    stats: RouteStatsBook;
    /** 路由统计持久化文件(防抖写) */
    statsFile: JsonStore<RegistryStatsStore>;
    /** 竞速失效域 */
    scope: RequestScope;
    /** 配置未指定端点时的默认值来源(如宿主 npm 配置探测) */
    defaultEndpoint: () => Promise<string>;
    /** 包级状态上报(loading/错误/端点/次数,带 serial) */
    statusSink: (name: string, status: Partial<RegistryStatus>, serial: number) => void;
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
}

/**
 * npm registry 元数据客户端：多端点竞速 + 学习型路由 + 重试。
 * 成块移植自旧 Installer 的路由相关方法，算法未改。
 */
export class RegistryClient implements RegistryFetchHost {
    /** 主端点(配置值或默认值,resetEndpoint 时确定) */
    endpoint = "";
    /** 元数据实际端点(探测胜出后可能切换到的镜像) */
    metadataEndpoint = "";
    private readonly deps: RegistryClientDeps;
    private readonly probe: RouteProbe;
    private readonly routeDeps: RegistryRouteDeps;
    public config: RegistryClientConfig;

    constructor(deps: RegistryClientDeps, config: RegistryClientConfig = {}) {
        this.deps = deps;
        this.config = config;
        this.probe = new RouteProbe({
            scope: deps.scope,
            log: deps.log,
            scoresSummary: () => JSON.stringify(this.getRouteScores().map((item) => item.endpoint)),
        });
        // 把宿主方法适配为 route-fetch 所需的最小依赖面
        this.routeDeps = {
            httpFactory: deps.httpFactory,
            scope: deps.scope,
            log: deps.log,
            getFallbackDelay: (endpoint) => this.getFallbackDelay(endpoint),
            formatError: (error) => this.formatError(error),
            recordRouteSuccess: (result) => this.recordRouteSuccess(result),
            recordRouteFailure: (endpoint, reason) => this.recordRouteFailure(endpoint, reason),
        };
    }

    get scope() {
        return this.deps.scope;
    }

    /** 异常归因:接 registry/errors 的 formatRegistryError,产出 reason/error。 */
    formatError(error: unknown): RegistryErrorDetail {
        return formatRegistryError(error, this.deps.isHttpError);
    }

    /**
     * 重置端点:按配置(或默认值)恢复主端点与元数据端点,清空探测状态;
     * 端点真的变了才重置路由统计 —— 学习数据按端点集合有效性作废。
     */
    async resetEndpoint() {
        const endpoint = this.config.endpoint || (await this.deps.defaultEndpoint());
        const previous = this.endpoint;
        this.endpoint = endpoint;
        this.metadataEndpoint = endpoint;
        this.probe.reset();
        if (previous && previous !== endpoint) {
            this.deps.stats.reset();
            this.deps.log.info(
                `npm registry endpoint changed: previous=${previous}, current=${endpoint}, routeStats=reset`,
            );
        }
    }

    /** 从持久化文件恢复路由学习统计(启动时调用)。 */
    async restoreStats(store: RegistryStatsStore | undefined) {
        restoreRegistryStats(this.deps.stats, store, (message) => this.deps.log.debug(message));
    }

    /** 防抖写路由统计到 statsFile(每次成功/失败记录后调用)。 */
    scheduleStatsWrite() {
        this.deps.statsFile.schedule(() => ({
            version: 1,
            stats: serializeRegistryStats(this.deps.stats),
            savedAt: Date.now(),
        }));
    }

    /** 单端点评分:共享评分核心,主端点加分,快阈值 800ms。 */
    getRouteScore(endpoint: string) {
        return routeScore(this.deps.stats.get(endpoint), {
            isPrimary: endpoint === this.endpoint,
            fastThreshold: FAST_ROUTE_THRESHOLD,
        });
    }

    /** 端点的竞速错峰延迟(慢端点延迟启动,给快端点先手机会)。 */
    getFallbackDelay(endpoint: string) {
        return registryFallbackDelay(this.deps.stats.get(endpoint), FAST_ROUTE_THRESHOLD);
    }

    /** 安装失败后的备用源推荐(排除失败端点与用户配置端点)。 */
    getInstallFallbackCandidate(failedEndpoint?: string) {
        return installFallbackCandidate({
            config: this.config,
            endpoint: failedEndpoint || this.endpoint,
            stats: this.deps.stats,
            score: (item) => this.getRouteScore(item),
        });
    }

    /** 调试用路由评分表(端点/评分/统计明细)。 */
    getRouteScores() {
        return registryRouteScores({
            config: this.config,
            endpoint: this.endpoint,
            stats: this.deps.stats,
            score: (item) => this.getRouteScore(item),
            fallbackDelay: (item) =>
                item === this.endpoint ? this.getFallbackDelay(item) : undefined,
        });
    }

    private recordRouteSuccess(result: { endpoint: string; elapsed: number }) {
        this.deps.stats.recordSuccess(result.endpoint, result.elapsed);
        this.scheduleStatsWrite();
    }

    private recordRouteFailure(endpoint: string, reason?: RegistryReason) {
        this.deps.stats.recordFailure(endpoint, { reason });
        this.scheduleStatsWrite();
    }

    /**
     * 确保元数据路由已探测:候选端点按评分排序后交给 RouteProbe,
     * 一个探针包竞速选出后续默认走的 metadataEndpoint(单飞,一次生命周期一次)。
     */
    async ensureMetadataEndpoint(name: string, serial: number) {
        const endpoints = sortRouteProbeEndpoints(this.config, this.endpoint, (item) =>
            this.getRouteScore(item),
        );
        await this.probe.ensure(name, endpoints, serial, (n, e, s) => this.fetchByRoute(n, e, s));
    }

    /** 获取单个包的 registry 元数据(fetch.ts 的带重试主循环)。 */
    async getRegistry(
        name: string,
        serial = this.deps.scope.current,
    ): Promise<Registry | undefined> {
        return fetchRegistryWithRetry(name, serial, this);
    }

    get log() {
        return this.deps.log;
    }

    get statusSink() {
        return this.deps.statusSink;
    }

    get probeResult() {
        return this.probe.result;
    }

    setMetadataEndpoint(endpoint: string) {
        this.metadataEndpoint = endpoint;
    }

    /**
     * 重试轮次的端点顺序:首选端点(当前元数据端点降级判定后)+
     * 按评分排序的探测候选,去重保序。
     */
    retryEndpoints() {
        return [
            preferredMetadataEndpoint({
                endpoint: this.endpoint,
                metadataEndpoint: this.metadataEndpoint,
                stats: this.deps.stats,
                score: (item) => this.getRouteScore(item),
                log: this.deps.log,
            }),
            ...sortRouteProbeEndpoints(this.config, this.endpoint, (item) =>
                this.getRouteScore(item),
            ),
        ].filter(
            (endpoint, index, array): endpoint is string =>
                !!endpoint && array.indexOf(endpoint) === index,
        );
    }

    /** 多端点竞速拉取(route-fetch.ts,供 fetch 与 probe 共用)。 */
    fetchByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ) {
        return fetchRegistryByRoute(this.routeDeps, name, endpoints, serial, onAttempt);
    }
}

/**
 * @file 市场索引源主体(core/market/source 域)。
 *
 * MarketIndexSource 是市场数据的持有者与编排中枢:组合磁盘缓存
 * (MarketDiskCache)、索引扫描器(scanner)、竞速失效域(scope)与后台
 * 刷新器(MarketBackgroundRefresher);对外提供 start(刷新入口)、
 * collect(首拉/缓存优先)、applyIndex(应用索引)、getSnapshot(快照视图)。
 *
 * 关键设计:
 * - 大量字段是"跨文件共享状态":本类只声明与维护,编排逻辑分布在
 *   background.ts(后台刷新/探测)、collect.ts(collect 主流程)、
 *   host.ts(快照视图适配)等文件,通过结构性子集接口解耦;
 * - dataVersion 只在内容 hash 变化时递增(数据真的变了),revision 每次
 *   apply 都递增(展示层刷新依据),两者分工明确;
 * - start(refresh) 复用仍在跑的同 serial 后台任务,避免重复拉取。
 *
 * 架构位置:core/market 域核心,由 node 适配层实例化并暴露给
 * DataService;所有外部 I/O(http/广播/通知)经 MarketSourceDeps 注入。
 */
import type { SearchObject, SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance, MarketPerformanceSnapshot } from "../../../shared/types.js";
import { RequestScope } from "../../racing/request-scope.js";
import { createScanner, type ScannerLike } from "../../registry/manifest.js";
import { MarketDiskCache } from "../cache/index.js";
import { applyDiskCache, warmDiskCache as warmDiskCacheTask } from "../cache/warmup.js";
import { buildMarketSnapshot, type MarketSnapshotInput } from "../snapshot.js";
import { MarketBackgroundRefresher, type MarketBackgroundSource } from "./background.js";
import { collectMarketIndex, flushMarketPatch, type MarketCollectSource } from "./collect.js";
import {
    clearRouteCooldowns,
    getEndpointCandidates,
    type MarketScoreContext,
} from "./endpoints.js";
import { buildMarketFetchDeps, fetchMarketIndex } from "./fetch-index.js";
import { createSourceSnapshotHost, performanceFrom } from "./host.js";
import {
    createMarketRouteStatsBook,
    type MarketSourceConfig,
    type MarketSourceDeps,
} from "./types.js";

export type { MarketSourceConfig, MarketSourceDeps };

/**
 * 市场索引源：竞速拉取 + 磁盘缓存 + 后台刷新编排。
 * 成块移植自旧 node/MarketProvider（剥离 DataService 壳后的主体）。
 */
export class MarketIndexSource implements MarketBackgroundSource, MarketCollectSource {
    /** 竞速失效域:刷新/安装等事件推进序号使旧请求作废 */
    readonly scope = new RequestScope();
    /** 端点路由学习统计(与磁盘缓存共储) */
    readonly stats = createMarketRouteStatsBook();
    readonly cache: MarketDiskCache;
    readonly scanner: ScannerLike;
    readonly background: MarketBackgroundRefresher;
    /** 当前生效端点(胜出端点,可能与配置首选不同) */
    endpoint = "";

    /** 跨文件状态：background.ts 编排、source-host.ts 快照视图共用。 */
    backgroundTask: Promise<void> | undefined;
    backgroundSerial: number | undefined;
    collectError: unknown;
    warmDiskCacheTask: Promise<boolean> | undefined;
    /** 缓存预热/后台刷新产出的快照载荷(供 getSnapshot 直接返回) */
    payloadValue: MarketSnapshotInput | undefined;
    /** 磁盘缓存元数据是否已回放(cache-first 场景的 meta 来源) */
    cacheMetaPresent = false;
    /** 跨文件状态：collect.ts 的 collect 编排与补片广播共用。 */
    /** legacy 分析失败的包名列表 */
    failed: string[] = [];
    /** legacy 分析完成的全量对象缓存(包名 → SearchObject) */
    fullCache: Dict<SearchObject> = {};
    /** 待广播的分析补片(分析过程中增量累积,flush 后清空) */
    tempCache: Dict<SearchObject> = {};
    /** 性能调试信息(market debug 卡数据) */
    debugInfoValue: MarketPerformance | undefined;
    /** true 时 collect 跳过磁盘缓存直接走网络 */
    forceRefresh = false;

    /** 数据版本:内容 hash 变化才递增 */
    private dataVersion = 0;
    /** 展示层修订号:每次 applyIndex/补片广播都递增 */
    private revision = 0;
    /** 最近一次应用的内容 hash */
    private contentHash: string | undefined;
    private pendingRefreshTask: Promise<unknown> | undefined;
    /** 进行中的 collect 任务(单飞) */
    private collectTask: Promise<SearchResult | undefined> | undefined;
    readonly deps: MarketSourceDeps;
    readonly config: MarketSourceConfig;

    constructor(deps: MarketSourceDeps, config: MarketSourceConfig = {}) {
        this.deps = deps;
        this.config = config;
        this.config.endpoint ||= "https://registry.koishi.t4wefan.pub/index.json";
        this.endpoint = this.config.endpoint;
        this.scanner = createScanner(deps.scannerRequest);
        this.cache = new MarketDiskCache({
            cacheFile: deps.cacheFile,
            cacheDir: deps.cacheDir,
            stats: this.stats,
            scoreContext: () => this.scoreContext(),
            endpointCandidates: () => getEndpointCandidates(this.config),
            log: deps.log,
            // scope 已 dispose 视为宿主停用,缓存不再落盘
            isAlive: () => !this.scope.isDisposed,
        });
        this.background = new MarketBackgroundRefresher(this);
    }

    /** 组装路由评分上下文(配置 + 路由统计 + 缓存条目)。 */
    scoreContext(): MarketScoreContext {
        return { config: this.config, stats: this.stats, cacheEntries: this.cache.entries };
    }

    /** 是否已有可用数据(任一来源:快照载荷/scanner/fullCache)。 */
    hasCurrentData() {
        return (
            !!this.payloadValue ||
            !!this.scanner.version ||
            this.scanner.total > 0 ||
            Object.keys(this.fullCache).length > 0
        );
    }

    get log() {
        return this.deps.log;
    }

    notifyRefresh() {
        return this.deps.notifyRefresh();
    }

    /** 重置探测/刷新前的一次性状态（background.ts 调用）。 */
    resetProbeState() {
        this.failed = [];
        this.fullCache = {};
        this.tempCache = {};
        this.debugInfoValue = undefined;
        this.collectTask = undefined;
        this.collectError = undefined;
    }

    /** 预热磁盘缓存(透传 cache/warmup.ts,单飞 + 序号守卫)。 */
    async warmDiskCache(reason: string) {
        return warmDiskCacheTask(this, reason);
    }

    /**
     * 应用一份索引到内存:过滤 ignored 条目、更新 scanner 统计,
     * 并按内容 hash 是否变化决定是否递增 dataVersion(展示层用
     * 它判断"数据真的更新了"),revision 无条件递增。
     */
    applyIndex(result: SearchResult, endpoint: string, contentHash?: string) {
        if (!Array.isArray(result?.objects)) {
            throw new Error(`invalid market index from ${endpoint}`);
        }
        this.endpoint = endpoint;
        const ignored = result.objects.filter((object) => object.ignored).length;
        this.scanner.objects = result.objects.filter((object) => !object.ignored);
        this.scanner.total = this.scanner.objects.length;
        this.scanner.version = result.version === undefined ? undefined : String(result.version);
        if (!contentHash || contentHash !== this.contentHash) this.dataVersion++;
        this.revision++;
        this.contentHash = contentHash;
        this.deps.log.debug(
            `market index applied: endpoint=${endpoint}, version=${result.version ?? "legacy"}, rawObjects=${result.objects.length}, ignored=${ignored}, visible=${this.scanner.total}`,
        );
    }

    /** 竞速拉取并落盘（collect 的网络部分）。 */
    async fetchAndApply(serial: number, phase: "initial" | "refresh") {
        const start = Date.now();
        const result = await fetchMarketIndex(
            buildMarketFetchDeps(this, this.deps) as never,
            serial,
        );
        // 竞速期间序号被推进:结果作废,不应用不落盘
        if (this.scope.isStale(serial)) return undefined;
        const applyStart = Date.now();
        this.applyIndex(result.result, result.endpoint, result.hash);
        result.timings["apply"] = Date.now() - applyStart;
        result.timings["total"] = Date.now() - start;
        this.cache.updateState(result);
        // disk-cache 来源说明数据本来就来自缓存,不必再写回磁盘
        if (result.source !== "disk-cache")
            this.cache.scheduleWrite(result.result, this.cache.meta);
        this.cacheMetaPresent = false;
        this.collectError = undefined;
        // refresh 阶段拿到新数据后清掉旧快照载荷,强制下次 getSnapshot 重建
        if (phase === "refresh") this.payloadValue = undefined;
        this.updateDebugInfo(performanceFrom(result, this.scanner.total), "refresh");
        return result;
    }

    /** 旧版 collect：磁盘缓存优先，否则网络（主体在 collect.ts）。 */
    async collect(): Promise<undefined> {
        return collectMarketIndex(this);
    }

    /** 手动/自动刷新入口（旧 start 主流程）。 */
    async start(refresh: boolean) {
        // 同 serial 的后台任务仍在跑:直接复用它的序号,不重复推进/拉取
        const reuseBackground =
            refresh && !!this.backgroundTask && this.backgroundSerial === this.scope.current;
        const serial = reuseBackground ? this.scope.current : this.scope.current + 1;
        if (!reuseBackground) this.scope.advance("market refresh superseded");
        this.forceRefresh = false;
        if (refresh) {
            // 手动刷新清空所有端点冷却,给每个镜像公平的重新竞争机会
            clearRouteCooldowns(this.stats);
            if (this.hasCurrentData() || (await applyDiskCache(this, serial))) {
                if (!this.scope.isStale(serial)) {
                    // 已有数据或缓存回放成功:先上屏,刷新交给后台
                    if (!this.hasCurrentData())
                        this.background.refreshInBackground(serial, "soft refresh");
                    void this.deps.notifyRefresh();
                }
                return;
            }
            this.collectTask = undefined;
            this.collectError = undefined;
        }
        this.collectTask = this.collect();
        await this.collectTask;
        // legacy 分析产生的补片在 collect 结束后统一广播一次
        flushMarketPatch(this);
        if (!this.scope.isStale(serial)) {
            void this.deps.notifyRefresh();
        }
    }

    /** 构建当前状态快照(经 host.ts 适配后交给 shared 的快照组装)。 */
    getSnapshot() {
        return buildMarketSnapshot(createSourceSnapshotHost(this));
    }

    /** 惰性启动 collect(单飞):失败记录到 collectError 并允许重试。 */
    prepareTask(): Promise<SearchResult | undefined> {
        this.collectTask ??= this.collect().catch((error: unknown) => {
            this.collectError = error;
            this.collectTask = undefined;
            return undefined;
        });
        return this.collectTask;
    }

    get error() {
        return this.collectError;
    }

    get dataVersionValue() {
        return this.dataVersion;
    }

    get revisionValue() {
        return this.revision;
    }

    /** 递增并返回修订号(补片广播时使用)。 */
    nextRevision() {
        return ++this.revision;
    }

    /** 合并更新性能调试信息:timings 按阶段浅合并,phase 归档快照。 */
    updateDebugInfo(info: MarketPerformanceSnapshot, phase?: "initial" | "refresh") {
        const next: MarketPerformance = {
            ...this.debugInfoValue,
            ...info,
            timings: { ...this.debugInfoValue?.timings, ...info.timings },
        };
        if (phase) next[phase] = { ...info };
        this.debugInfoValue = next;
    }

    /** logLevel=debug 时才对外暴露 debug 信息。 */
    exportedDebug(timings?: Dict<number>): MarketPerformance | undefined {
        if (this.config.logLevel !== "debug") return undefined;
        if (!timings) return this.debugInfoValue;
        return { ...this.debugInfoValue, timings: { ...this.debugInfoValue?.timings, ...timings } };
    }

    failedCount() {
        return this.failed.length;
    }

    /**
     * 登记一个"完成后需要触发刷新"的任务(去重:同一任务只登记一次),
     * 结束后通知前端刷新。
     */
    scheduleRefreshAfterPrepare(task: Promise<unknown>) {
        if (this.pendingRefreshTask === task) return;
        this.pendingRefreshTask = task;
        void task.finally(() => {
            if (this.pendingRefreshTask === task) this.pendingRefreshTask = undefined;
            void this.deps.notifyRefresh();
        });
    }

    /** 空闲探测入口(透传 background.ts)。 */
    probeInBackground(reason = "idle probe") {
        return this.background.probeInBackground(reason);
    }
}

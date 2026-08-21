import type { SearchObject, SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance, MarketPerformanceSnapshot } from "../../../shared/types.js";
import { RequestScope } from "../../racing/request-scope.js";
import { createScanner, type ScannerLike } from "../../registry/manifest.js";
import { MarketDiskCache } from "../cache/index.js";
import { applyDiskCache, warmDiskCache as warmDiskCacheTask } from "../cache/warmup.js";
import { buildMarketSnapshot, type MarketSnapshotInput } from "../snapshot.js";
import { MarketBackgroundRefresher, type MarketBackgroundSource } from "./background.js";
import { collectMarketIndex, flushMarketPatch } from "./collect.js";
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
export class MarketIndexSource implements MarketBackgroundSource {
    readonly scope = new RequestScope();
    readonly stats = createMarketRouteStatsBook();
    readonly cache: MarketDiskCache;
    readonly scanner: ScannerLike;
    readonly background: MarketBackgroundRefresher;
    endpoint = "";

    /** 跨文件状态：background.ts 编排、source-host.ts 快照视图共用。 */
    backgroundTask: Promise<void> | undefined;
    backgroundSerial: number | undefined;
    collectError: unknown;
    warmDiskCacheTask: Promise<boolean> | undefined;
    payloadValue: MarketSnapshotInput | undefined;
    cacheMetaPresent = false;
    /** 跨文件状态：collect.ts 的 collect 编排与补片广播共用。 */
    failed: string[] = [];
    fullCache: Dict<SearchObject> = {};
    tempCache: Dict<SearchObject> = {};
    debugInfoValue: MarketPerformance | undefined;
    forceRefresh = false;

    private dataVersion = 0;
    private revision = 0;
    private contentHash: string | undefined;
    private pendingRefreshTask: Promise<unknown> | undefined;
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
            isAlive: () => !this.scope.isDisposed,
        });
        this.background = new MarketBackgroundRefresher(this);
    }

    scoreContext(): MarketScoreContext {
        return { config: this.config, stats: this.stats, cacheEntries: this.cache.entries };
    }

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

    async warmDiskCache(reason: string) {
        return warmDiskCacheTask(this, reason);
    }

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
        if (this.scope.isStale(serial)) return undefined;
        const applyStart = Date.now();
        this.applyIndex(result.result, result.endpoint, result.hash);
        result.timings["apply"] = Date.now() - applyStart;
        result.timings["total"] = Date.now() - start;
        this.cache.updateState(result);
        if (result.source !== "disk-cache")
            this.cache.scheduleWrite(result.result, this.cache.meta);
        this.cacheMetaPresent = false;
        this.collectError = undefined;
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
        const reuseBackground =
            refresh && !!this.backgroundTask && this.backgroundSerial === this.scope.current;
        const serial = reuseBackground ? this.scope.current : this.scope.current + 1;
        if (!reuseBackground) this.scope.advance("market refresh superseded");
        this.forceRefresh = false;
        if (refresh) {
            clearRouteCooldowns(this.stats);
            if (this.hasCurrentData() || (await applyDiskCache(this, serial))) {
                if (!this.scope.isStale(serial)) {
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
        flushMarketPatch(this);
        if (!this.scope.isStale(serial)) {
            void this.deps.notifyRefresh();
        }
    }

    getSnapshot() {
        return buildMarketSnapshot(createSourceSnapshotHost(this));
    }

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

    nextRevision() {
        return ++this.revision;
    }

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

    scheduleRefreshAfterPrepare(task: Promise<unknown>) {
        if (this.pendingRefreshTask === task) return;
        this.pendingRefreshTask = task;
        void task.finally(() => {
            if (this.pendingRefreshTask === task) this.pendingRefreshTask = undefined;
            void this.deps.notifyRefresh();
        });
    }

    probeInBackground(reason = "idle probe") {
        return this.background.probeInBackground(reason);
    }
}

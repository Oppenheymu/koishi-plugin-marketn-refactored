import type { SearchObject, SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance, MarketPerformanceSnapshot } from "../../shared/types.js";
import { RequestScope } from "../racing/request-scope.js";
import { RouteStatsBook } from "../racing/stats.js";
import { createScanner, type ScannerLike } from "../registry/manifest.js";
import { formatError, shortHash } from "../utils/format.js";
import { MarketBackgroundRefresher } from "./background.js";
import { MarketDiskCache } from "./cache-store.js";
import {
    clearRouteCooldowns,
    getEndpointCandidates,
    type MarketScoreContext,
} from "./endpoints.js";
import { fetchMarketIndex } from "./fetch-index.js";
import { formatSnapshot } from "./format.js";
import { buildMarketSnapshot, type MarketSnapshotInput } from "./snapshot.js";
import { createSourceSnapshotHost, performanceFrom } from "./source-host.js";

export interface MarketSourceConfig {
    endpoint?: string | undefined;
    timeout?: number | undefined;
    autoRoute?: boolean | undefined;
    logLevel?: string | undefined;
}

export interface MarketSourceDeps {
    /** koishi HTTP 适配（按端点创建） */
    http: (endpoint: string) => { getText: never } | never;
    scannerRequest: (url: string, config?: { timeout?: number }) => Promise<unknown>;
    cacheFile: string;
    cacheDir: string;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
    /** console.refresh('market') 等价物 */
    notifyRefresh: () => Promise<unknown> | unknown;
    /** market/patch 广播（节流在适配层） */
    broadcastPatch: (payload: {
        data: Dict<SearchObject>;
        total: number;
        progress: number;
        failed: number;
        debug?: MarketPerformance | undefined;
    }) => void;
    /** legacy 分析阶段把 registry 版本喂回 installer.setPackage */
    onRegistryVersions: (name: string, versions: unknown[]) => void;
}

/**
 * 市场索引源：竞速拉取 + 磁盘缓存 + 后台刷新编排。
 * 成块移植自旧 node/MarketProvider（剥离 DataService 壳后的主体）。
 */
export class MarketIndexSource {
    readonly scope = new RequestScope();
    readonly stats = new RouteStatsBook({
        fastThreshold: 500,
        successClamp: [-6, 3],
        failureClamp: [-10, 3],
        failurePenalty: (options) => (options.rescue ? 0.25 : 1.2),
        cooldown: (failures) =>
            failures <= 0
                ? 0
                : failures === 1
                  ? 60_000
                  : failures === 2
                    ? 300_000
                    : failures === 3
                      ? 1_800_000
                      : failures === 4
                        ? 14_400_000
                        : 43_200_000,
        roundAverage: false,
        trackFailureMeta: false,
    });
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

    private failed: string[] = [];
    private fullCache: Dict<SearchObject> = {};
    private tempCache: Dict<SearchObject> = {};
    private dataVersion = 0;
    private contentHash: string | undefined;
    private forceRefresh = false;
    private debugInfoValue: MarketPerformance | undefined;
    private pendingRefreshTask: Promise<unknown> | undefined;
    private collectTask: Promise<SearchResult | undefined> | undefined;
    private readonly deps: MarketSourceDeps;
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
        if (this.warmDiskCacheTask) return this.warmDiskCacheTask;
        const serial = this.scope.current;
        this.warmDiskCacheTask = this.applyDiskCache(serial)
            .then((loaded) => {
                if (loaded) {
                    void this.deps.notifyRefresh();
                }
                return loaded;
            })
            .finally(() => {
                this.warmDiskCacheTask = undefined;
            });
        void reason;
        return this.warmDiskCacheTask;
    }

    private async applyDiskCache(serial: number) {
        const warmTask = this.warmDiskCacheTask;
        if (warmTask) {
            const warmed = await warmTask;
            if (warmed && !this.scope.isStale(serial)) return true;
        }
        const { applied } = await this.cache.load();
        if (!applied) return false;
        if (this.scope.isStale(serial)) return false;
        this.applyIndex(applied.result, applied.endpoint, applied.hash);
        this.cacheMetaPresent = true;
        this.updateDebugInfo(
            {
                source: "disk-cache",
                endpoint: applied.endpoint,
                objects: this.scanner.total,
                hash: shortHash(applied.hash),
                cachedAt: applied.fetchedAt,
                timings: {},
            },
            "initial",
        );
        return true;
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
        this.contentHash = contentHash;
        this.deps.log.debug(
            `market index applied: endpoint=${endpoint}, version=${result.version ?? "legacy"}, rawObjects=${result.objects.length}, ignored=${ignored}, visible=${this.scanner.total}`,
        );
    }

    private fetchDeps() {
        return {
            http: this.deps.http as never,
            scope: this.scope,
            stats: this.stats,
            scoreContext: () => this.scoreContext(),
            config: this.config,
            onEndpointSelected: (endpoint: string) => {
                this.endpoint = endpoint;
            },
            getCachedEntry: (endpoint: string) => this.cache.entries[endpoint],
            loadCacheEntryResult: (entry: never) => this.cache.loadEntryResult(entry),
            conditionalHeaders: (endpoint: string) => this.cache.conditionalHeaders(endpoint),
            log: this.deps.log,
        };
    }

    /** 竞速拉取并落盘（collect 的网络部分）。 */
    async fetchAndApply(serial: number, phase: "initial" | "refresh") {
        const start = Date.now();
        const result = await fetchMarketIndex(this.fetchDeps() as never, serial);
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

    /** 旧版 collect：磁盘缓存优先，否则网络；legacy 索引补分析。 */
    async collect(): Promise<undefined> {
        const serial = this.scope.current;
        const start = Date.now();
        this.failed = [];
        this.fullCache = {};
        this.tempCache = {};
        if (!this.forceRefresh && (await this.applyDiskCache(serial))) {
            this.background.refreshInBackground(serial, "cache-first");
            void this.deps.notifyRefresh();
            return undefined;
        }
        const result = await this.fetchAndApply(serial, "initial");
        if (this.scope.isStale(serial) || !result) return undefined;
        this.updateDebugInfo(performanceFrom(result, this.scanner.total), "initial");
        if (!this.scanner.version) {
            await this.analyzeLegacy();
        }
        this.deps.log.info(
            `market index ready: ${formatSnapshot(performanceFrom(result, this.scanner.total))}, elapsed=${Date.now() - start}ms`,
        );
        return undefined;
    }

    private async analyzeLegacy() {
        const analyzeStart = Date.now();
        await this.scanner.analyze({
            version: "4",
            onFailure: (name: string, reason: unknown) => {
                this.failed.push(name);
                this.deps.log.debug(`failed to analyze package ${name}: ${formatError(reason)}`);
            },
            onRegistry: (registry: { name: string }, versions: unknown[]) => {
                this.deps.onRegistryVersions(registry.name, versions);
            },
            onSuccess: (object: SearchObject) => {
                this.fullCache[object.package.name] = this.tempCache[object.package.name] = object;
            },
            after: () => this.flushPatch(),
        });
        this.deps.log.debug(
            `legacy analyze completed: success=${Object.keys(this.fullCache).length}, failed=${this.failed.length}, elapsed=${Date.now() - analyzeStart}ms`,
        );
    }

    flushPatch() {
        if (!Object.keys(this.tempCache).length) return;
        this.deps.broadcastPatch({
            data: this.tempCache,
            failed: this.failed.length,
            total: this.scanner.total,
            progress: this.scanner.progress,
            debug: this.debugInfoValue ?? undefined,
        });
        this.tempCache = {};
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
            if (this.hasCurrentData() || (await this.applyDiskCache(serial))) {
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
        this.flushPatch();
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

    get debugInfo() {
        return this.debugInfoValue;
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

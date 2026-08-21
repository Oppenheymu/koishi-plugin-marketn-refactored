import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatAge, formatBytes, formatError, formatTime } from "../../utils/format.js";
import { clamp } from "../../utils/math.js";
import { DAY, HOUR } from "../../utils/time.js";
import { type MarketScoreContext, marketRouteScore } from "../source/endpoints.js";
import type { CacheEntry, CacheFile, CacheMeta, CacheStore, EndpointResult } from "../types.js";
import { serializeRouteStats, writeCacheStore } from "./io.js";
import { isLegacyInlineCacheStore, normalizeCacheStore } from "./normalize.js";

const MAX_CACHE_ENTRIES = 3;
const CACHE_ENTRY_TTL = 30 * DAY;

export interface DiskCacheDeps {
    cacheFile: string;
    cacheDir: string;
    stats: RouteStatsBook;
    scoreContext: () => MarketScoreContext;
    endpointCandidates: () => string[];
    log: { debug(message: string): void; warn(message: string): void };
    isAlive: () => boolean;
}

/** 市场索引磁盘缓存（v3 拆分布局 + 路由统计共储）。移植自旧 MarketProvider 缓存方法族。 */
export class MarketDiskCache {
    entries: Dict<CacheEntry> = {};
    meta: CacheMeta | undefined;
    result: SearchResult | undefined;
    private cacheWriteTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly deps: DiskCacheDeps;

    constructor(deps: DiskCacheDeps) {
        this.deps = deps;
    }

    /**
     * 条件请求头（etag/If-Modified-Since），经 fetch-index 的 Pick 接口分发后被 fetch-endpoint 消费。
     */
    // fallow-ignore-next-line unused-class-member
    conditionalHeaders(endpoint: string) {
        const meta =
            this.entries[endpoint] || (this.meta?.endpoint === endpoint ? this.meta : undefined);
        if (!meta) return {};
        const headers: Dict<string> = {};
        if (meta.etag) headers["if-none-match"] = meta.etag;
        if (meta.lastModified) headers["if-modified-since"] = meta.lastModified;
        return headers;
    }

    /** 拉取成功后更新当前条件元数据与条目。 */
    updateState(result: EndpointResult) {
        const cached = this.entries[result.endpoint];
        const sameEndpoint = this.meta?.endpoint === result.endpoint;
        this.result = result.result;
        this.meta = buildCacheMeta(result, cached, this.meta, sameEndpoint);
        this.entries[result.endpoint] = {
            ...this.meta,
            result: result.result,
        } as CacheEntry;
    }

    async loadEntryResult(entry: CacheEntry): Promise<CacheFile | undefined> {
        if (Array.isArray(entry.result?.objects)) return entry as CacheFile;
        if (!entry.file) return undefined;
        try {
            const content = await fsp.readFile(resolve(this.deps.cacheDir, entry.file), "utf8");
            const result = JSON.parse(content) as SearchResult;
            if (!Array.isArray(result?.objects)) return undefined;
            const cache: CacheFile = { ...entry, result };
            this.entries[entry.endpoint] = cache;
            return cache;
        } catch (error) {
            this.deps.log.debug(
                `failed to read market split cache entry: endpoint=${entry.endpoint}, file=${entry.file}, error=${formatError(error)}`,
            );
        }
        return undefined;
    }

    async load(): Promise<{
        store: CacheStore;
        applied: CacheFile | undefined;
        shouldMigrate: boolean;
    }> {
        const loaded = await readCacheStore(this.deps);
        if (!loaded)
            return { store: { version: 3, entries: {} }, applied: undefined, shouldMigrate: false };
        const { store, shouldMigrate } = loaded;
        this.entries = { ...this.entries, ...store.entries };
        restoreRouteStats(this.deps.stats.stats, store.routeStats);
        const applied = await this.pick();
        this.applyCacheEntry(applied);
        this.deps.log.debug(
            `market disk cache loaded: endpoint=${applied?.endpoint ?? "-"}, cachedAt=${formatTime(applied?.fetchedAt)}, age=${formatAge(applied ? Date.now() - applied.fetchedAt : undefined)}, size=${formatBytes(applied?.size)}`,
        );
        return { store, applied, shouldMigrate };
    }

    private applyCacheEntry(applied: CacheFile | undefined) {
        if (!applied) return;
        this.meta = getCacheMeta(applied);
        this.result = applied.result;
        this.entries[applied.endpoint] = applied;
    }

    private async pick(): Promise<CacheFile | undefined> {
        const endpoints = this.deps.endpointCandidates();
        const primary = this.entries[endpoints[0] ?? ""];
        const primaryCache = primary ? await this.loadEntryResult(primary) : undefined;
        if (primaryCache) return primaryCache;
        const candidates = endpoints
            .slice(1)
            .map((endpoint) => this.entries[endpoint])
            .filter(
                (entry): entry is CacheEntry =>
                    !!entry && (Array.isArray(entry.result?.objects) || !!entry.file),
            )
            .sort((a, b) => {
                const delta = this.cacheScore(b) - this.cacheScore(a);
                if (delta) return delta;
                return b.fetchedAt - a.fetchedAt;
            });
        for (const entry of candidates) {
            const cache = await this.loadEntryResult(entry);
            if (cache) return cache;
        }
        return undefined;
    }

    cacheScore(cache: CacheEntry) {
        const age = Number.isFinite(cache.fetchedAt)
            ? Date.now() - cache.fetchedAt
            : Number.POSITIVE_INFINITY;
        let score = marketRouteScore(cache.endpoint, this.deps.scoreContext());
        if (age <= 12 * HOUR) score += 3;
        else if (age <= 3 * DAY) score += 1;
        else score -= 1;
        if (cache.endpoint === this.deps.scoreContext().config.endpoint) score += 0.5;
        return score;
    }

    scheduleWrite(result: SearchResult, meta = this.meta) {
        if (!meta) return;
        clearTimeout(this.cacheWriteTimer);
        const entry: CacheFile = {
            ...meta,
            endpoint: meta.endpoint,
            fetchedAt: meta.fetchedAt,
            result,
        };
        this.entries[entry.endpoint] = entry;
        const entries = this.prune(entry.endpoint);
        this.entries = entries;
        this.cacheWriteTimer = setTimeout(() => {
            this.cacheWriteTimer = undefined;
            if (!this.deps.isAlive()) return;
            void writeCacheStore(this.ioDeps(), {
                version: 3,
                entries,
                lastUsed: entry.endpoint,
                routeStats: serializeRouteStats(this.deps.stats),
            });
        }, 0);
    }

    private ioDeps() {
        return {
            cacheFile: this.deps.cacheFile,
            cacheDir: this.deps.cacheDir,
            stats: this.deps.stats,
            log: this.deps.log,
        };
    }

    prune(lastUsed: string): Dict<CacheEntry> {
        const entries = Object.values(this.entries)
            .filter(
                (entry): entry is CacheEntry =>
                    !!entry &&
                    (Array.isArray(entry.result?.objects) || !!entry.file) &&
                    Date.now() - entry.fetchedAt <= CACHE_ENTRY_TTL,
            )
            .sort((a, b) => {
                if (a.endpoint === lastUsed) return -1;
                if (b.endpoint === lastUsed) return 1;
                const preferred = this.deps.scoreContext().config.endpoint;
                if (a.endpoint === preferred) return -1;
                if (b.endpoint === preferred) return 1;
                const delta = this.cacheScore(b) - this.cacheScore(a);
                if (delta) return delta;
                return b.fetchedAt - a.fetchedAt;
            })
            .slice(0, MAX_CACHE_ENTRIES);
        return Object.fromEntries(entries.map((entry) => [entry.endpoint, entry]));
    }
}

async function readCacheStore(deps: DiskCacheDeps) {
    let content: string;
    try {
        content = await fsp.readFile(deps.cacheFile, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            deps.log.warn(`failed to read market disk cache: ${formatError(error)}`);
        } else {
            deps.log.debug("market disk cache is empty");
        }
        return;
    }
    const rawStore: unknown = JSON.parse(content);
    return {
        shouldMigrate: isLegacyInlineCacheStore(rawStore),
        store: normalizeCacheStore(rawStore),
    };
}

function buildCacheMeta(
    result: EndpointResult,
    cached: CacheEntry | undefined,
    previous: CacheMeta | undefined,
    sameEndpoint: boolean,
): CacheMeta {
    return {
        endpoint: result.endpoint,
        fetchedAt: getFetchedAt(result, cached, previous),
        validatedAt: result.validatedAt,
        etag: result.etag ?? (sameEndpoint ? previous?.etag : undefined),
        lastModified: result.lastModified ?? (sameEndpoint ? previous?.lastModified : undefined),
        hash: result.hash ?? previous?.hash,
        size: result.size ?? previous?.size,
        wireSize: result.wireSize ?? previous?.wireSize,
        contentEncoding: result.contentEncoding ?? previous?.contentEncoding,
    };
}

function getFetchedAt(
    result: EndpointResult,
    cached: CacheEntry | undefined,
    previous: CacheMeta | undefined,
) {
    if (result.source === "network") return Date.now();
    return result.cachedAt ?? cached?.fetchedAt ?? previous?.fetchedAt ?? Date.now();
}

function restoreRouteStats(target: RouteStatsBook["stats"], routeStats: CacheStore["routeStats"]) {
    if (!routeStats) return;
    for (const [endpoint, stats] of Object.entries(routeStats)) {
        if (!stats) continue;
        const hasRecentSuccess = stats.lastSuccess && Date.now() - stats.lastSuccess < DAY;
        target[endpoint] = {
            score: hasRecentSuccess ? clamp(stats.score, -1, 3) : clamp(stats.score, -4, 3),
            successes: 0,
            failures: 0,
            consecutiveFailures: hasRecentSuccess ? 0 : stats.consecutiveFailures,
            cooldownUntil: hasRecentSuccess ? undefined : stats.cooldownUntil,
            averageElapsed: stats.averageElapsed,
            lastSuccess: stats.lastSuccess,
            contentEncoding: stats.contentEncoding,
        };
    }
}

function getCacheMeta(entry: CacheEntry): CacheMeta {
    return {
        endpoint: entry.endpoint,
        fetchedAt: entry.fetchedAt,
        validatedAt: entry.validatedAt,
        etag: entry.etag,
        lastModified: entry.lastModified,
        hash: entry.hash,
        size: entry.size,
        wireSize: entry.wireSize,
        contentEncoding: entry.contentEncoding,
    };
}

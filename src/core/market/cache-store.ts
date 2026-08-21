import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { RouteStatsBook } from "../racing/stats.js";
import { formatAge, formatBytes, formatError, formatTime } from "../utils/format.js";
import { clamp } from "../utils/math.js";
import { DAY, HOUR } from "../utils/time.js";
import { serializeRouteStats, writeCacheStore } from "./cache-io.js";
import { type MarketScoreContext, marketRouteScore } from "./endpoints.js";
import { isLegacyInlineCacheStore, normalizeCacheStore } from "./normalize.js";
import type { CacheEntry, CacheFile, CacheMeta, CacheStore, EndpointResult } from "./types.js";

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

    /** 条件请求头（etag/If-Modified-Since），经 fetch-index 的 Pick 接口分发后被 fetch-endpoint 消费。 @public */
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
        this.meta = {
            endpoint: result.endpoint,
            fetchedAt:
                result.source === "network"
                    ? Date.now()
                    : (result.cachedAt ?? cached?.fetchedAt ?? this.meta?.fetchedAt ?? Date.now()),
            validatedAt: result.validatedAt,
            etag: result.etag ?? (sameEndpoint ? this.meta?.etag : undefined),
            lastModified:
                result.lastModified ?? (sameEndpoint ? this.meta?.lastModified : undefined),
            hash: result.hash ?? this.meta?.hash,
            size: result.size ?? this.meta?.size,
            wireSize: result.wireSize ?? this.meta?.wireSize,
            contentEncoding: result.contentEncoding ?? this.meta?.contentEncoding,
        };
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
        let content: string;
        try {
            content = await fsp.readFile(this.deps.cacheFile, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.deps.log.warn(`failed to read market disk cache: ${formatError(error)}`);
            } else {
                this.deps.log.debug("market disk cache is empty");
            }
            return { store: { version: 3, entries: {} }, applied: undefined, shouldMigrate: false };
        }
        const rawStore: unknown = JSON.parse(content);
        const shouldMigrate = isLegacyInlineCacheStore(rawStore);
        const store = normalizeCacheStore(rawStore);
        this.entries = { ...this.entries, ...store.entries };
        if (store.routeStats) {
            for (const [endpoint, stats] of Object.entries(store.routeStats)) {
                if (!stats) continue;
                const hasRecentSuccess = stats.lastSuccess && Date.now() - stats.lastSuccess < DAY;
                this.deps.stats.stats[endpoint] = {
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
        const applied = await this.pick();
        if (applied) {
            this.meta = {
                endpoint: applied.endpoint,
                fetchedAt: applied.fetchedAt,
                validatedAt: applied.validatedAt,
                etag: applied.etag,
                lastModified: applied.lastModified,
                hash: applied.hash,
                size: applied.size,
                wireSize: applied.wireSize,
                contentEncoding: applied.contentEncoding,
            };
            this.result = applied.result;
            this.entries[applied.endpoint] = applied;
        }
        this.deps.log.debug(
            `market disk cache loaded: endpoint=${applied?.endpoint ?? "-"}, cachedAt=${formatTime(applied?.fetchedAt)}, age=${formatAge(applied ? Date.now() - applied.fetchedAt : undefined)}, size=${formatBytes(applied?.size)}`,
        );
        return { store, applied, shouldMigrate };
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

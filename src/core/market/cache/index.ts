/**
 * @file 市场索引磁盘缓存的内存态管理(core/market/cache 域)。
 *
 * 模块职责:MarketDiskCache 维护多端点的缓存条目(entries)、当前生效的
 * 元数据(meta)与索引体(result);load() 从磁盘读取并按路由评分挑出最佳
 * 条目回放,scheduleWrite() 在拉取成功后防抖落盘(索引体拆分文件 + 主清单
 * + 路由统计共储,v3 布局)。
 *
 * 关键设计:
 * - 条目按 TTL 30 天、最多 3 条淘汰,排序依据"路由评分 + 新鲜度加分 +
 *   用户首选端点加分",保证重启后优先回放又快又稳的端点数据;
 * - 条件请求(etag/last-modified)经 conditionalHeaders 提供给拉取链,
 *   命中 304 时可零字节刷新;
 * - 落盘用 setTimeout(0) 防抖,且写入前检查 isAlive,宿主停用后不再写。
 *
 * 架构位置:core/market 域,被 source(host/collect)读写、warmup 预热;
 * 实际磁盘 I/O 委托给同目录 io.ts/persistence.ts。
 */
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import type { SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatAge, formatBytes, formatError, formatTime } from "../../utils/format.js";
import { DAY, HOUR } from "../../utils/time.js";
import { type MarketScoreContext, marketRouteScore } from "../source/endpoints.js";
import type { CacheEntry, CacheFile, CacheMeta, CacheStore, EndpointResult } from "../types.js";
import { serializeRouteStats, writeCacheStore } from "./io.js";
import { buildCacheMeta, getCacheMeta, readCacheStore, restoreRouteStats } from "./persistence.js";

/** 最多保留的缓存条目数(多端点备份,超出按评分淘汰)。 */
const MAX_CACHE_ENTRIES = 3;
/** 单条缓存的有效期:超过 30 天的条目在 prune 时直接丢弃。 */
const CACHE_ENTRY_TTL = 30 * DAY;

/** MarketDiskCache 的构造注入面:缓存文件位置、路由统计与评分上下文。 */
export interface DiskCacheDeps {
    /** 主清单文件路径(索引元数据 + 路由统计) */
    cacheFile: string;
    /** 拆分索引体文件所在目录 */
    cacheDir: string;
    /** 路由统计本(与缓存清单共储共恢复) */
    stats: RouteStatsBook;
    /** 路由评分上下文(含用户配置首选端点) */
    scoreContext: () => MarketScoreContext;
    /** 参与缓存挑选的候选端点列表(首个为当前主端点) */
    endpointCandidates: () => string[];
    log: { debug(message: string): void; warn(message: string): void };
    /** 宿主是否仍活跃(落盘定时器触发前校验) */
    isAlive: () => boolean;
}

/** 市场索引磁盘缓存（v3 拆分布局 + 路由统计共储）。移植自旧 MarketProvider 缓存方法族。 */
export class MarketDiskCache {
    /** 端点 → 缓存条目(内存态可能带内联 result,磁盘态只有元数据引用) */
    entries: Dict<CacheEntry> = {};
    /** 当前生效条目的元数据视图 */
    meta: CacheMeta | undefined;
    /** 当前生效的索引体 */
    result: SearchResult | undefined;
    /** 落盘防抖定时器 */
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

    /**
     * 拉取成功后更新当前条件元数据与条目。
     * etag/lastModified 缺失时(如 304 响应不带新值)沿用旧值,
     * hash/size 等统计字段同样尽量保留上一轮。
     */
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

    /**
     * 加载单条缓存:内存里已带索引体直接用,否则按 entry.file 读拆分文件。
     * 读取失败/内容不合法返回 undefined 并降级 debug 日志(缓存坏了不致命)。
     */
    async loadEntryResult(entry: CacheEntry): Promise<CacheFile | undefined> {
        if (Array.isArray(entry.result?.objects)) return entry as CacheFile;
        if (!entry.file) return undefined;
        try {
            const content = await fsp.readFile(resolve(this.deps.cacheDir, entry.file), "utf8");
            const result = JSON.parse(content) as SearchResult;
            // objects 非数组说明文件损坏或形状不对,视为无缓存
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

    /**
     * 从磁盘加载缓存清单:恢复条目与路由统计,挑出最佳条目回放到内存,
     * 并返回原始 store 与"是否需要迁移"(legacy 内联布局 → v3 拆分)。
     */
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

    /** 把选中的条目应用到当前状态(meta/result/entries 三者同步)。 */
    private applyCacheEntry(applied: CacheFile | undefined) {
        if (!applied) return;
        this.meta = getCacheMeta(applied);
        this.result = applied.result;
        this.entries[applied.endpoint] = applied;
    }

    /**
     * 挑选回放条目:优先当前主端点(候选列表第一位)的缓存;主端点无可用
     * 缓存时,其余候选按"缓存评分降序、并列取更新鲜"排序,逐个尝试加载,
     * 第一个能成功读出索引体的胜出。
     */
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

    /**
     * 缓存条目评分:路由评分打底,按新鲜度加减分(半天内 +3、3 天内 +1、
     * 更旧 -1),用户配置的首选端点再 +0.5。分高者优先进回放/保留名单。
     */
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

    /**
     * 拉取成功后调度落盘:先更新条目并 prune 到上限,再用 setTimeout(0)
     * 防抖合并连续触发;真正写盘委托 io.ts 的 writeCacheStore(清单 + 拆分
     * 索引体 + 路由统计),写前校验宿主仍活跃。
     */
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

    /** 组装 io.ts 所需的依赖子集(文件路径/统计/日志)。 */
    private ioDeps() {
        return {
            cacheFile: this.deps.cacheFile,
            cacheDir: this.deps.cacheDir,
            stats: this.deps.stats,
            log: this.deps.log,
        };
    }

    /**
     * 淘汰并排序条目:过滤掉无索引引用与超过 TTL 的条目,按
     * "lastUsed 最优、用户首选端点次之、评分高者、更新鲜者"排序,
     * 截取 MAX_CACHE_ENTRIES 条返回新的 entries 字典。
     */
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

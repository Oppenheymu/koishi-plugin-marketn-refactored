import type { SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformanceSnapshot } from "../../shared/types.js";

/** 单次端点请求结果（fetch 链路的统一形状）。 */
export interface EndpointResult {
    endpoint: string;
    result: SearchResult;
    elapsed: number;
    candidates: number;
    source: MarketPerformanceSnapshot["source"];
    timings: Dict<number>;
    size?: number | undefined;
    wireSize?: number | undefined;
    contentEncoding?: string | undefined;
    hash?: string | undefined;
    etag?: string | undefined;
    lastModified?: string | undefined;
    preferredEndpoint?: string | undefined;
    fallbackReason?: "primary-failed" | "primary-slow" | "rescue" | undefined;
    cachedAt?: number | undefined;
    validatedAt?: number | undefined;
}

/** 磁盘缓存条目（v3 拆分布局：索引体在独立文件，条目只留元数据引用）。 */
export interface CacheEntry {
    endpoint: string;
    fetchedAt: number;
    validatedAt?: number | undefined;
    etag?: string | undefined;
    lastModified?: string | undefined;
    hash?: string | undefined;
    size?: number | undefined;
    wireSize?: number | undefined;
    contentEncoding?: string | undefined;
    file?: string | undefined;
    objects?: number | undefined;
    result?: SearchResult | undefined;
}

export type CacheFile = CacheEntry & { result: SearchResult };

export interface PersistedRouteStats {
    score: number;
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    contentEncoding?: string | undefined;
    consecutiveFailures?: number | undefined;
    cooldownUntil?: number | undefined;
}

export interface CacheStore {
    version: 3;
    entries: Dict<CacheEntry>;
    lastUsed?: string | undefined;
    routeStats?: Dict<PersistedRouteStats> | undefined;
}

export type CacheMeta = Omit<CacheFile, "result">;

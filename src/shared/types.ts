import type { SearchObject } from "@koishijs/registry";
import type { Dict } from "koishi";

/** 单个 npm 端点的近期状态（registry/registryStatus 通道与路由评分的共享语言）。 */
export interface RegistryStatus {
    loading?: boolean;
    reason?: "timeout" | "not-found" | "network" | "invalid" | "http" | "unknown";
    error?: string;
    endpoint?: string;
    attempts?: number;
    elapsed?: number;
    updatedAt?: number;
}

/** 一次索引/元数据请求的性能快照（市场页 debug 卡的数据来源）。 */
export interface MarketPerformanceSnapshot {
    source?: "network" | "disk-cache" | "http-304" | "hash-cache" | "legacy";
    endpoint?: string;
    preferredEndpoint?: string;
    fallbackReason?: "primary-failed" | "primary-slow" | "rescue";
    candidates?: number;
    size?: number;
    wireSize?: number;
    contentEncoding?: string;
    objects?: number;
    hash?: string;
    etag?: string;
    lastModified?: string;
    cachedAt?: number;
    validatedAt?: number;
    timings?: Dict<number>;
}

export interface MarketRouteScore {
    endpoint: string;
    score: number;
    successes?: number;
    failures?: number;
    consecutiveFailures?: number;
    cooldownUntil?: number;
    coolingDown?: boolean;
    averageElapsed?: number;
    lastSuccess?: number;
    contentEncoding?: string;
    cached?: boolean;
    cachedAt?: number;
}

export interface MarketPerformance extends MarketPerformanceSnapshot {
    initial?: MarketPerformanceSnapshot;
    refresh?: MarketPerformanceSnapshot;
    routeScores?: MarketRouteScore[];
}

export interface MarketLookupRequest {
    names?: string[];
    services?: string[];
}

export interface MarketLookupResult {
    data: Dict<SearchObject>;
    services: Dict<string[]>;
    dataVersion?: number;
}

export interface MarketSnapshotRequest {
    transport?: "inline" | "http-gzip";
}

/** market 通道的完整 payload（MarketProvider.Payload 的结构性定义）。 */
export interface MarketPayload {
    registry?: string;
    data?: Dict<SearchObject>;
    dataVersion?: number;
    total: number;
    failed: number;
    progress: number;
    gravatar?: string;
    stale?: boolean;
    error?: string;
    cached?: boolean;
    cachedAt?: number;
    validatedAt?: number;
    serverNow?: number;
    refreshing?: boolean;
    loading?: boolean;
    debug?: MarketPerformance;
}

export interface MarketSnapshotTransfer {
    transport: "http-gzip";
    url: string;
    payload: Omit<MarketPayload, "data">;
    decodedSize: number;
    encodedSize: number;
}

export type MarketSnapshotResponse = MarketPayload | MarketSnapshotTransfer;

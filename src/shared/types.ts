import type { SearchObject } from "@koishijs/registry";
import type { Dict } from "koishi";

/** 单个 npm 端点的近期状态（registry/registryStatus 通道与路由评分的共享语言）。 */
export interface RegistryStatus {
    loading?: boolean | undefined;
    reason?: "timeout" | "not-found" | "network" | "invalid" | "http" | "unknown" | undefined;
    error?: string | undefined;
    endpoint?: string | undefined;
    attempts?: number | undefined;
    elapsed?: number | undefined;
    updatedAt?: number | undefined;
}

/** 安装失败后的备用 npm 源推荐（node 端点选择与 client 进度弹窗共用）。 */
export interface InstallFallbackCandidate {
    endpoint: string;
    label: string;
    reason: string;
}

/** 一次索引/元数据请求的性能快照（市场页 debug 卡的数据来源）。 */
export interface MarketPerformanceSnapshot {
    source?: "network" | "disk-cache" | "http-304" | "hash-cache" | "legacy" | undefined;
    endpoint?: string | undefined;
    preferredEndpoint?: string | undefined;
    fallbackReason?: "primary-failed" | "primary-slow" | "rescue" | undefined;
    candidates?: number | undefined;
    size?: number | undefined;
    wireSize?: number | undefined;
    contentEncoding?: string | undefined;
    objects?: number | undefined;
    hash?: string | undefined;
    etag?: string | undefined;
    lastModified?: string | undefined;
    cachedAt?: number | undefined;
    validatedAt?: number | undefined;
    timings?: Dict<number> | undefined;
}

export interface MarketRouteScore {
    endpoint: string;
    score: number;
    successes?: number | undefined;
    failures?: number | undefined;
    consecutiveFailures?: number | undefined;
    cooldownUntil?: number | undefined;
    coolingDown?: boolean | undefined;
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    contentEncoding?: string | undefined;
    cached?: boolean | undefined;
    cachedAt?: number | undefined;
}

export interface MarketPerformance extends MarketPerformanceSnapshot {
    initial?: MarketPerformanceSnapshot | undefined;
    refresh?: MarketPerformanceSnapshot | undefined;
    routeScores?: MarketRouteScore[] | undefined;
}

export interface MarketLookupRequest {
    names?: string[] | undefined;
    services?: string[] | undefined;
}

export interface MarketLookupResult {
    data: Dict<SearchObject>;
    services: Dict<string[]>;
    dataVersion?: number | undefined;
}

export interface MarketSnapshotRequest {
    transport?: "inline" | "http-gzip" | undefined;
}

/** market 通道的完整 payload（MarketProvider.Payload 的结构性定义）。 */
export interface MarketPayload {
    registry?: string | undefined;
    data?: Dict<SearchObject> | undefined;
    dataVersion?: number | undefined;
    total: number;
    failed: number;
    progress: number;
    gravatar?: string | undefined;
    stale?: boolean | undefined;
    error?: string | undefined;
    cached?: boolean | undefined;
    cachedAt?: number | undefined;
    validatedAt?: number | undefined;
    serverNow?: number | undefined;
    refreshing?: boolean | undefined;
    loading?: boolean | undefined;
    debug?: MarketPerformance | undefined;
}

export interface MarketSnapshotTransfer {
    transport: "http-gzip";
    url: string;
    payload: Omit<MarketPayload, "data">;
    decodedSize: number;
    encodedSize: number;
}

export type MarketSnapshotResponse = MarketPayload | MarketSnapshotTransfer;

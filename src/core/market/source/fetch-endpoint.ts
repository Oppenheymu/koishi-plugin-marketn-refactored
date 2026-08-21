import { createHash } from "node:crypto";
import type { SearchResult } from "@koishijs/registry";
import type { RequestScope } from "../../racing/request-scope.js";
import {
    formatBytes,
    formatError,
    formatStack,
    normalizeWireSize,
    parseContentLength,
    shortHash,
} from "../../utils/format.js";
import type { CacheEntry, CacheFile } from "../types.js";

export interface MarketHttp {
    getText(
        path: string,
        config: {
            headers: Record<string, string>;
            signal?: AbortSignal | undefined;
            validateStatus: (status: number) => boolean;
        },
    ): Promise<{ status: number; data: string; headers: { get(name: string): string | null } }>;
}

export interface EndpointFetchResult {
    endpoint: string;
    result: SearchResult;
    elapsed: number;
    candidates: number;
    source: "network" | "http-304" | "hash-cache";
    timings: Record<string, number>;
    size: number | undefined;
    wireSize: number | undefined;
    contentEncoding: string | undefined;
    hash: string | undefined;
    etag: string | undefined;
    lastModified: string | undefined;
    cachedAt: number | undefined;
    validatedAt: number | undefined;
}

export interface FetchEndpointDeps {
    http: (endpoint: string) => MarketHttp;
    scope: RequestScope;
    getCachedEntry: (endpoint: string) => CacheEntry | undefined;
    loadCacheEntryResult: (entry: CacheEntry) => Promise<CacheFile | undefined>;
    conditionalHeaders: (endpoint: string) => Record<string, string>;
    log: { debug(message: string): void; warn(message: string): void };
}

interface EndpointRequest {
    response: Awaited<ReturnType<MarketHttp["getText"]>>;
    requestElapsed: number;
    etag?: string | undefined;
    lastModified?: string | undefined;
    contentEncoding?: string | undefined;
    headerWireSize: number | undefined;
}

/** 发起条件请求（etag/last-modified），返回统一请求上下文。 */
async function requestMarketIndex(
    deps: FetchEndpointDeps,
    endpoint: string,
    serial: number,
    signal?: AbortSignal,
): Promise<EndpointRequest> {
    const conditional = deps.conditionalHeaders(endpoint);
    const headers = { "accept-encoding": "br,gzip,deflate", ...conditional };
    const requestStart = Date.now();
    const response = await deps.http(endpoint).getText("", {
        headers,
        signal,
        validateStatus: (status) => status === 304 || (status >= 200 && status < 300),
    });
    if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
    return {
        response,
        requestElapsed: Date.now() - requestStart,
        etag: response.headers.get("etag") || undefined,
        lastModified: response.headers.get("last-modified") || undefined,
        contentEncoding: response.headers.get("content-encoding") || undefined,
        headerWireSize: parseContentLength(response.headers.get("content-length")),
    };
}

/** 304 命中：复用磁盘缓存条目。 */
async function resolveFrom304Cache(
    deps: FetchEndpointDeps,
    endpoint: string,
    total: number,
    start: number,
    request: EndpointRequest,
    cachedEntry: CacheEntry | undefined,
): Promise<EndpointFetchResult> {
    const cache = cachedEntry && (await deps.loadCacheEntryResult(cachedEntry));
    if (!cache) throw new Error(`market index from ${endpoint} returned 304 without cache`);
    const elapsed = Date.now() - start;
    return {
        endpoint,
        result: cache.result,
        elapsed,
        candidates: total,
        source: "http-304",
        timings: { request: request.requestElapsed, total: elapsed },
        size: cache.size,
        wireSize: request.headerWireSize ?? cache.wireSize,
        contentEncoding: request.contentEncoding ?? cache.contentEncoding,
        hash: cache.hash,
        etag: request.etag || cache.etag,
        lastModified: request.lastModified || cache.lastModified,
        cachedAt: cache.fetchedAt,
        validatedAt: Date.now(),
    };
}

/** 内容哈希比对复用（同内容不再重复解析）。 */
async function matchHashCache(
    deps: FetchEndpointDeps,
    text: string,
    cachedEntry: CacheEntry | undefined,
): Promise<{ hash: string; hashElapsed: number; cache?: CacheFile | undefined }> {
    const hashStart = Date.now();
    const hash = createHash("sha256").update(text).digest("hex");
    const hashElapsed = Date.now() - hashStart;
    const cache =
        cachedEntry && cachedEntry.hash === hash
            ? await deps.loadCacheEntryResult(cachedEntry)
            : undefined;
    return { hash, hashElapsed, cache };
}

/** 内容哈希命中：复用缓存条目并构建 hash-cache 结果。 */
function buildHashCacheResult(
    deps: FetchEndpointDeps,
    endpoint: string,
    total: number,
    start: number,
    request: EndpointRequest,
    hash: string,
    hashElapsed: number,
    size: number,
    wireSize: number | undefined,
    hashCache: CacheFile,
): EndpointFetchResult {
    const elapsed = Date.now() - start;
    deps.log.debug(`market index hash-cache: endpoint=${endpoint}, hash=${shortHash(hash)}`);
    return {
        endpoint,
        result: hashCache.result,
        elapsed,
        candidates: total,
        source: "hash-cache",
        timings: {
            request: request.requestElapsed,
            hash: hashElapsed,
            total: elapsed,
        },
        size,
        wireSize,
        contentEncoding: request.contentEncoding,
        hash,
        etag: request.etag,
        lastModified: request.lastModified,
        cachedAt: hashCache.fetchedAt,
        validatedAt: Date.now(),
    };
}

/** 网络体解析并构建 network 结果。 */
function parseNetworkResult(
    deps: FetchEndpointDeps,
    endpoint: string,
    total: number,
    start: number,
    request: EndpointRequest,
    text: string,
    size: number,
    wireSize: number | undefined,
    hash: string,
    hashElapsed: number,
): EndpointFetchResult {
    const parseStart = Date.now();
    const result = JSON.parse(text) as SearchResult;
    if (!Array.isArray(result?.objects)) {
        throw new Error(`invalid market index from ${endpoint}`);
    }
    const parseElapsed = Date.now() - parseStart;
    const elapsed = Date.now() - start;
    deps.log.debug(
        `market index fetched: endpoint=${endpoint}, elapsed=${elapsed}ms, objects=${result.objects.length}, size=${formatBytes(size)}, hash=${shortHash(hash)}`,
    );
    return {
        endpoint,
        result,
        elapsed,
        candidates: total,
        source: "network",
        timings: {
            request: request.requestElapsed,
            hash: hashElapsed,
            parse: parseElapsed,
            total: elapsed,
        },
        size,
        wireSize,
        contentEncoding: request.contentEncoding,
        hash,
        etag: request.etag,
        lastModified: request.lastModified,
        cachedAt: undefined,
        validatedAt: undefined,
    };
}

/** 处理 200 响应体：哈希比对 → hash-cache 复用或网络解析。 */
async function resolveNetworkBody(
    deps: FetchEndpointDeps,
    endpoint: string,
    total: number,
    start: number,
    request: EndpointRequest,
    cachedEntry: CacheEntry | undefined,
): Promise<EndpointFetchResult> {
    const text = request.response.data;
    const size = Buffer.byteLength(text);
    const wireSize = normalizeWireSize(request.headerWireSize, size);
    const { hash, hashElapsed, cache: hashCache } = await matchHashCache(deps, text, cachedEntry);
    if (hashCache) {
        return buildHashCacheResult(
            deps,
            endpoint,
            total,
            start,
            request,
            hash,
            hashElapsed,
            size,
            wireSize,
            hashCache,
        );
    }
    return parseNetworkResult(
        deps,
        endpoint,
        total,
        start,
        request,
        text,
        size,
        wireSize,
        hash,
        hashElapsed,
    );
}

/**
 * 单端点索引拉取：条件请求（etag/last-modified）→ 304 复用 → 内容哈希比对复用 →
 * 解析网络体。成块移植自旧 MarketProvider.fetchEndpoint。
 */
export async function fetchMarketEndpoint(
    deps: FetchEndpointDeps,
    endpoint: string,
    index: number,
    total: number,
    serial: number,
    warnFailure = true,
    signal?: AbortSignal,
): Promise<EndpointFetchResult> {
    if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
    const start = Date.now();
    try {
        const request = await requestMarketIndex(deps, endpoint, serial, signal);
        const cachedEntry = deps.getCachedEntry(endpoint);
        if (request.response.status === 304) {
            return await resolveFrom304Cache(deps, endpoint, total, start, request, cachedEntry);
        }
        return await resolveNetworkBody(deps, endpoint, total, start, request, cachedEntry);
    } catch (error) {
        if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
        if (warnFailure) {
            deps.log.warn(
                `market endpoint fetch failed: endpoint=${endpoint}, elapsed=${Date.now() - start}ms, error=${formatError(error)}`,
            );
        }
        deps.log.debug(
            `market endpoint error detail: endpoint=${endpoint}, index=${index + 1}/${total}, elapsed=${Date.now() - start}ms, stack=${formatStack(error)}`,
        );
        throw error;
    }
}

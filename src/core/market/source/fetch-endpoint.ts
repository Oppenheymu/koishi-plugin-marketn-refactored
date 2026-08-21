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
        const conditional = deps.conditionalHeaders(endpoint);
        const headers = { "accept-encoding": "br,gzip,deflate", ...conditional };
        const requestStart = Date.now();
        const response = await deps.http(endpoint).getText("", {
            headers,
            signal,
            validateStatus: (status) => status === 304 || (status >= 200 && status < 300),
        });
        if (deps.scope.isStale(serial)) throw new Error("market provider disposed");
        const requestElapsed = Date.now() - requestStart;
        const etag = response.headers.get("etag") || undefined;
        const lastModified = response.headers.get("last-modified") || undefined;
        const contentEncoding = response.headers.get("content-encoding") || undefined;
        const headerWireSize = parseContentLength(response.headers.get("content-length"));
        const cachedEntry = deps.getCachedEntry(endpoint);

        if (response.status === 304) {
            const cache = cachedEntry && (await deps.loadCacheEntryResult(cachedEntry));
            if (!cache) throw new Error(`market index from ${endpoint} returned 304 without cache`);
            const elapsed = Date.now() - start;
            return {
                endpoint,
                result: cache.result,
                elapsed,
                candidates: total,
                source: "http-304",
                timings: { request: requestElapsed, total: elapsed },
                size: cache.size,
                wireSize: headerWireSize ?? cache.wireSize,
                contentEncoding: contentEncoding ?? cache.contentEncoding,
                hash: cache.hash,
                etag: etag || cache.etag,
                lastModified: lastModified || cache.lastModified,
                cachedAt: cache.fetchedAt,
                validatedAt: Date.now(),
            };
        }

        const text = response.data;
        const size = Buffer.byteLength(text);
        const wireSize = normalizeWireSize(headerWireSize, size);
        const hashStart = Date.now();
        const hash = createHash("sha256").update(text).digest("hex");
        const hashElapsed = Date.now() - hashStart;

        const hashCache =
            cachedEntry && cachedEntry.hash === hash
                ? await deps.loadCacheEntryResult(cachedEntry)
                : undefined;
        if (hashCache) {
            const elapsed = Date.now() - start;
            deps.log.debug(
                `market index hash-cache: endpoint=${endpoint}, hash=${shortHash(hash)}`,
            );
            return {
                endpoint,
                result: hashCache.result,
                elapsed,
                candidates: total,
                source: "hash-cache",
                timings: { request: requestElapsed, hash: hashElapsed, total: elapsed },
                size,
                wireSize,
                contentEncoding,
                hash,
                etag,
                lastModified,
                cachedAt: hashCache.fetchedAt,
                validatedAt: Date.now(),
            };
        }

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
                request: requestElapsed,
                hash: hashElapsed,
                parse: parseElapsed,
                total: elapsed,
            },
            size,
            wireSize,
            contentEncoding,
            hash,
            etag,
            lastModified,
            cachedAt: undefined,
            validatedAt: undefined,
        };
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

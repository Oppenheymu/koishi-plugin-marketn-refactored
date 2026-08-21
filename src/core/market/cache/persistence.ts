import { promises as fsp } from "node:fs";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatError } from "../../utils/format.js";
import { clamp } from "../../utils/math.js";
import { DAY } from "../../utils/time.js";
import type { CacheEntry, CacheMeta, CacheStore, EndpointResult } from "../types.js";
import { isLegacyInlineCacheStore, normalizeCacheStore } from "./normalize.js";

interface CacheReadDeps {
    cacheFile: string;
    log: { debug(message: string): void; warn(message: string): void };
}

export async function readCacheStore(deps: CacheReadDeps) {
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

export function buildCacheMeta(
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

export function restoreRouteStats(
    target: RouteStatsBook["stats"],
    routeStats: CacheStore["routeStats"],
) {
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

export function getCacheMeta(entry: CacheEntry): CacheMeta {
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

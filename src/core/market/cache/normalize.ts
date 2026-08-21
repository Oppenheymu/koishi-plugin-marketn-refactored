import type { Dict } from "koishi";
import { clamp, finiteNumber } from "../../utils/math.js";
import type { CacheEntry, CacheStore, PersistedRouteStats } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCacheStore(value: unknown): CacheStore {
    if (isRecord(value)) {
        const { version, entries, lastUsed, routeStats } = value;
        if ((version === 2 || version === 3) && isRecord(entries)) {
            const normalizedEntries: Dict<CacheEntry> = {};
            for (const endpoint in entries) {
                const entry = normalizeCacheEntry(entries[endpoint]);
                if (entry) normalizedEntries[entry.endpoint] = entry;
            }
            return {
                version: 3,
                entries: normalizedEntries,
                lastUsed: lastUsed as string | undefined,
                routeStats: normalizePersistedRouteStats(routeStats),
            };
        }
        if ((version === 2 || version === 3) && isRecord(routeStats)) {
            return {
                version: 3,
                entries: {},
                lastUsed: lastUsed as string | undefined,
                routeStats: normalizePersistedRouteStats(routeStats),
            };
        }
    }
    const entry = normalizeCacheEntry(value);
    if (entry) {
        return {
            version: 3,
            entries: { [entry.endpoint]: entry },
            lastUsed: entry.endpoint,
        };
    }
    return { version: 3, entries: {} };
}

/** 旧版把索引体内联在主缓存文件里；检测到即触发迁移。 */
export function isLegacyInlineCacheStore(value: unknown) {
    if (!isRecord(value)) return false;
    const { version, entries } = value;
    if (version !== 3) return true;
    return Object.values(entries ?? {}).some((entry) =>
        Array.isArray((entry as { result?: { objects?: unknown } })?.result?.objects),
    );
}

function normalizePersistedRouteStats(value: unknown): Dict<PersistedRouteStats> | undefined {
    if (!isRecord(value)) return undefined;
    const result: Dict<PersistedRouteStats> = {};
    for (const endpoint in value) {
        const stats = value[endpoint];
        if (!isRecord(stats)) continue;
        const {
            score,
            averageElapsed,
            lastSuccess,
            contentEncoding,
            consecutiveFailures,
            cooldownUntil,
        } = stats;
        const numericScore = Number(score);
        if (!Number.isFinite(numericScore)) continue;
        result[endpoint] = {
            score: clamp(numericScore, -6, 3),
            averageElapsed: finiteNumber(averageElapsed),
            lastSuccess: finiteNumber(lastSuccess),
            contentEncoding: typeof contentEncoding === "string" ? contentEncoding : undefined,
            consecutiveFailures: finiteNumber(consecutiveFailures),
            cooldownUntil: finiteNumber(cooldownUntil),
        };
    }
    return Object.keys(result).length ? result : undefined;
}

function normalizeCacheEntry(value: unknown): CacheEntry | undefined {
    if (!isRecord(value)) return undefined;
    const { endpoint, fetchedAt: rawFetchedAt } = value;
    const fetchedAt = Number(rawFetchedAt);
    if (typeof endpoint !== "string") return undefined;
    if (!Number.isFinite(fetchedAt)) return undefined;
    if (!hasCacheResultReference(value)) return undefined;
    return { ...(value as CacheEntry), fetchedAt };
}

function hasCacheResultReference(value: unknown): value is CacheEntry {
    return (
        Array.isArray((value as { result?: { objects?: unknown } } | undefined)?.result?.objects) ||
        typeof (value as { file?: unknown } | undefined)?.file === "string"
    );
}

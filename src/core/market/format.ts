import type { Dict } from "koishi";
import type { MarketPerformance, MarketPerformanceSnapshot } from "../../shared/types.js";
import { formatBytes, formatTime, formatTimings } from "../utils/format.js";
import type { CacheEntry } from "./types.js";

export function formatSnapshot(snapshot: MarketPerformanceSnapshot = {}) {
    return [
        `source=${snapshot.source ?? "unknown"}`,
        `endpoint=${snapshot.endpoint ?? "unknown"}`,
        `preferred=${snapshot.preferredEndpoint ?? "-"}`,
        `fallback=${snapshot.fallbackReason ?? "-"}`,
        `candidates=${snapshot.candidates ?? "-"}`,
        `objects=${snapshot.objects ?? "-"}`,
        `size=${formatBytes(snapshot.size)}`,
        `wireSize=${formatBytes(snapshot.wireSize)}`,
        `encoding=${snapshot.contentEncoding ?? "identity"}`,
        `cachedAt=${formatTime(snapshot.cachedAt)}`,
        `validatedAt=${formatTime(snapshot.validatedAt)}`,
        `timings=${formatTimings(snapshot.timings) || "-"}`,
    ].join(", ");
}

export function formatRouteScores(routes?: MarketPerformance["routeScores"]) {
    if (!routes?.length) return "-";
    return routes
        .map((route) =>
            [
                route.endpoint,
                `score=${route.score}`,
                `ok=${route.successes ?? 0}`,
                `fail=${route.failures ?? 0}`,
                `consecutive=${route.consecutiveFailures ?? 0}`,
                `cooldown=${route.coolingDown ? formatTime(route.cooldownUntil) : "-"}`,
                `avg=${route.averageElapsed == null ? "-" : `${Math.round(route.averageElapsed)}ms`}`,
                `cache=${route.cached ? "yes" : "no"}`,
                `cachedAt=${formatTime(route.cachedAt)}`,
                `encoding=${route.contentEncoding ?? "identity"}`,
            ].join(" "),
        )
        .join(" | ");
}

export function formatCacheEntries(entries: Dict<CacheEntry | undefined>) {
    const values = Object.values(entries).filter((entry): entry is CacheEntry => !!entry);
    if (!values.length) return "-";
    return values
        .map((entry) =>
            [
                entry.endpoint,
                `objects=${entry.result?.objects?.length ?? entry.objects ?? "-"}`,
                `cachedAt=${formatTime(entry.fetchedAt)}`,
                `hash=${entry.hash?.slice(0, 12) ?? "-"}`,
                `size=${formatBytes(entry.size)}`,
            ].join(" "),
        )
        .join(" | ");
}

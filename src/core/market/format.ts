import type { MarketPerformanceSnapshot } from "../../shared/types.js";
import { formatBytes, formatTime, formatTimings } from "../utils/format.js";

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

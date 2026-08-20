import type { Dict } from "koishi";
import type { RouteStats, RouteStatsBook } from "../racing/stats.js";
import { clamp } from "../utils/math.js";
import { DAY } from "../utils/time.js";
import type { RegistryReason } from "./errors.js";

export interface PersistedRegistryStats {
    score: number;
    successes?: number | undefined;
    failures?: number | undefined;
    consecutiveFailures?: number | undefined;
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    lastFailure?: number | undefined;
    lastFailureReason?: RegistryReason | undefined;
    contentEncoding?: string | undefined;
}

export interface RegistryStatsStore {
    version: 1;
    stats: Dict<PersistedRegistryStats>;
    savedAt: number;
}

/** 写盘视图：分数收敛到 [-6, 3]。 */
export function serializeRegistryStats(book: RouteStatsBook): Dict<PersistedRegistryStats> {
    const stats: Dict<PersistedRegistryStats> = {};
    for (const [endpoint, value] of Object.entries(book.stats)) {
        if (!value) continue;
        stats[endpoint] = {
            score: clamp(value.score, -6, 3),
            successes: value.successes,
            failures: value.failures,
            consecutiveFailures: value.consecutiveFailures,
            averageElapsed: value.averageElapsed,
            lastSuccess: value.lastSuccess,
            lastFailure: value.lastFailure,
            lastFailureReason: value.lastFailureReason as RegistryReason | undefined,
        };
    }
    return stats;
}

/**
 * 从磁盘恢复学习数据：30 天 TTL；近期有成功的端点失败数收敛、连续失败清零。
 * 成块移植自旧 Installer.loadRouteStats。
 */
export function restoreRegistryStats(
    book: RouteStatsBook,
    store: RegistryStatsStore | undefined,
    log?: (message: string) => void,
) {
    if (!store || store.version !== 1 || !store.stats) return;
    if (Date.now() - store.savedAt > 30 * DAY) return;
    for (const [endpoint, stats] of Object.entries(store.stats)) {
        if (!stats) continue;
        const successes = Math.max(0, Number(stats.successes) || 0);
        const failures = Math.max(0, Number(stats.failures) || 0);
        const hasRecentSuccess =
            Number(stats.lastSuccess) && Date.now() - Number(stats.lastSuccess) < DAY;
        const restored: RouteStats = {
            score: hasRecentSuccess ? clamp(stats.score, -1, 3) : clamp(stats.score, -4, 3),
            successes,
            failures: hasRecentSuccess
                ? Math.min(failures, Math.max(2, Math.ceil(successes / 2)))
                : Math.min(failures, 12),
            consecutiveFailures: hasRecentSuccess
                ? 0
                : Math.max(0, Number(stats.consecutiveFailures) || 0),
            averageElapsed: stats.averageElapsed,
            lastSuccess: stats.lastSuccess,
            lastFailure: stats.lastFailure,
            lastFailureReason: stats.lastFailureReason,
        };
        book.stats[endpoint] = restored;
    }
    log?.(`npm registry route stats restored from disk: ${Object.keys(store.stats).join(", ")}`);
}

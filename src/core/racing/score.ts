import { MINUTE } from "../utils/time.js";
import type { RouteStats } from "./stats.js";

export interface RouteScoreOptions {
    /** 是否主端点（+1 起始分） */
    isPrimary: boolean;
    /** 与 stats 记录一致的快速阈值（registry 800ms / 市场 500ms） */
    fastThreshold: number;
    /** 调用方附加分（市场：磁盘缓存新鲜度 + contentEncoding 加分） */
    extraScore?: number;
    now?: number;
}

/**
 * 路由评分：成功率、历史分、EWMA 延迟、近期成功、连续失败惩罚的加权。
 * 成块移植自旧 getRegistryRouteScore / getRouteScore（两者共用同一核心，差异走 extraScore）。
 */
export function routeScore(
    endpointStats: RouteStats | undefined,
    options: RouteScoreOptions,
): number {
    let score = options.isPrimary ? 1 : 0;
    score += options.extraScore ?? 0;
    if (!endpointStats) return score;

    const total = endpointStats.successes + endpointStats.failures;
    if (total) {
        const successRate = endpointStats.successes / total;
        score += (successRate - 0.5) * 6;
        if (total >= 3 && successRate >= 0.8) score += 1.5;
        if (total >= 3 && successRate < 0.35) score -= 2;
    }
    score += endpointStats.score;
    score += Math.min(2, endpointStats.successes * 0.25);
    score -= Math.min(2, endpointStats.failures * 0.2);
    if (endpointStats.averageElapsed != null) {
        if (endpointStats.averageElapsed <= 300) score += 1.5;
        else if (endpointStats.averageElapsed <= options.fastThreshold) score += 1;
        else if (endpointStats.averageElapsed <= 1200) score += 0.5;
        else if (endpointStats.averageElapsed <= 2500) score -= 0.3;
        else if (endpointStats.averageElapsed <= 4000) score -= 1;
        else score -= 2;
    }
    if (
        endpointStats.lastSuccess &&
        (options.now ?? Date.now()) - endpointStats.lastSuccess <= 10 * MINUTE
    ) {
        score += 1.5;
    }
    score -= Math.min(5, (endpointStats.consecutiveFailures ?? 0) * 1.5);
    return score;
}

/** registry 的主端点慢速降级阈值（getFallbackDelay）：依据近期成功与失败次数收紧等待。 */
export function registryFallbackDelay(
    endpointStats: RouteStats | undefined,
    fastThreshold: number,
): number {
    if (!endpointStats) return fastThreshold;
    const recentSuccess =
        endpointStats.lastSuccess && Date.now() - endpointStats.lastSuccess <= 10 * MINUTE;
    if (!recentSuccess && endpointStats.failures >= 3) return 200;
    if (!recentSuccess && endpointStats.failures >= 2) return 400;
    if (endpointStats.averageElapsed != null) {
        if (endpointStats.averageElapsed > 4000) return 400;
        if (endpointStats.averageElapsed > 2500) return 600;
    }
    return fastThreshold;
}

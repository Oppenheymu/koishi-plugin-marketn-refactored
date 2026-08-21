import { clamp } from "../utils/math.js";

/** 端点学习型统计：npm registry 与市场索引共用（字段为两者超集）。 */
export interface RouteStats {
    score: number;
    successes: number;
    failures: number;
    consecutiveFailures?: number | undefined;
    averageElapsed?: number | undefined;
    lastSuccess?: number | undefined;
    /** registry 专用 */
    lastFailure?: number | undefined;
    lastFailureReason?: string | undefined;
    /** 市场索引专用 */
    contentEncoding?: string | undefined;
    cooldownUntil?: number | undefined;
}

export interface StatsPolicy {
    /** elapsed <= fastThreshold 记 +0.4，否则 +0.1 */
    fastThreshold: number;
    successClamp: readonly [number, number];
    failureClamp: readonly [number, number];
    /** 失败扣分；rescue 模式（市场索引）不延长冷却 */
    failurePenalty: (options: {
        reason?: string | undefined;
        rescue?: boolean | undefined;
    }) => number;
    /** 连续失败 n 次后的冷却时长；返回 0 表示无冷却（registry） */
    cooldown: (consecutiveFailures: number) => number;
    /** registry 对 EWMA 取整，市场索引保留小数——保持各自旧行为 */
    roundAverage: boolean;
    /** registry 记录 lastFailure/lastFailureReason，市场索引不记 */
    trackFailureMeta: boolean;
}

export class RouteStatsBook {
    readonly stats: Record<string, RouteStats> = {};
    private readonly policy: StatsPolicy;

    constructor(policy: StatsPolicy) {
        this.policy = policy;
    }

    get(endpoint: string): RouteStats | undefined {
        return this.stats[endpoint];
    }

    recordSuccess(
        endpoint: string,
        elapsed: number,
        options: { contentEncoding?: string | undefined } = {},
    ) {
        let stats = this.stats[endpoint];
        if (!stats) {
            stats = { score: 0, successes: 0, failures: 0 };
            this.stats[endpoint] = stats;
        }
        stats.successes++;
        stats.consecutiveFailures = 0;
        stats.cooldownUntil = undefined;
        stats.failures = Math.max(0, Math.floor(stats.failures * 0.6));
        stats.score = clamp(
            stats.score + (elapsed <= this.policy.fastThreshold ? 0.4 : 0.1),
            this.policy.successClamp[0],
            this.policy.successClamp[1],
        );
        stats.lastSuccess = Date.now();
        if (options.contentEncoding !== undefined) stats.contentEncoding = options.contentEncoding;
        stats.averageElapsed =
            stats.averageElapsed == null
                ? elapsed
                : this.policy.roundAverage
                  ? Math.round(stats.averageElapsed * 0.7 + elapsed * 0.3)
                  : stats.averageElapsed * 0.7 + elapsed * 0.3;
        return stats;
    }

    recordFailure(
        endpoint: string,
        options: { reason?: string | undefined; rescue?: boolean | undefined } = {},
    ) {
        let stats = this.stats[endpoint];
        if (!stats) {
            stats = { score: 0, successes: 0, failures: 0 };
            this.stats[endpoint] = stats;
        }
        stats.failures++;
        if (options.rescue) {
            stats.score = clamp(
                stats.score - this.policy.failurePenalty({ rescue: true }),
                this.policy.failureClamp[0],
                this.policy.failureClamp[1],
            );
        } else {
            stats.consecutiveFailures = (stats.consecutiveFailures ?? 0) + 1;
            const cooldown = this.policy.cooldown(stats.consecutiveFailures);
            if (cooldown > 0) stats.cooldownUntil = Date.now() + cooldown;
            stats.score = clamp(
                stats.score - this.policy.failurePenalty({ reason: options.reason }),
                this.policy.failureClamp[0],
                this.policy.failureClamp[1],
            );
        }
        if (this.policy.trackFailureMeta) {
            stats.lastFailure = Date.now();
            stats.lastFailureReason = options.reason;
        }
        return stats;
    }

    /** registry：端点切换时整体作废学习数据。 */
    reset() {
        for (const key of Object.keys(this.stats)) delete this.stats[key];
    }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RouteStatsBook, type StatsPolicy } from "../../../racing/stats.js";
import { DAY } from "../../../utils/time.js";
import { restoreRegistryStats, serializeRegistryStats } from "../stats-file.js";

const NOW = Date.parse("2026-01-01T00:00:00Z");

function makePolicy(): StatsPolicy {
    return {
        fastThreshold: 800,
        successClamp: [-6, 3] as const,
        failureClamp: [-6, 3] as const,
        failurePenalty: () => 1.5,
        cooldown: () => 0,
        roundAverage: true,
        trackFailureMeta: true,
    };
}

describe("serializeRegistryStats", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("导出评分收敛到 [-6, 3]", () => {
        const book = new RouteStatsBook(makePolicy());
        book.recordSuccess("a", 100);
        book.recordSuccess("a", 100);
        book.recordFailure("a", { reason: "timeout" });
        const serialized = serializeRegistryStats(book);
        expect(serialized["a"]).toMatchObject({
            score: expect.any(Number),
            successes: 2,
            failures: 1,
            consecutiveFailures: 1,
            averageElapsed: 100,
            lastSuccess: NOW,
            lastFailure: NOW,
            lastFailureReason: "timeout",
        });
        expect(serialized["a"]!.score).toBeGreaterThanOrEqual(-6);
        expect(serialized["a"]!.score).toBeLessThanOrEqual(3);
    });

    it("空 book 返回空对象", () => {
        expect(serializeRegistryStats(new RouteStatsBook(makePolicy()))).toEqual({});
    });
});

describe("restoreRegistryStats", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("新鲜 store 恢复学习数据", () => {
        const book = new RouteStatsBook(makePolicy());
        restoreRegistryStats(book, {
            version: 1,
            savedAt: NOW - 1000,
            stats: {
                a: { score: 1, successes: 5, failures: 2, consecutiveFailures: 3, averageElapsed: 300, lastSuccess: NOW - 1000 },
            },
        });
        expect(book.get("a")).toMatchObject({
            score: 1,
            successes: 5,
            failures: 2,
            consecutiveFailures: 0, // 近期有成功 → 连续失败清零
            averageElapsed: 300,
            lastSuccess: NOW - 1000,
        });
    });

    it("超过 30 天 TTL 不恢复", () => {
        const book = new RouteStatsBook(makePolicy());
        restoreRegistryStats(book, {
            version: 1,
            savedAt: NOW - 40 * DAY,
            stats: { a: { score: 1, successes: 1, failures: 0 } },
        });
        expect(book.get("a")).toBeUndefined();
    });

    it("版本不匹配不恢复", () => {
        const book = new RouteStatsBook(makePolicy());
        restoreRegistryStats(
            book,
            { version: 2, savedAt: NOW, stats: { a: { score: 1, successes: 1, failures: 0 } } } as never,
        );
        expect(book.get("a")).toBeUndefined();
    });

    it("近期有成功：失败数收敛、连续失败清零、分数宽松", () => {
        const book = new RouteStatsBook(makePolicy());
        restoreRegistryStats(book, {
            version: 1,
            savedAt: NOW,
            stats: {
                a: {
                    score: 5,
                    successes: 10,
                    failures: 20,
                    consecutiveFailures: 5,
                    lastSuccess: NOW - 1000,
                },
            },
        });
        const restored = book.get("a")!;
        expect(restored.score).toBe(3); // clamp(5, -1, 3)
        expect(restored.failures).toBe(5); // min(20, max(2, ceil(10/2)))
        expect(restored.consecutiveFailures).toBe(0);
    });

    it("无近期成功：失败数上限 12、分数更严格", () => {
        const book = new RouteStatsBook(makePolicy());
        restoreRegistryStats(book, {
            version: 1,
            savedAt: NOW,
            stats: {
                a: { score: -5, successes: 0, failures: 30, consecutiveFailures: 5 },
            },
        });
        const restored = book.get("a")!;
        expect(restored.score).toBe(-4); // clamp(-5, -4, 3)
        expect(restored.failures).toBe(12);
        expect(restored.consecutiveFailures).toBe(5);
    });
});

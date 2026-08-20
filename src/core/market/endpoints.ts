import { routeScore } from "../racing/score.js";
import type { RouteStatsBook } from "../racing/stats.js";
import { DAY } from "../utils/time.js";

export const DEFAULT_ENDPOINT = "https://registry.koishi.t4wefan.pub/index.json";
export const FALLBACK_ENDPOINTS = [
    "https://registry.koishi.t4wefan.pub/index.json",
    "https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json",
    "https://koi.nyan.zone/registry/index.json",
    "https://kp.itzdrli.cc",
    "https://koishi.itzdrli.cc",
    "https://registry.koishi.chat/index.json",
    "https://koishijs.github.io/registry/index.json",
    "https://raw.githubusercontent.com/koishijs/registry/release/index.json",
    "https://cdn.jsdelivr.net/gh/koishijs/registry@release/index.json",
    "https://ghproxy.net/https://raw.githubusercontent.com/koishijs/registry/release/index.json",
    "https://ghfast.top/https://raw.githubusercontent.com/koishijs/registry/release/index.json",
];

export interface MarketEndpointConfig {
    endpoint?: string | undefined;
    autoRoute?: boolean | undefined;
}

export interface MarketScoreContext {
    config: MarketEndpointConfig;
    stats: RouteStatsBook;
    /** 磁盘缓存条目（新鲜度加分）；无则传空对象 */
    cacheEntries: { [endpoint: string]: { fetchedAt: number } | undefined };
    now?: number;
}

/** 市场端点评分：共享评分核心 + 缓存新鲜度与压缩编码加分。 */
export function marketRouteScore(endpoint: string, context: MarketScoreContext) {
    const stats = context.stats.get(endpoint);
    const cached = context.cacheEntries[endpoint];
    let extraScore = 0;
    if (cached) {
        const age = (context.now ?? Date.now()) - cached.fetchedAt;
        extraScore += age <= DAY ? 1.5 : 0.5;
    }
    if (stats?.contentEncoding === "br") extraScore += 0.5;
    if (stats?.contentEncoding === "gzip") extraScore += 0.2;
    return routeScore(stats, {
        isPrimary: endpoint === context.config.endpoint,
        fastThreshold: 500,
        extraScore,
        now: context.now,
    });
}

export function getEndpointCandidates(config: MarketEndpointConfig) {
    return [config.endpoint, ...(config.autoRoute === false ? [] : FALLBACK_ENDPOINTS)].filter(
        (endpoint, index, array): endpoint is string =>
            !!endpoint && array.indexOf(endpoint) === index,
    );
}

export function isRouteCoolingDown(
    endpoint: string,
    config: MarketEndpointConfig,
    stats: RouteStatsBook,
    now?: number,
) {
    if (endpoint === config.endpoint) return false;
    const until = stats.get(endpoint)?.cooldownUntil;
    return !!until && (now ?? Date.now()) < until;
}

export function clearRouteCooldowns(stats: RouteStatsBook) {
    for (const item of Object.values(stats.stats)) {
        if (!item) continue;
        item.cooldownUntil = undefined;
        item.consecutiveFailures = 0;
    }
}

/** 竞速候选：主端点 + 未冷却镜像按评分排序（稳定排序保底原顺序）。 */
export function getRaceEndpoints(
    context: MarketScoreContext & { log?: { debug(message: string): void } },
) {
    const candidates = getEndpointCandidates(context.config);
    if (context.config.autoRoute === false) return candidates;
    const primary = candidates[0];
    if (!primary) return candidates;
    const fallbacks = candidates.slice(1);
    const available = fallbacks.filter(
        (endpoint) => !isRouteCoolingDown(endpoint, context.config, context.stats),
    );
    const originalIndex = new Map(fallbacks.map((endpoint, index) => [endpoint, index]));
    return [
        primary,
        ...available.sort((a, b) => {
            const delta = marketRouteScore(b, context) - marketRouteScore(a, context);
            if (delta) return delta;
            return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
        }),
    ];
}

/** 全部活跃端点失败后的救援候选：被冷却的端点。 */
export function getRescueEndpoints(activeEndpoints: string[], context: MarketScoreContext) {
    if (context.config.autoRoute === false) return [];
    const active = new Set(activeEndpoints);
    return getEndpointCandidates(context.config).filter((endpoint) => !active.has(endpoint));
}

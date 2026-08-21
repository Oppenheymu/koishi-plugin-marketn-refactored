import type { InstallFallbackCandidate } from "../../shared/types.js";
import type { RouteStatsBook } from "../racing/stats.js";
import { formatEndpointHost } from "../utils/format.js";

const REGISTRY_FALLBACK_ENDPOINTS = [
    "https://registry.npmmirror.com",
    "https://mirrors.cloud.tencent.com/npm",
    "https://mirrors.huaweicloud.com/repository/npm",
    "https://registry.npmjs.org",
    "https://r.cnpmjs.org",
];

export interface RegistryClientConfig {
    endpoint?: string | undefined;
    timeout?: number | undefined;
    autoRoute?: boolean | undefined;
    retry?: number | undefined;
}

export type RouteScoreFn = (endpoint: string) => number;

/** 去重后的候选端点：主端点 + （autoRoute 时的）镜像列表。 */
function registryEndpointCandidates(config: RegistryClientConfig, endpoint: string) {
    return [endpoint, ...(config.autoRoute === false ? [] : REGISTRY_FALLBACK_ENDPOINTS)].filter(
        (item, index, array): item is string => !!item && array.indexOf(item) === index,
    );
}

/** 探测候选：主端点 + 按评分排序的镜像（稳定排序保底原顺序）。 */
export function sortRouteProbeEndpoints(
    config: RegistryClientConfig,
    endpoint: string,
    score: RouteScoreFn,
) {
    const endpoints = registryEndpointCandidates(config, endpoint);
    if (config.autoRoute === false) return endpoints;
    const primary = endpoints[0];
    if (!primary) return endpoints;
    const fallbacks = endpoints.slice(1);
    const originalIndex = new Map(fallbacks.map((item, index) => [item, index]));
    return [
        primary,
        ...fallbacks.sort((a, b) => {
            const delta = score(b) - score(a);
            if (delta) return delta;
            return (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0);
        }),
    ];
}

/** 当前元数据端点降级判定：所选端点连续失败且分数显著低于主端点时回退主端点。 */
export function preferredMetadataEndpoint(options: {
    endpoint: string;
    metadataEndpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
    log: { debug(message: string): void };
}) {
    const { endpoint, metadataEndpoint, stats, score, log } = options;
    const selected = metadataEndpoint || endpoint;
    if (selected === endpoint) return selected;
    const selectedStats = stats.get(selected);
    if (!selectedStats) return selected;
    const primaryScore = score(endpoint);
    const selectedScore = score(selected);
    if (selectedStats.failures >= 2 && selectedScore + 1 < primaryScore) {
        log.debug(
            `demote npm metadata endpoint: selected=${selected}, selectedScore=${selectedScore.toFixed(1)}, primary=${endpoint}, primaryScore=${primaryScore.toFixed(1)}, failures=${selectedStats.failures}, lastFailure=${selectedStats.lastFailureReason ?? "-"}`,
        );
        return endpoint;
    }
    return selected;
}

/** 调试用路由评分表。 */
export function registryRouteScores(options: {
    config: RegistryClientConfig;
    endpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
    fallbackDelay: (endpoint: string) => number | undefined;
}) {
    return registryEndpointCandidates(options.config, options.endpoint).map((item) => ({
        endpoint: item,
        score: options.score(item),
        fallbackDelay: item === options.endpoint ? options.fallbackDelay(item) : undefined,
        ...options.stats.get(item),
    }));
}

/** 安装备用源推荐：排除失败端点与用户配置端点后按评分取最优。 */
export function installFallbackCandidate(options: {
    config: RegistryClientConfig;
    endpoint: string;
    stats: RouteStatsBook;
    score: RouteScoreFn;
}): InstallFallbackCandidate | undefined {
    const { config, endpoint, stats, score } = options;
    if (config.autoRoute === false) return undefined;
    const normalize = (item?: string) => item?.replace(/\/+$/, "");
    const failed = normalize(endpoint);
    const candidates = registryEndpointCandidates(config, endpoint)
        .filter((item) => normalize(item) !== failed)
        .filter((item) => normalize(item) !== normalize(config.endpoint))
        .map((item, index) => ({
            endpoint: item,
            index,
            score: score(item),
            stats: stats.get(item),
        }))
        .sort((a, b) => {
            const delta = b.score - a.score;
            if (delta) return delta;
            const successDelta = (b.stats?.lastSuccess ?? 0) - (a.stats?.lastSuccess ?? 0);
            if (successDelta) return successDelta;
            return a.index - b.index;
        });
    const candidate = candidates[0];
    if (!candidate) return undefined;
    return {
        endpoint: candidate.endpoint,
        label: formatEndpointHost(candidate.endpoint),
        reason: candidate.stats?.lastSuccess ? "最近可用的备用 npm 源" : "备用 npm 源",
    };
}

import { raceEndpoints } from "../racing/race.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { RouteStatsBook } from "../racing/stats.js";
import { formatError } from "../utils/format.js";
import type { MarketDiskCache } from "./cache-store.js";
import { getRaceEndpoints, getRescueEndpoints, type MarketScoreContext } from "./endpoints.js";
import {
    type EndpointFetchResult,
    type FetchEndpointDeps,
    fetchMarketEndpoint,
} from "./fetch-endpoint.js";
import type { MarketSourceDeps } from "./source-types.js";
import type { EndpointResult } from "./types.js";

const ROUTE_STAGGER = 80;
const FAST_ROUTE_THRESHOLD = 500;

export interface FetchIndexDeps extends FetchEndpointDeps {
    scope: RequestScope;
    stats: RouteStatsBook;
    scoreContext: () => MarketScoreContext;
    config: { endpoint?: string | undefined; autoRoute?: boolean | undefined };
    onEndpointSelected: (endpoint: string) => void;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
}

/** buildMarketFetchDeps 所需的源视图（MarketIndexSource 结构性子集）。 */
interface MarketFetchHostSource {
    readonly scope: RequestScope;
    readonly stats: RouteStatsBook;
    readonly config: { endpoint?: string | undefined; autoRoute?: boolean | undefined };
    endpoint: string;
    scoreContext(): MarketScoreContext;
    readonly cache: Pick<MarketDiskCache, "entries" | "loadEntryResult" | "conditionalHeaders">;
}

/** 把 MarketIndexSource 的公开状态适配为索引竞速所需的 FetchIndexDeps。 */
export function buildMarketFetchDeps(source: MarketFetchHostSource, deps: MarketSourceDeps) {
    return {
        http: deps.http as never,
        scope: source.scope,
        stats: source.stats,
        scoreContext: () => source.scoreContext(),
        config: source.config,
        onEndpointSelected: (endpoint: string) => {
            source.endpoint = endpoint;
        },
        getCachedEntry: (endpoint: string) => source.cache.entries[endpoint],
        loadCacheEntryResult: (entry: never) => source.cache.loadEntryResult(entry),
        conditionalHeaders: (endpoint: string) => source.cache.conditionalHeaders(endpoint),
        log: deps.log,
    };
}

/**
 * 索引竞速入口：活跃端点竞速，全败后启用冷却端点救援。
 * 移植自旧 MarketProvider.fetchIndex / fetchIndexFromEndpoints。
 */
export async function fetchMarketIndex(
    deps: FetchIndexDeps,
    serial: number,
): Promise<EndpointResult> {
    const endpoints = getRaceEndpoints(deps.scoreContext());
    const rescueEndpoints = getRescueEndpoints(endpoints, deps.scoreContext());
    try {
        return await raceIndexFrom(deps, serial, endpoints, {});
    } catch (error) {
        if (!rescueEndpoints.length || deps.scope.isStale(serial) || isInternalAbortError(error))
            throw error;
        deps.log.warn(
            `market active endpoints failed; retry cooled endpoints as rescue: active=${endpoints.join(", ")}, rescue=${rescueEndpoints.join(", ")}, error=${formatError(error)}`,
        );
        const result = await raceIndexFrom(deps, serial, rescueEndpoints, { rescue: true });
        result.preferredEndpoint = deps.config.endpoint;
        result.fallbackReason = "rescue";
        return result;
    }
}

function isInternalAbortError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /race settled|stale|disposed|aborted|abort/i.test(message);
}

async function raceIndexFrom(
    deps: FetchIndexDeps,
    serial: number,
    endpoints: string[],
    options: { rescue?: boolean },
): Promise<EndpointResult> {
    const routeMode = options.rescue ? "rescue" : "active";
    deps.log.info(
        `market route started: mode=${routeMode}, primary=${endpoints[0]}, fallbackCount=${Math.max(0, endpoints.length - 1)}, slowThreshold=${FAST_ROUTE_THRESHOLD}ms`,
    );

    const attempt = await raceEndpoints<EndpointFetchResult>({
        endpoints,
        stagger: ROUTE_STAGGER,
        slowThreshold: FAST_ROUTE_THRESHOLD,
        scope: deps.scope,
        serial,
        fetch: async (endpoint, signal) => {
            const payload = await fetchMarketEndpoint(
                deps,
                endpoint,
                endpoints.indexOf(endpoint),
                endpoints.length,
                serial,
                false,
                signal,
            );
            return { payload, elapsed: payload.elapsed };
        },
        onSuccess: (winner) => {
            deps.onEndpointSelected(winner.endpoint);
            const stats = deps.stats.recordSuccess(
                winner.endpoint,
                winner.elapsed,
                winner.payload.contentEncoding !== undefined
                    ? { contentEncoding: winner.payload.contentEncoding }
                    : {},
            );
            deps.log.debug(
                `market route success: endpoint=${winner.endpoint}, elapsed=${winner.elapsed}ms, source=${winner.payload.source}, score=${stats.score.toFixed(2)}`,
            );
        },
        onFailure: (endpoint, error) => {
            const reason = formatError(error);
            deps.stats.recordFailure(endpoint, { rescue: options.rescue });
            deps.log.debug(
                `market route failure: endpoint=${endpoint}, rescue=${!!options.rescue}, error=${reason}`,
            );
        },
        log: (message) => deps.log.debug(`market ${message}`),
    });

    const result: EndpointResult = {
        ...attempt.payload,
        endpoint: attempt.endpoint,
        elapsed: attempt.elapsed,
    };
    if (options.rescue) {
        result.fallbackReason = "rescue";
    } else if (attempt.fallbackReason) {
        result.fallbackReason = attempt.fallbackReason;
        deps.log.info(
            `market fallback endpoint selected: endpoint=${attempt.endpoint}, reason=${attempt.fallbackReason}`,
        );
    } else {
        deps.log.info(
            `market primary endpoint selected: endpoint=${attempt.endpoint}, source=${result.source}`,
        );
    }
    result.preferredEndpoint = deps.config.endpoint;
    return result;
}

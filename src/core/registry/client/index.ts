import type { RegistryStatus } from "../../../shared/types.js";
import type { RequestScope } from "../../racing/request-scope.js";
import { registryFallbackDelay, routeScore } from "../../racing/score.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { JsonStore } from "../../utils/json-store.js";
import {
    type RegistryStatsStore,
    restoreRegistryStats,
    serializeRegistryStats,
} from "../cache/stats-file.js";
import { formatRegistryError, type RegistryErrorDetail, type RegistryReason } from "../errors.js";
import type { Registry } from "../manifest.js";
import {
    installFallbackCandidate,
    preferredMetadataEndpoint,
    type RegistryClientConfig,
    registryRouteScores,
    sortRouteProbeEndpoints,
} from "./endpoints.js";
import { fetchRegistryWithRetry, type RegistryFetchHost } from "./fetch.js";
import { RouteProbe } from "./probe.js";
import {
    fetchRegistryByRoute,
    type RegistryHttpClient,
    type RegistryRouteDeps,
} from "./route-fetch.js";

const FAST_ROUTE_THRESHOLD = 800;

export type { RegistryHttpClient };

export interface RegistryClientDeps {
    httpFactory: (endpoint: string) => RegistryHttpClient;
    isHttpError: (error: unknown) => boolean;
    stats: RouteStatsBook;
    statsFile: JsonStore<RegistryStatsStore>;
    scope: RequestScope;
    defaultEndpoint: () => Promise<string>;
    statusSink: (name: string, status: Partial<RegistryStatus>, serial: number) => void;
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
}

/**
 * npm registry 元数据客户端：多端点竞速 + 学习型路由 + 重试。
 * 成块移植自旧 Installer 的路由相关方法，算法未改。
 */
export class RegistryClient implements RegistryFetchHost {
    endpoint = "";
    metadataEndpoint = "";
    private readonly deps: RegistryClientDeps;
    private readonly probe: RouteProbe;
    private readonly routeDeps: RegistryRouteDeps;
    public config: RegistryClientConfig;

    constructor(deps: RegistryClientDeps, config: RegistryClientConfig = {}) {
        this.deps = deps;
        this.config = config;
        this.probe = new RouteProbe({
            scope: deps.scope,
            log: deps.log,
            scoresSummary: () => JSON.stringify(this.getRouteScores().map((item) => item.endpoint)),
        });
        this.routeDeps = {
            httpFactory: deps.httpFactory,
            scope: deps.scope,
            log: deps.log,
            getFallbackDelay: (endpoint) => this.getFallbackDelay(endpoint),
            formatError: (error) => this.formatError(error),
            recordRouteSuccess: (result) => this.recordRouteSuccess(result),
            recordRouteFailure: (endpoint, reason) => this.recordRouteFailure(endpoint, reason),
        };
    }

    get scope() {
        return this.deps.scope;
    }

    formatError(error: unknown): RegistryErrorDetail {
        return formatRegistryError(error, this.deps.isHttpError);
    }

    async resetEndpoint() {
        const endpoint = this.config.endpoint || (await this.deps.defaultEndpoint());
        const previous = this.endpoint;
        this.endpoint = endpoint;
        this.metadataEndpoint = endpoint;
        this.probe.reset();
        if (previous && previous !== endpoint) {
            this.deps.stats.reset();
            this.deps.log.info(
                `npm registry endpoint changed: previous=${previous}, current=${endpoint}, routeStats=reset`,
            );
        }
    }

    async restoreStats(store: RegistryStatsStore | undefined) {
        restoreRegistryStats(this.deps.stats, store, (message) => this.deps.log.debug(message));
    }

    scheduleStatsWrite() {
        this.deps.statsFile.schedule(() => ({
            version: 1,
            stats: serializeRegistryStats(this.deps.stats),
            savedAt: Date.now(),
        }));
    }

    getRouteScore(endpoint: string) {
        return routeScore(this.deps.stats.get(endpoint), {
            isPrimary: endpoint === this.endpoint,
            fastThreshold: FAST_ROUTE_THRESHOLD,
        });
    }

    getFallbackDelay(endpoint: string) {
        return registryFallbackDelay(this.deps.stats.get(endpoint), FAST_ROUTE_THRESHOLD);
    }

    getInstallFallbackCandidate(failedEndpoint?: string) {
        return installFallbackCandidate({
            config: this.config,
            endpoint: failedEndpoint || this.endpoint,
            stats: this.deps.stats,
            score: (item) => this.getRouteScore(item),
        });
    }

    getRouteScores() {
        return registryRouteScores({
            config: this.config,
            endpoint: this.endpoint,
            stats: this.deps.stats,
            score: (item) => this.getRouteScore(item),
            fallbackDelay: (item) =>
                item === this.endpoint ? this.getFallbackDelay(item) : undefined,
        });
    }

    private recordRouteSuccess(result: { endpoint: string; elapsed: number }) {
        this.deps.stats.recordSuccess(result.endpoint, result.elapsed);
        this.scheduleStatsWrite();
    }

    private recordRouteFailure(endpoint: string, reason?: RegistryReason) {
        this.deps.stats.recordFailure(endpoint, { reason });
        this.scheduleStatsWrite();
    }

    async ensureMetadataEndpoint(name: string, serial: number) {
        const endpoints = sortRouteProbeEndpoints(this.config, this.endpoint, (item) =>
            this.getRouteScore(item),
        );
        await this.probe.ensure(name, endpoints, serial, (n, e, s) => this.fetchByRoute(n, e, s));
    }

    async getRegistry(
        name: string,
        serial = this.deps.scope.current,
    ): Promise<Registry | undefined> {
        return fetchRegistryWithRetry(name, serial, this);
    }

    get log() {
        return this.deps.log;
    }

    get statusSink() {
        return this.deps.statusSink;
    }

    get probeResult() {
        return this.probe.result;
    }

    setMetadataEndpoint(endpoint: string) {
        this.metadataEndpoint = endpoint;
    }

    retryEndpoints() {
        return [
            preferredMetadataEndpoint({
                endpoint: this.endpoint,
                metadataEndpoint: this.metadataEndpoint,
                stats: this.deps.stats,
                score: (item) => this.getRouteScore(item),
                log: this.deps.log,
            }),
            ...sortRouteProbeEndpoints(this.config, this.endpoint, (item) =>
                this.getRouteScore(item),
            ),
        ].filter(
            (endpoint, index, array): endpoint is string =>
                !!endpoint && array.indexOf(endpoint) === index,
        );
    }

    fetchByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ) {
        return fetchRegistryByRoute(this.routeDeps, name, endpoints, serial, onAttempt);
    }
}

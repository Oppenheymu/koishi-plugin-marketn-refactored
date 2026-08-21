import { shouldPenalizeRegistryRoute } from "../../../shared/dependency-source.js";
import type { RegistryStatus } from "../../../shared/types.js";
import { raceEndpoints } from "../../racing/race.js";
import type { RequestScope } from "../../racing/request-scope.js";
import { registryFallbackDelay, routeScore } from "../../racing/score.js";
import type { RouteStatsBook } from "../../racing/stats.js";
import type { JsonStore } from "../../utils/json-store.js";
import {
    type RegistryStatsStore,
    restoreRegistryStats,
    serializeRegistryStats,
} from "../cache/stats-file.js";
import {
    attachRegistryAttemptReasons,
    formatRegistryError,
    type RegistryErrorDetail,
    type RegistryReason,
} from "../errors.js";
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

const ROUTE_STAGGER = 120;
const FAST_ROUTE_THRESHOLD = 800;

export interface RegistryHttpClient {
    get(path: string, config?: { signal?: AbortSignal }): Promise<Registry>;
}

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
    public config: RegistryClientConfig;

    constructor(deps: RegistryClientDeps, config: RegistryClientConfig = {}) {
        this.deps = deps;
        this.config = config;
        this.probe = new RouteProbe({
            scope: deps.scope,
            log: deps.log,
            scoresSummary: () => JSON.stringify(this.getRouteScores().map((item) => item.endpoint)),
        });
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
        await this.probe.ensure(name, endpoints, serial, (n, e, s) =>
            this.fetchRegistryByRoute(n, e, s),
        );
    }

    private async fetchRegistryByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ) {
        let attempts = 0;
        const failureReasons: RegistryReason[] = [];
        return raceEndpoints<Registry>({
            endpoints,
            stagger: ROUTE_STAGGER,
            slowThreshold: this.getFallbackDelay(endpoints[0]!),
            scope: this.deps.scope,
            serial,
            fetch: (endpoint, signal) => this.fetchRegistryEndpoint(name, endpoint, serial, signal),
            onAttempt: (endpoint) => {
                attempts++;
                onAttempt?.(endpoint, attempts);
            },
            onSuccess: (attempt) => this.recordRouteSuccess(attempt),
            onFailure: (endpoint, error) => {
                const reason = this.formatError(error).reason;
                if (reason) failureReasons.push(reason);
                if (shouldPenalizeRegistryRoute(reason)) this.recordRouteFailure(endpoint, reason);
            },
            log: (message) => this.deps.log.debug(`npm registry ${message}`),
        }).catch((error: unknown) => {
            attachRegistryAttemptReasons(error, failureReasons);
            throw error;
        });
    }

    private async fetchRegistryEndpoint(
        name: string,
        endpoint: string,
        serial: number,
        signal?: AbortSignal,
    ): Promise<{ payload: Registry; elapsed: number }> {
        const attemptStart = Date.now();
        this.deps.log.debug(`fetch npm registry endpoint: package=${name}, endpoint=${endpoint}`);
        const registry = await this.deps
            .httpFactory(endpoint)
            .get(`/${name}`, signal ? { signal } : undefined);
        if (this.deps.scope.isStale(serial)) throw new Error("npm registry route probe stale");
        if (!registry?.versions || typeof registry.versions !== "object") {
            throw new Error(`invalid registry metadata for ${name}`);
        }
        const elapsed = Date.now() - attemptStart;
        this.deps.log.debug(
            `fetch npm registry endpoint succeeded: package=${name}, endpoint=${endpoint}, elapsed=${elapsed}ms, versions=${Object.keys(registry.versions).length}`,
        );
        return { payload: registry, elapsed };
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
        return this.fetchRegistryByRoute(name, endpoints, serial, onAttempt);
    }
}

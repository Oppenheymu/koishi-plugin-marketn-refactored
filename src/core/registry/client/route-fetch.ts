import { shouldPenalizeRegistryRoute } from "../../../shared/dependency-source.js";
import { raceEndpoints } from "../../racing/race.js";
import type { RequestScope } from "../../racing/request-scope.js";
import {
    attachRegistryAttemptReasons,
    type RegistryErrorDetail,
    type RegistryReason,
} from "../errors.js";
import type { Registry } from "../manifest.js";

export interface RegistryHttpClient {
    get(path: string, config?: { signal?: AbortSignal }): Promise<Registry>;
}

/** 路由竞速所需的客户端依赖面（RegistryClientDeps 的结构性子集 + 记分回调）。 */
export interface RegistryRouteDeps {
    httpFactory: (endpoint: string) => RegistryHttpClient;
    scope: RequestScope;
    log: { debug(message: string): void };
    getFallbackDelay(endpoint: string): number;
    formatError(error: unknown): RegistryErrorDetail;
    recordRouteSuccess(result: { endpoint: string; elapsed: number }): void;
    recordRouteFailure(endpoint: string, reason?: RegistryReason): void;
}

const ROUTE_STAGGER = 120;

/** 多端点竞速拉取 npm registry 元数据（旧 Installer 的 fetchRegistryByRoute）。 */
export async function fetchRegistryByRoute(
    deps: RegistryRouteDeps,
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
        slowThreshold: deps.getFallbackDelay(endpoints[0]!),
        scope: deps.scope,
        serial,
        fetch: (endpoint, signal) => fetchRegistryEndpoint(deps, name, endpoint, serial, signal),
        onAttempt: (endpoint) => {
            attempts++;
            onAttempt?.(endpoint, attempts);
        },
        onSuccess: (attempt) => deps.recordRouteSuccess(attempt),
        onFailure: (endpoint, error) => {
            const reason = deps.formatError(error).reason;
            if (reason) failureReasons.push(reason);
            if (shouldPenalizeRegistryRoute(reason)) deps.recordRouteFailure(endpoint, reason);
        },
        log: (message) => deps.log.debug(`npm registry ${message}`),
    }).catch((error: unknown) => {
        attachRegistryAttemptReasons(error, failureReasons);
        throw error;
    });
}

async function fetchRegistryEndpoint(
    deps: RegistryRouteDeps,
    name: string,
    endpoint: string,
    serial: number,
    signal?: AbortSignal,
): Promise<{ payload: Registry; elapsed: number }> {
    const attemptStart = Date.now();
    deps.log.debug(`fetch npm registry endpoint: package=${name}, endpoint=${endpoint}`);
    const registry = await deps
        .httpFactory(endpoint)
        .get(`/${name}`, signal ? { signal } : undefined);
    if (deps.scope.isStale(serial)) throw new Error("npm registry route probe stale");
    if (!registry?.versions || typeof registry.versions !== "object") {
        throw new Error(`invalid registry metadata for ${name}`);
    }
    const elapsed = Date.now() - attemptStart;
    deps.log.debug(
        `fetch npm registry endpoint succeeded: package=${name}, endpoint=${endpoint}, elapsed=${elapsed}ms, versions=${Object.keys(registry.versions).length}`,
    );
    return { payload: registry, elapsed };
}

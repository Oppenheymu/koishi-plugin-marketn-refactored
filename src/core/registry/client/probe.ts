import type { RaceAttempt } from "../../racing/race.js";
import type { RequestScope } from "../../racing/request-scope.js";
import type { Registry } from "../manifest.js";

export interface RouteProbeResult {
    serial: number;
    name: string;
    endpoint: string;
    registry: Registry;
    elapsed: number;
    fallbackReason?: "primary-failed" | "primary-slow" | undefined;
}

export interface RouteProbeDeps {
    scope: RequestScope;
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    /** 探测后的评分摘要（debug 日志） */
    scoresSummary: () => string;
}

type FetchByRoute = (
    name: string,
    endpoints: string[],
    serial: number,
) => Promise<RaceAttempt<Registry>>;

/**
 * 每个后端生命周期一次的元数据路由探测：用一个探针包竞速全部候选端点，
 * 选出后续请求默认走的 metadataEndpoint。移植自旧 Installer 的探测三方法。
 */
export class RouteProbe {
    task: Promise<void> | undefined;
    result: RouteProbeResult | undefined;
    private readonly deps: RouteProbeDeps;

    constructor(deps: RouteProbeDeps) {
        this.deps = deps;
    }

    reset() {
        this.task = undefined;
        this.result = undefined;
    }

    async ensure(name: string, endpoints: string[], serial: number, fetchByRoute: FetchByRoute) {
        if (!name || endpoints.length <= 1) return;
        if (!this.task) {
            this.task = this.probe(name, endpoints, serial, fetchByRoute);
        }
        await this.task;
    }

    private async probe(
        name: string,
        endpoints: string[],
        serial: number,
        fetchByRoute: FetchByRoute,
    ) {
        const start = Date.now();
        this.deps.log.info(
            `npm registry route probe started: probe=${name}, primary=${endpoints[0]}, fallbackCount=${Math.max(0, endpoints.length - 1)}`,
        );
        try {
            const result = await fetchByRoute(name, endpoints, serial);
            if (this.deps.scope.isStale(serial)) return;
            this.apply(name, result, serial, start);
        } catch {
            if (this.deps.scope.isStale(serial)) return;
            this.deps.log.warn(
                `npm registry route probe failed: probe=${name}, candidates=${endpoints.length}, elapsed=${Date.now() - start}ms`,
            );
        }
    }

    private apply(name: string, result: RaceAttempt<Registry>, serial: number, start: number) {
        this.result = {
            serial,
            name,
            endpoint: result.endpoint,
            registry: result.payload,
            elapsed: result.elapsed,
            fallbackReason: result.fallbackReason,
        };
        if (result.fallbackReason) {
            this.deps.log.info(
                `npm registry fallback selected: probe=${name}, endpoint=${result.endpoint}, reason=${result.fallbackReason}, elapsed=${result.elapsed}ms, total=${Date.now() - start}ms`,
            );
        } else {
            this.deps.log.info(
                `npm registry primary selected: probe=${name}, endpoint=${result.endpoint}, elapsed=${result.elapsed}ms, total=${Date.now() - start}ms`,
            );
        }
        this.deps.log.debug(`npm registry route scores after probe: ${this.deps.scoresSummary()}`);
    }
}

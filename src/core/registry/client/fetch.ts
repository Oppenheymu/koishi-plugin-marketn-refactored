import { getRegistryAttemptReasons } from "../../../shared/dependency-source.js";
import type { RegistryStatus } from "../../../shared/types.js";
import type { RaceAttempt } from "../../racing/race.js";
import type { RegistryErrorDetail, RegistryReason } from "../errors.js";
import { mergeFailureDetail } from "../errors.js";
import type { Registry } from "../manifest.js";
import type { RouteProbeResult } from "./probe.js";

export interface RegistryFetchHost {
    scope: { isStale(serial: number): boolean; current: number };
    config: { retry?: number | undefined };
    log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    formatError(error: unknown): RegistryErrorDetail;
    statusSink: (name: string, status: Partial<RegistryStatus>, serial: number) => void;
    ensureMetadataEndpoint(name: string, serial: number): Promise<void>;
    readonly probeResult: RouteProbeResult | undefined;
    readonly metadataEndpoint: string;
    setMetadataEndpoint(endpoint: string): void;
    retryEndpoints(): string[];
    fetchByRoute(
        name: string,
        endpoints: string[],
        serial: number,
        onAttempt?: (endpoint: string, attempts: number) => void,
    ): Promise<RaceAttempt<Registry>>;
}

/**
 * 带重试的元数据获取主循环（旧 Installer.getRegistry 主体）：
 * 预热路由探测 → 复用探测负载 → 逐轮竞速 → 失败归因上抛。
 */
export async function fetchRegistryWithRetry(
    name: string,
    serial: number,
    host: RegistryFetchHost,
): Promise<Registry | undefined> {
    const start = Date.now();
    const maxRetry = Math.max(0, host.config.retry ?? 1);
    let attempts = 0;
    let lastError: unknown;
    let lastEndpoint = host.metadataEndpoint;
    const failureReasons: RegistryReason[] = [];
    host.statusSink(
        name,
        {
            loading: true,
            error: undefined,
            reason: undefined,
            endpoint: lastEndpoint,
            attempts,
            elapsed: undefined,
        },
        serial,
    );

    await host.ensureMetadataEndpoint(name, serial);
    if (host.scope.isStale(serial)) return undefined;

    const probeResult = host.probeResult;
    if (
        probeResult?.serial === serial &&
        probeResult.name === name &&
        probeResult.endpoint === host.metadataEndpoint
    ) {
        attempts = 1;
        host.statusSink(
            name,
            {
                loading: false,
                error: undefined,
                reason: undefined,
                endpoint: probeResult.endpoint,
                attempts,
                elapsed: Date.now() - start,
            },
            serial,
        );
        host.log.debug(
            `reuse npm registry route probe payload for ${name}: endpoint=${probeResult.endpoint}, probeElapsed=${probeResult.elapsed}ms`,
        );
        return probeResult.registry;
    }

    for (let retry = 0; retry <= maxRetry; retry++) {
        const endpoints = host.retryEndpoints();
        host.log.debug(
            `registry metadata candidates for ${name}: endpoints=${endpoints.join(", ")}, retry=${retry + 1}/${maxRetry + 1}`,
        );
        try {
            const result = await host.fetchByRoute(name, endpoints, serial, (endpoint) => {
                attempts++;
                lastEndpoint = endpoint;
                host.statusSink(name, { loading: true, endpoint, attempts }, serial);
            });
            if (host.scope.isStale(serial)) return undefined;
            if (result.endpoint !== host.metadataEndpoint) {
                host.log.info(
                    `npm registry route selected for ${name}: endpoint=${result.endpoint}, previous=${host.metadataEndpoint}, reason=${result.fallbackReason ?? "same-priority"}, elapsed=${result.elapsed}ms`,
                );
                host.setMetadataEndpoint(result.endpoint);
            }
            host.statusSink(
                name,
                {
                    loading: false,
                    error: undefined,
                    reason: undefined,
                    endpoint: result.endpoint,
                    attempts,
                    elapsed: Date.now() - start,
                },
                serial,
            );
            return result.payload;
        } catch (error) {
            lastError = error;
            const detail = host.formatError(error);
            failureReasons.push(
                ...getRegistryAttemptReasons(error, detail.reason).filter(
                    (reason): reason is RegistryReason => !!reason,
                ),
            );
            host.log.debug(
                `failed routed registry metadata for ${name}, attempt=${retry + 1}/${maxRetry + 1}, endpoint=${lastEndpoint}, attempts=${attempts}: ${detail.error}`,
            );
            if (retry < maxRetry) await sleep(300 * (retry + 1));
        }
    }
    reportFetchFailure(name, lastError, failureReasons, lastEndpoint, attempts, start, host);
    throw lastError ?? new Error(`failed to fetch registry metadata for ${name}`);
}

function reportFetchFailure(
    name: string,
    lastError: unknown,
    failureReasons: RegistryReason[],
    lastEndpoint: string,
    attempts: number,
    start: number,
    host: RegistryFetchHost,
) {
    const detail = host.formatError(lastError);
    const finalDetail = mergeFailureDetail(detail, failureReasons);
    host.statusSink(
        name,
        {
            loading: false,
            reason: finalDetail.reason,
            error: finalDetail.error,
            endpoint: lastEndpoint,
            attempts,
            elapsed: Date.now() - start,
        },
        host.scope.current,
    );
    host.log.warn(`failed to fetch registry metadata for ${name}: ${detail.error}`);
    if (lastError && typeof lastError === "object") {
        Object.defineProperty(lastError, "marketNextReason", {
            value: finalDetail.reason,
            configurable: true,
        });
        Object.defineProperty(lastError, "marketNextReasons", {
            value: failureReasons,
            configurable: true,
        });
    }
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

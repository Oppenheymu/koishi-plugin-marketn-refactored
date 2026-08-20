import type { SearchObject, SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance } from "../../shared/types.js";
import { waitFor } from "../utils/async.js";
import { formatError } from "../utils/format.js";

const FIRST_PAYLOAD_TIMEOUT = 1500;

/** getSnapshot 的宿主接口：source 状态的只读视图 + 任务句柄。 */
export interface SnapshotHost {
    hasCurrentData(): boolean;
    isModern(): boolean;
    endpointLabel(): string;
    fallbackEndpointLabel(): string;
    dataVersion: number;
    backgroundRunning(): boolean;
    backgroundTask(): Promise<void> | undefined;
    warmCacheTask(): Promise<boolean> | undefined;
    warmCache(reason: string): Promise<boolean>;
    prepareTask(): Promise<SearchResult | undefined>;
    scheduleRefreshAfterPrepare(task: Promise<unknown>): void;
    buildData(): Dict<SearchObject>;
    buildPayload(): MarketSnapshotInput;
    failedCount(): number;
    scannerTotal(): number;
    scannerProgress(): number;
    payload(): MarketSnapshotInput | undefined;
    setPayload(payload: MarketSnapshotInput): void;
    error(): unknown;
    debugInfo(timings?: Dict<number>): MarketPerformance | undefined;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
}

export interface MarketSnapshotInput {
    registry?: string | undefined;
    data?: Dict<SearchObject> | undefined;
    dataVersion?: number | undefined;
    total: number;
    failed: number;
    progress: number;
    gravatar?: string | undefined;
    stale?: boolean | undefined;
    error?: string | undefined;
    cached?: boolean | undefined;
    cachedAt?: number | undefined;
    validatedAt?: number | undefined;
    serverNow?: number | undefined;
    refreshing?: boolean | undefined;
    loading?: boolean | undefined;
    debug?: MarketPerformance | undefined;
}

/**
 * getSnapshot 快照组装：后台任务复用 → 缓存 payload → 磁盘缓存预热等待 →
 * 首次网络等待 → 错误降级。移植自旧 MarketProvider.getSnapshot/createPayload。
 */
export async function buildMarketSnapshot(host: SnapshotHost): Promise<MarketSnapshotInput> {
    const start = Date.now();
    if (host.backgroundRunning() && host.hasCurrentData()) {
        if (host.isModern()) return host.buildPayload();
        const current = host.payload();
        return {
            ...(current ?? emptyPayload(host, start)),
            stale: false,
            error: undefined,
            refreshing: true,
            loading: false,
            dataVersion: host.dataVersion,
            serverNow: Date.now(),
        };
    }
    const current = host.payload();
    if (current && !host.error()) {
        return {
            ...current,
            dataVersion: host.dataVersion,
            serverNow: Date.now(),
            debug: host.debugInfo(),
        };
    }
    if (!host.hasCurrentData()) {
        const warmTask = host.warmCacheTask();
        if (warmTask) {
            const ready = await waitFor(warmTask, FIRST_PAYLOAD_TIMEOUT);
            if (ready && host.hasCurrentData()) return host.buildPayload();
        } else {
            const ready = await host.warmCache("first get").then(
                () => true,
                () => false,
            );
            if (ready && host.hasCurrentData()) return host.buildPayload();
        }
    }
    const task = host.prepareTask();
    if (!host.hasCurrentData()) {
        const ready = await waitFor(
            task,
            Math.max(0, FIRST_PAYLOAD_TIMEOUT - (Date.now() - start)),
        );
        if (host.hasCurrentData()) {
            host.log.debug(
                `return market payload after first-load wait, elapsed=${Date.now() - start}ms`,
            );
            return host.buildPayload();
        }
        if (!ready) {
            host.scheduleRefreshAfterPrepare(task);
            host.log.info(
                `market first payload still waiting for network: elapsed=${Date.now() - start}ms`,
            );
            return {
                ...emptyPayload(host, start),
                refreshing: true,
                loading: true,
                debug: host.debugInfo({ total: Date.now() - start }),
            };
        }
    } else {
        await task;
    }
    const error = host.error();
    if (error) {
        const cachedPayload = host.payload();
        if (cachedPayload) {
            const message = formatError(error);
            host.log.warn(
                `market load failed; returning previous payload: total=${cachedPayload.total}, error=${message}`,
            );
            return {
                ...cachedPayload,
                stale: true,
                error: message,
                refreshing: false,
                loading: false,
                dataVersion: host.dataVersion,
                serverNow: Date.now(),
                debug: host.debugInfo(),
            };
        }
        return {
            ...emptyPayload(host, start),
            error: formatError(error),
            refreshing: false,
            loading: false,
            debug: host.debugInfo(),
        };
    }
    return host.buildPayload();
}

function emptyPayload(host: SnapshotHost, start: number): MarketSnapshotInput {
    return {
        registry: host.fallbackEndpointLabel(),
        data: {},
        failed: 0,
        total: 0,
        progress: 0,
        stale: false,
        error: undefined,
        cached: false,
        refreshing: false,
        loading: false,
        dataVersion: host.dataVersion,
        serverNow: Date.now(),
        debug: host.debugInfo({ total: Date.now() - start }),
    };
}

/** 命中数据后的标准 payload 组装（createPayload）。 */
export function assemblePayload(
    host: SnapshotHost,
    options: { refreshing: boolean; cacheMeta?: CacheMetaView | undefined },
): MarketSnapshotInput {
    const payloadStart = Date.now();
    const dataStart = Date.now();
    const data = host.buildData();
    const dataElapsed = Date.now() - dataStart;
    const payload: MarketSnapshotInput = {
        registry: host.endpointLabel(),
        data,
        dataVersion: host.dataVersion,
        failed: host.isModern() ? 0 : host.failedCount(),
        total: host.scannerTotal(),
        progress: host.isModern() ? host.scannerTotal() : host.scannerProgress(),
        gravatar: process.env["GRAVATAR_MIRROR"],
        stale: false,
        error: undefined,
        cached: !!options.cacheMeta,
        cachedAt: options.cacheMeta?.fetchedAt,
        validatedAt: options.cacheMeta?.validatedAt,
        serverNow: Date.now(),
        refreshing: options.refreshing,
        loading: false,
        debug: host.debugInfo({ payloadData: dataElapsed, payload: Date.now() - payloadStart }),
    };
    host.setPayload(payload);
    return payload;
}

export interface CacheMetaView {
    fetchedAt?: number | undefined;
    validatedAt?: number | undefined;
}

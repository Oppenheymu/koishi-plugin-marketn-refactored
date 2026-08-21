import type { SearchObject, SearchResult } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPayload, MarketPerformance } from "../../shared/types.js";
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

/** getSnapshot 的 payload 结构：与 shared/types 的 MarketPayload 完全一致（fallow 重复报告驱动统一）。 */
export type MarketSnapshotInput = MarketPayload;

/** 后台任务运行中：复用数据源 payload 或组装 refreshing 快照。 */
function buildBackgroundPayload(
    host: SnapshotHost,
    start: number,
): MarketSnapshotInput | undefined {
    if (!host.backgroundRunning() || !host.hasCurrentData()) return;
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

/** 已有无错误 payload：刷新时间戳与调试信息后直接返回。 */
function buildCurrentPayload(host: SnapshotHost): MarketSnapshotInput | undefined {
    const current = host.payload();
    if (!current || host.error()) return;
    return {
        ...current,
        dataVersion: host.dataVersion,
        serverNow: Date.now(),
        debug: host.debugInfo(),
    };
}

/** 首次加载：等待磁盘缓存预热任务（有 warm 任务则限时等待，否则直接触发预热）。 */
async function warmCacheForFirstPayload(host: SnapshotHost): Promise<boolean> {
    const warmTask = host.warmCacheTask();
    if (warmTask) return waitFor(warmTask, FIRST_PAYLOAD_TIMEOUT);
    return host.warmCache("first get").then(
        () => true,
        () => false,
    );
}

/** 首次网络等待：限时等待 prepareTask，返回是否就绪/已有数据。 */
async function waitForFirstPayload(
    host: SnapshotHost,
    task: Promise<SearchResult | undefined>,
    start: number,
): Promise<{ ready: boolean; hasData: boolean }> {
    const ready = await waitFor(task, Math.max(0, FIRST_PAYLOAD_TIMEOUT - (Date.now() - start)));
    const hasData = host.hasCurrentData();
    if (hasData) {
        host.log.debug(
            `return market payload after first-load wait, elapsed=${Date.now() - start}ms`,
        );
    }
    return { ready, hasData };
}

/** 加载失败降级：有旧 payload 则标记 stale 返回，否则返回空 payload + 错误信息。 */
function buildErrorPayload(host: SnapshotHost, start: number): MarketSnapshotInput {
    const error = host.error();
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

/**
 * getSnapshot 快照组装：后台任务复用 → 缓存 payload → 磁盘缓存预热等待 →
 * 首次网络等待 → 错误降级。移植自旧 MarketProvider.getSnapshot/createPayload。
 */
export async function buildMarketSnapshot(host: SnapshotHost): Promise<MarketSnapshotInput> {
    const start = Date.now();
    const background = buildBackgroundPayload(host, start);
    if (background) return background;
    const current = buildCurrentPayload(host);
    if (current) return current;
    if (!host.hasCurrentData()) {
        const ready = await warmCacheForFirstPayload(host);
        if (ready && host.hasCurrentData()) return host.buildPayload();
    }
    const task = host.prepareTask();
    if (!host.hasCurrentData()) {
        const { ready, hasData } = await waitForFirstPayload(host, task, start);
        if (hasData) return host.buildPayload();
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
    if (host.error()) return buildErrorPayload(host, start);
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

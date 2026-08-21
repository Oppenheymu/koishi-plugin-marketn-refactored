import type { MarketPerformanceSnapshot } from "../../../shared/types.js";
import { shortHash } from "../../utils/format.js";
import { assemblePayload, type SnapshotHost } from "../snapshot.js";
import type { EndpointResult } from "../types.js";
import type { MarketIndexSource } from "./index.js";

/** 端点结果 → 性能快照（market debug 卡的数据来源）。 */
export function performanceFrom(
    result: EndpointResult,
    objects: number,
): MarketPerformanceSnapshot {
    return {
        source: result.source,
        endpoint: result.endpoint,
        preferredEndpoint: result.preferredEndpoint,
        fallbackReason: result.fallbackReason,
        candidates: result.candidates,
        size: result.size,
        wireSize: result.wireSize,
        contentEncoding: result.contentEncoding,
        objects,
        hash: shortHash(result.hash),
        etag: result.etag,
        lastModified: result.lastModified,
        cachedAt: result.cachedAt,
        validatedAt: result.validatedAt,
        timings: result.timings,
    };
}

/** 把 MarketIndexSource 适配为 getSnapshot 所需的 SnapshotHost（原 source.host()）。 */
export function createSourceSnapshotHost(source: MarketIndexSource): SnapshotHost {
    return {
        hasCurrentData: () => source.hasCurrentData(),
        isModern: () => true,
        endpointLabel: () => source.endpoint,
        fallbackEndpointLabel: () => source.endpoint || source.config.endpoint || "",
        dataVersion: source.dataVersionValue,
        backgroundRunning: () => !!source.backgroundTask,
        backgroundTask: () => source.backgroundTask,
        warmCacheTask: () => source.warmDiskCacheTask,
        warmCache: (reason) => source.warmDiskCache(reason),
        prepareTask: () => source.prepareTask(),
        scheduleRefreshAfterPrepare: (task) => source.scheduleRefreshAfterPrepare(task),
        buildData: () =>
            Object.fromEntries(source.scanner.objects.map((item) => [item.package.name, item])),
        buildPayload: () =>
            assemblePayload(createSourceSnapshotHost(source), {
                refreshing: !!source.backgroundTask,
                cacheMeta:
                    source.cacheMetaPresent && source.cache.meta
                        ? {
                              fetchedAt: source.cache.meta.fetchedAt,
                              validatedAt: source.cache.meta.validatedAt,
                          }
                        : undefined,
            }),
        failedCount: () => source.failedCount(),
        scannerTotal: () => source.scanner.total,
        scannerProgress: () => source.scanner.progress,
        payload: () => source.payloadValue,
        setPayload: (payload) => {
            source.payloadValue = payload;
        },
        error: () => source.error,
        debugInfo: (timings) => source.exportedDebug(timings),
        log: source.log,
    };
}

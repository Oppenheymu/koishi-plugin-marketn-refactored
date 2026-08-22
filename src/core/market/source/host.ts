/**
 * @file 端点结果转换与快照宿主适配(core/market/source 域)。
 *
 * 职责:performanceFrom 把 EndpointResult 转成对外展示的性能快照;
 * createSourceSnapshotHost 把 MarketIndexSource 的公开状态适配为
 * snapshot.ts 需要的 SnapshotHost 接口(原 source.host()),
 * 让快照组装逻辑不依赖具体源实现。
 */
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
        // 本源总是现代版本(带 version 的索引);legacy host 由别处提供
        isModern: () => true,
        endpointLabel: () => source.endpoint,
        fallbackEndpointLabel: () => source.endpoint || source.config.endpoint || "",
        dataVersion: source.dataVersionValue,
        revision: source.revisionValue,
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
                // 只有缓存元数据已回放(未被网络刷新覆盖)时才随快照带缓存时间
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

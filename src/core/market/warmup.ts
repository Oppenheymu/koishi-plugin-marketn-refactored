import type { SearchResult } from "@koishijs/registry";
import type { MarketPerformanceSnapshot } from "../../shared/types.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { ScannerLike } from "../registry/manifest.js";
import { shortHash } from "../utils/format.js";
import type { MarketDiskCache } from "./cache-store.js";

/** 磁盘缓存预热所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketWarmupSource {
    readonly scope: RequestScope;
    readonly cache: MarketDiskCache;
    readonly scanner: ScannerLike;
    warmDiskCacheTask: Promise<boolean> | undefined;
    cacheMetaPresent: boolean;
    applyIndex(result: SearchResult, endpoint: string, contentHash?: string): void;
    updateDebugInfo(info: MarketPerformanceSnapshot, phase?: "initial" | "refresh"): void;
    notifyRefresh(): unknown;
}

/** 磁盘缓存预热（单飞 + 过期序号守卫）。 */
export async function warmDiskCache(source: MarketWarmupSource, reason: string) {
    if (source.warmDiskCacheTask) return source.warmDiskCacheTask;
    const serial = source.scope.current;
    source.warmDiskCacheTask = applyDiskCache(source, serial)
        .then((loaded) => {
            if (loaded) {
                void source.notifyRefresh();
            }
            return loaded;
        })
        .finally(() => {
            source.warmDiskCacheTask = undefined;
        });
    void reason;
    return source.warmDiskCacheTask;
}

/** 应用磁盘缓存到内存索引；调用方需自行校验 serial 新鲜度。 */
export async function applyDiskCache(source: MarketWarmupSource, serial: number) {
    const warmTask = source.warmDiskCacheTask;
    if (warmTask) {
        const warmed = await warmTask;
        if (warmed && !source.scope.isStale(serial)) return true;
    }
    const { applied } = await source.cache.load();
    if (!applied) return false;
    if (source.scope.isStale(serial)) return false;
    source.applyIndex(applied.result, applied.endpoint, applied.hash);
    source.cacheMetaPresent = true;
    source.updateDebugInfo(
        {
            source: "disk-cache",
            endpoint: applied.endpoint,
            objects: source.scanner.total,
            hash: shortHash(applied.hash),
            cachedAt: applied.fetchedAt,
            timings: {},
        },
        "initial",
    );
    return true;
}

import type { SearchObject } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance } from "../../../shared/types.js";
import { formatError } from "../../utils/format.js";
import { applyDiskCache, type MarketWarmupSource } from "../cache/warmup.js";
import { formatSnapshot } from "../format.js";
import type { EndpointResult } from "../types.js";
import type { MarketBackgroundRefresher } from "./background.js";
import { performanceFrom } from "./host.js";
import type { MarketSourceDeps } from "./types.js";

/** collect 主流程所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketCollectSource extends MarketWarmupSource {
    readonly background: MarketBackgroundRefresher;
    readonly log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    /** 跨文件状态：collect 编排与广播补片共用。 */
    failed: string[];
    fullCache: Dict<SearchObject>;
    tempCache: Dict<SearchObject>;
    debugInfoValue: MarketPerformance | undefined;
    forceRefresh: boolean;
    readonly deps: Pick<
        MarketSourceDeps,
        "notifyRefresh" | "onRegistryVersions" | "broadcastPatch"
    >;
    fetchAndApply(
        serial: number,
        phase: "initial" | "refresh",
    ): Promise<EndpointResult | undefined>;
}

/** 旧版 collect：磁盘缓存优先，否则网络；legacy 索引补分析。 */
export async function collectMarketIndex(source: MarketCollectSource): Promise<undefined> {
    const serial = source.scope.current;
    const start = Date.now();
    source.failed = [];
    source.fullCache = {};
    source.tempCache = {};
    if (!source.forceRefresh && (await applyDiskCache(source, serial))) {
        source.background.refreshInBackground(serial, "cache-first");
        void source.deps.notifyRefresh();
        return undefined;
    }
    const result = await source.fetchAndApply(serial, "initial");
    if (source.scope.isStale(serial) || !result) return undefined;
    source.updateDebugInfo(performanceFrom(result, source.scanner.total), "initial");
    if (!source.scanner.version) {
        await analyzeLegacy(source);
    }
    source.log.info(
        `market index ready: ${formatSnapshot(performanceFrom(result, source.scanner.total))}, elapsed=${Date.now() - start}ms`,
    );
    return undefined;
}

async function analyzeLegacy(source: MarketCollectSource) {
    const analyzeStart = Date.now();
    await source.scanner.analyze({
        version: "4",
        onFailure: (name: string, reason: unknown) => {
            source.failed.push(name);
            source.log.debug(`failed to analyze package ${name}: ${formatError(reason)}`);
        },
        onRegistry: (registry: { name: string }, versions: unknown[]) => {
            source.deps.onRegistryVersions(registry.name, versions);
        },
        onSuccess: (object: SearchObject) => {
            source.fullCache[object.package.name] = source.tempCache[object.package.name] = object;
        },
        after: () => flushMarketPatch(source),
    });
    source.log.debug(
        `legacy analyze completed: success=${Object.keys(source.fullCache).length}, failed=${source.failed.length}, elapsed=${Date.now() - analyzeStart}ms`,
    );
}

/** 广播自上次 flush 以来的分析补片（market/patch）。 */
export function flushMarketPatch(source: MarketCollectSource) {
    if (!Object.keys(source.tempCache).length) return;
    source.deps.broadcastPatch({
        data: source.tempCache,
        failed: source.failed.length,
        total: source.scanner.total,
        progress: source.scanner.progress,
        debug: source.debugInfoValue ?? undefined,
    });
    source.tempCache = {};
}

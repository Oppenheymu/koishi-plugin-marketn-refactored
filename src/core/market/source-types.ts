import type { SearchObject } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { MarketPerformance } from "../../shared/types.js";
import { RouteStatsBook } from "../racing/stats.js";

export interface MarketSourceConfig {
    endpoint?: string | undefined;
    timeout?: number | undefined;
    autoRoute?: boolean | undefined;
    logLevel?: string | undefined;
}

export interface MarketSourceDeps {
    /** koishi HTTP 适配（按端点创建） */
    http: (endpoint: string) => { getText: never } | never;
    scannerRequest: (url: string, config?: { timeout?: number }) => Promise<unknown>;
    cacheFile: string;
    cacheDir: string;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
    /** console.refresh('market') 等价物 */
    notifyRefresh: () => Promise<unknown> | unknown;
    /** market/patch 广播（节流在适配层） */
    broadcastPatch: (payload: {
        data: Dict<SearchObject>;
        total: number;
        progress: number;
        failed: number;
        debug?: MarketPerformance | undefined;
    }) => void;
    /** legacy 分析阶段把 registry 版本喂回 installer.setPackage */
    onRegistryVersions: (name: string, versions: unknown[]) => void;
}

/** 市场索引路由统计：乐观成功 + 阶梯冷却（旧 MarketProvider 的调参，成块移植）。 */
export function createMarketRouteStatsBook() {
    return new RouteStatsBook({
        fastThreshold: 500,
        successClamp: [-6, 3],
        failureClamp: [-10, 3],
        failurePenalty: (options) => (options.rescue ? 0.25 : 1.2),
        cooldown: (failures) =>
            failures <= 0
                ? 0
                : failures === 1
                  ? 60_000
                  : failures === 2
                    ? 300_000
                    : failures === 3
                      ? 1_800_000
                      : failures === 4
                        ? 14_400_000
                        : 43_200_000,
        roundAverage: false,
        trackFailureMeta: false,
    });
}

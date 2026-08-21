import type { Context } from "koishi";
import type { Config } from "../../config/index.js";
import type { MarketDataStore } from "../../market/data-store.js";
import type { MarketSnapshotTransport } from "../../market/snapshot-transport.js";
import { registerInstallListeners } from "./install.js";
import { registerMarketListeners } from "./market.js";
import { registerUploadListeners } from "./upload.js";

/** 注册全部 market/* console listener（按 install/upload/market 三组拆分）。 */
export function registerListeners(
    ctx: Context,
    config: Config,
    dataStore: MarketDataStore,
    marketSnapshotTransport: MarketSnapshotTransport,
) {
    registerInstallListeners(ctx, dataStore);
    registerUploadListeners(ctx);
    registerMarketListeners(ctx, config, dataStore, marketSnapshotTransport);
}

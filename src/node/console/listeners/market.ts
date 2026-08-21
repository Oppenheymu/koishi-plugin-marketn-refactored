import type { Context } from "koishi";
import pMap from "p-map";
import type { PackageVersions } from "../../../core/registry/cache/index.js";
import type { MarketSnapshotResponse } from "../../../shared/types.js";
import { fetchAvatar } from "../../avatar/index.js";
import type { Config } from "../../config/index.js";
import { updateMarketNextConfig } from "../../config/manage.js";
import { ensurePluginConfig } from "../../config/plugin-configs.js";
import { removeBundleConfigs } from "../../market/bundle.js";
import type { MarketDataStore } from "../../market/data-store.js";
import type { MarketProvider } from "../../market/index.js";
import type { MarketSnapshotTransport } from "../../market/snapshot-transport.js";
import { assertContract } from "../contracts.js";
import { lookupMarket } from "../lookup.js";
import { refreshConsole, registerContractListener } from "./helpers.js";

/** 市场查询/配置类 listener：环境快照、配置与数据补丁、索引查询、头像。 */
export function registerMarketListeners(
    ctx: Context,
    config: Config,
    dataStore: MarketDataStore,
    marketSnapshotTransport: MarketSnapshotTransport,
) {
    registerContractListener(ctx, "market/environment-snapshots", () =>
        ctx.installer.getEnvironmentSnapshots(),
    );
    registerContractListener(ctx, "market/environment-snapshot-preview", (id) =>
        ctx.installer.getEnvironmentSnapshotPreview(id),
    );

    ctx.console.addListener(
        "market/environment-snapshot-apply",
        async (id, options) => {
            assertContract("market/environment-snapshot-apply", id, options);
            const code = await ctx.installer.applyEnvironmentSnapshot(id, options);
            await refreshConsole(ctx, ["dependencies", "registry", "packages"]);
            return code;
        },
        { authority: 4 },
    );

    registerContractListener(ctx, "market/remove-bundle-configs", (request) =>
        removeBundleConfigs(ctx, request),
    );
    registerContractListener(ctx, "market/update-config", (patch) =>
        updateMarketNextConfig(ctx, config, patch),
    );
    registerContractListener(ctx, "market/update-data", (patch) => dataStore.patch(patch));
    registerContractListener(ctx, "market/refresh-dependencies", async () => {
        await ctx.installer.refresh(true);
        await ctx.get("console")?.refresh("config");
    });
    registerContractListener(ctx, "market/package", (name) => ctx.installer.getRegistry(name));

    ctx.console.addListener(
        "market/index",
        async (request) => {
            assertContract("market/index", request);
            const snapshot = await ctx.console.services.market?.getSnapshot?.();
            if (!snapshot || request?.transport !== "http-gzip") {
                return snapshot as MarketSnapshotResponse;
            }
            return marketSnapshotTransport.create(snapshot);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/lookup",
        async (request) => {
            assertContract("market/lookup", request);
            return lookupMarket(ctx.console.services.market as MarketProvider | undefined, request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/registry",
        async (names) => {
            assertContract("market/registry", names);
            const entries = await pMap(
                names,
                async (name) => {
                    try {
                        const meta = await ctx.installer.getPackage(name);
                        if (!meta) return;
                        return [name, meta] as const;
                    } catch (error) {
                        ctx.logger("market").debug(
                            `skip registry metadata for ${name}: ${error instanceof Error ? error.message : error}`,
                        );
                    }
                    return;
                },
                { concurrency: ctx.installer.config.concurrency ?? 4 },
            );
            return Object.fromEntries(
                entries.filter((entry): entry is readonly [string, PackageVersions] => !!entry),
            );
        },
        { authority: 4 },
    );

    registerContractListener(ctx, "market/ensure-config", (name) => ensurePluginConfig(ctx, name));

    ctx.console.addListener(
        "market/avatar",
        async (key, url) => {
            assertContract("market/avatar", key, url);
            try {
                return await fetchAvatar(ctx, key, url);
            } catch (error) {
                ctx.logger("market").debug(
                    `avatar fetch failed: ${error instanceof Error ? error.message : error}`,
                );
            }
            return undefined;
        },
        { authority: 4 },
    );
}

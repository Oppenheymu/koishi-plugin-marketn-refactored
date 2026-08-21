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

/** 市场查询/配置类 listener：环境快照、配置与数据补丁、索引查询、头像。 */
export function registerMarketListeners(
    ctx: Context,
    config: Config,
    dataStore: MarketDataStore,
    marketSnapshotTransport: MarketSnapshotTransport,
) {
    ctx.console.addListener(
        "market/environment-snapshots",
        async () => {
            assertContract("market/environment-snapshots");
            return ctx.installer.getEnvironmentSnapshots();
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/environment-snapshot-preview",
        async (id) => {
            assertContract("market/environment-snapshot-preview", id);
            return ctx.installer.getEnvironmentSnapshotPreview(id);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/environment-snapshot-apply",
        async (id, options) => {
            assertContract("market/environment-snapshot-apply", id, options);
            const code = await ctx.installer.applyEnvironmentSnapshot(id, options);
            await Promise.all([
                ctx.get("console")?.refresh("dependencies"),
                ctx.get("console")?.refresh("registry"),
                ctx.get("console")?.refresh("packages"),
            ]);
            return code;
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/remove-bundle-configs",
        async (request) => {
            assertContract("market/remove-bundle-configs", request);
            return removeBundleConfigs(ctx, request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/update-config",
        async (patch) => {
            assertContract("market/update-config", patch);
            return updateMarketNextConfig(ctx, config, patch);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/update-data",
        async (patch) => {
            assertContract("market/update-data", patch);
            return dataStore.patch(patch);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/refresh-dependencies",
        async () => {
            assertContract("market/refresh-dependencies");
            await ctx.installer.refresh(true);
            await ctx.get("console")?.refresh("config");
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/package",
        async (name) => {
            assertContract("market/package", name);
            return ctx.installer.getRegistry(name);
        },
        { authority: 4 },
    );

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

    ctx.console.addListener(
        "market/ensure-config",
        async (name) => {
            assertContract("market/ensure-config", name);
            return ensurePluginConfig(ctx, name);
        },
        { authority: 4 },
    );

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

import type { Context } from "koishi";
import pMap from "p-map";
import type { z } from "zod";
import type { PackageVersions } from "../../core/registry/cache/index.js";
import type { MarketSnapshotResponse } from "../../shared/types.js";
import { fetchAvatar } from "../avatar/index.js";
import type { Config } from "../config/index.js";
import {
    ensurePluginConfig,
    ensurePluginConfigs,
    updateMarketNextConfig,
} from "../config/manage.js";
import { SELF_PACKAGE } from "../installer/index.js";
import { installBundle, removeBundleConfigs } from "../market/bundle.js";
import type { MarketDataStore } from "../market/data-store.js";
import type { MarketProvider } from "../market/index.js";
import type { MarketSnapshotTransport } from "../market/snapshot-transport.js";
import { type ContractName, contracts } from "./contracts.js";
import { lookupMarket } from "./lookup.js";

/** listener 边界统一校验：入参不符合 zod schema 即抛 ZodError。 */
function assertContract(name: ContractName, ...args: unknown[]) {
    (contracts[name] as z.ZodType).parse(args);
}

export function registerListeners(
    ctx: Context,
    config: Config,
    dataStore: MarketDataStore,
    marketSnapshotTransport: MarketSnapshotTransport,
) {
    const refreshFour = () =>
        Promise.all([
            ctx.get("console")?.refresh("dependencies"),
            ctx.get("console")?.refresh("registry"),
            ctx.get("console")?.refresh("packages"),
            ctx.get("console")?.refresh("config"),
        ]);

    ctx.console.addListener(
        "market/install",
        async (deps, forced, options) => {
            assertContract("market/install", deps, forced, options);
            options ||= {};
            const installNames = Object.entries(deps)
                .filter(([, version]) => version)
                .map(([name]) => name)
                .filter((name) => name !== SELF_PACKAGE);
            const code = await ctx.installer.install(
                deps,
                forced,
                installNames.length ? () => ensurePluginConfigs(ctx, installNames) : undefined,
                options,
            );
            if (!code) {
                await ensurePluginConfigs(ctx, installNames);
            }
            await refreshFour();
            return code;
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/install-bundle",
        async (request, forced, options) => {
            assertContract("market/install-bundle", request, forced, options);
            options ||= {};
            return installBundle(ctx, dataStore, request, forced, options);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/install-fallback-candidate",
        async (failedEndpoint) => {
            assertContract("market/install-fallback-candidate", failedEndpoint);
            return ctx.installer.getInstallFallbackCandidate(failedEndpoint);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/install-history",
        async (limit) => {
            assertContract("market/install-history", limit);
            return ctx.installer.getInstallHistory(limit);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/install-history-detail",
        async (id) => {
            assertContract("market/install-history-detail", id);
            return ctx.installer.getInstallLogDetail(id);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-start",
        async (request) => {
            assertContract("market/local-package-upload-start", request);
            return ctx.installer.startLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-chunk",
        async (request) => {
            assertContract("market/local-package-upload-chunk", request);
            return ctx.installer.appendLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-finish",
        async (request) => {
            assertContract("market/local-package-upload-finish", request);
            return ctx.installer.finishLocalPackageUpload(request);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-commit",
        async (uploadId) => {
            assertContract("market/local-package-upload-commit", uploadId);
            return ctx.installer.commitLocalPackageUpload(uploadId);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/local-package-upload-cancel",
        async (uploadId) => {
            assertContract("market/local-package-upload-cancel", uploadId);
            return ctx.installer.cancelLocalPackageUpload(uploadId);
        },
        { authority: 4 },
    );

    ctx.console.addListener(
        "market/prepare-local-binding",
        async (name) => {
            assertContract("market/prepare-local-binding", name);
            return ctx.installer.prepareLocalBinding(name);
        },
        { authority: 4 },
    );

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

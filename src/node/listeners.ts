import type { Context } from "koishi";
import pMap from "p-map";
import type { z } from "zod";
import type { PackageVersions } from "../core/registry/cache.js";
import type {
    MarketLookupRequest,
    MarketLookupResult,
    MarketSnapshotResponse,
} from "../shared/types.js";
import { fetchAvatar } from "./avatar.js";
import { installBundle, removeBundleConfigs } from "./bundle.js";
import type { Config } from "./config.js";
import {
    ensurePluginConfig,
    ensurePluginConfigs,
    updateMarketNextConfig,
} from "./config-manage.js";
import { type ContractName, contracts } from "./contracts.js";
import type { MarketDataStore } from "./data-store.js";
import { SELF_PACKAGE } from "./installer.service.js";
import type { MarketProvider } from "./market.service.js";
import type { MarketSnapshotTransport } from "./snapshot-transport.js";

/** listener 边界统一校验：入参不符合 zod schema 即抛 ZodError。 */
function assertContract(name: ContractName, ...args: unknown[]) {
    (contracts[name] as z.ZodType).parse(args);
}

function normalizeMarketLookupValues(values: unknown, limit: number) {
    if (!Array.isArray(values)) return [];
    return Array.from(
        new Set(
            values
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter((value) => value && value.length <= 214),
        ),
    ).slice(0, limit);
}

async function lookupMarket(
    provider: MarketProvider | undefined,
    request: MarketLookupRequest = {},
): Promise<MarketLookupResult> {
    if (!request || typeof request !== "object") request = {};
    const names = normalizeMarketLookupValues(request.names, 512);
    const services = normalizeMarketLookupValues(request.services, 128);
    const result: MarketLookupResult = {
        data: {},
        services: Object.fromEntries(services.map((name) => [name, []])),
    };
    if (!provider || (!names.length && !services.length)) return result;

    const snapshot = await provider.getSnapshot();
    const data = snapshot?.data ?? {};
    result.dataVersion = snapshot?.dataVersion;
    for (const name of names) {
        if (data[name]) result.data[name] = data[name];
    }
    if (!services.length) return result;

    const requestedServices = new Set(services);
    for (const object of Object.values(data)) {
        const implemented = object?.manifest?.service?.implements;
        if (!Array.isArray(implemented)) continue;
        for (const service of implemented) {
            if (!requestedServices.has(service)) continue;
            result.services[service]!.push(object.package.name);
        }
    }
    for (const service of services) result.services[service]!.sort();
    return result;
}

/** 注册除 market/refresh（已在 shared 基类注册）外的全部 RPC listeners。 */
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

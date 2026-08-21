import type { Context } from "koishi";
import { ensurePluginConfigs } from "../../config/manage.js";
import { SELF_PACKAGE } from "../../installer/index.js";
import { installBundle } from "../../market/bundle.js";
import type { MarketDataStore } from "../../market/data-store.js";
import { assertContract } from "../contracts.js";

/** 安装类 listener：market/install 主流程、套装安装与安装历史/回退端点查询。 */
export function registerInstallListeners(ctx: Context, dataStore: MarketDataStore) {
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
        "market/prepare-local-binding",
        async (name) => {
            assertContract("market/prepare-local-binding", name);
            return ctx.installer.prepareLocalBinding(name);
        },
        { authority: 4 },
    );
}

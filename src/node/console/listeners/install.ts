import type { Context } from "koishi";
import { ensurePluginConfigs } from "../../config/plugin-configs.js";
import { SELF_PACKAGE } from "../../installer/index.js";
import { installBundle } from "../../market/bundle.js";
import type { MarketDataStore } from "../../market/data-store.js";
import { assertContract } from "../contracts.js";
import { INSTALL_REFRESH_CHANNELS } from "../refresh.js";
import { refreshConsole, registerContractListener } from "./helpers.js";

/** 安装类 listener：market/install 主流程、套装安装与安装历史/回退端点查询。 */
export function registerInstallListeners(ctx: Context, dataStore: MarketDataStore) {
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
            await refreshConsole(ctx, INSTALL_REFRESH_CHANNELS);
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

    registerContractListener(ctx, "market/install-fallback-candidate", (failedEndpoint) =>
        ctx.installer.getInstallFallbackCandidate(failedEndpoint),
    );
    registerContractListener(ctx, "market/install-history", (limit) =>
        ctx.installer.getInstallHistory(limit),
    );
    registerContractListener(ctx, "market/install-history-detail", (id) =>
        ctx.installer.getInstallLogDetail(id),
    );
    registerContractListener(ctx, "market/prepare-local-binding", (name) =>
        ctx.installer.prepareLocalBinding(name),
    );
}

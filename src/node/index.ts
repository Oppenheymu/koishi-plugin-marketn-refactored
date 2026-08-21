import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// 宿主 @koishijs/plugin-config 提供 packages/services/config 三个 Console 服务的
// 类型声明（Services 键），本文件多处 refresh('packages')/refresh('config') 依赖它
import type {} from "@koishijs/plugin-config";
import type { DependencyMetaKey, Registry, RemotePackage } from "@koishijs/registry";
import type { Context, Dict } from "koishi";
import type { EnvironmentSnapshotPreview } from "../core/environment/diff.js";
import type { EnvironmentSnapshotSummary } from "../core/environment/snapshot.js";
import type {
    InstallHistoryEntry,
    InstallLogDetail,
    InstallOptions,
    LocalBindingResult,
} from "../core/install/types.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadPreview,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "../core/upload/types.js";
import type {
    BundleConfigRemoveRequest,
    BundleConfigRemoveResult,
    BundleInstallRequest,
    BundleInstallResult,
} from "../shared/bundle.js";
import type { InstallFallbackCandidate } from "../shared/types.js";
import {
    AVATAR_CACHE_SWEEP_INTERVAL,
    type AvatarFetchResult,
    cleanupAvatarCaches,
    clearAvatarMemoryCache,
} from "./avatar/index.js";
import type { Config } from "./config/index.js";
import {
    ensureInstalledPluginConfigs,
    ensureMarketNextConfigDefaults,
    removeLegacyCollapsedGroupsConfig,
} from "./config/manage.js";
import { registerCommands } from "./console/commands.js";
import { registerListeners } from "./console/listeners.js";
import {
    DependencyProvider,
    RegistryProvider,
    RegistryStatusProvider,
} from "./console/providers.js";
import { Installer } from "./installer/index.js";
import { MarketDataStore, type MarketDataStorePayload } from "./market/data-store.js";
import { setupIdleProbe } from "./market/idle-probe.js";
import { MarketProvider } from "./market/index.js";
import { MarketSnapshotTransport } from "./market/snapshot-transport.js";

export type {
    EnvironmentChangeStatus,
    EnvironmentSnapshotChange,
    EnvironmentSnapshotPreview,
} from "../core/environment/diff.js";
export type {
    EnvironmentDependencySnapshot,
    EnvironmentSnapshotSource,
    EnvironmentSnapshotSummary,
} from "../core/environment/snapshot.js";
export type {
    InstallHistoryChange,
    InstallHistoryEntry,
    InstallHistoryStatus,
    InstallLogDetail,
    LocalBindingResult,
} from "../core/install/types.js";
export type {
    LocalPackageOperation,
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadPreview,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "../core/upload/types.js";
export * from "../shared/index.js";
export { Config } from "./config/index.js";
export { Installer } from "./installer/index.js";

declare module "koishi" {
    interface Context {
        installer: Installer;
    }
}

declare module "@koishijs/console" {
    namespace Console {
        interface Services {
            dependencies: DependencyProvider;
            registry: RegistryProvider;
            registryStatus: RegistryStatusProvider;
            marketData: MarketDataStore;
        }
    }

    interface Events {
        "market/install"(
            deps: Dict<string>,
            forced?: boolean,
            options?: InstallOptions,
        ): Promise<number>;
        "market/install-bundle"(
            request: BundleInstallRequest,
            forced?: boolean,
            options?: InstallOptions,
        ): Promise<BundleInstallResult>;
        "market/install-fallback-candidate"(
            failedEndpoint?: string,
        ): Promise<InstallFallbackCandidate | undefined>;
        "market/install-history"(limit?: number): Promise<InstallHistoryEntry[]>;
        "market/install-history-detail"(id: string): Promise<InstallLogDetail | undefined>;
        "market/local-package-upload-start"(
            request: LocalPackageUploadStartRequest,
        ): Promise<LocalPackageUploadStartResult>;
        "market/local-package-upload-chunk"(
            request: LocalPackageUploadChunkRequest,
        ): Promise<LocalPackageUploadProgress>;
        "market/local-package-upload-finish"(
            request: LocalPackageUploadFinishRequest,
        ): Promise<LocalPackageUploadPreview>;
        "market/local-package-upload-commit"(
            uploadId: string,
        ): Promise<LocalPackageUploadCommitResult>;
        "market/local-package-upload-cancel"(uploadId: string): Promise<boolean>;
        "market/prepare-local-binding"(name: string): Promise<LocalBindingResult>;
        "market/environment-snapshots"(): Promise<EnvironmentSnapshotSummary[]>;
        "market/environment-snapshot-preview"(
            id: string,
        ): Promise<EnvironmentSnapshotPreview | undefined>;
        "market/environment-snapshot-apply"(id: string, options?: InstallOptions): Promise<number>;
        "market/remove-bundle-configs"(
            request: BundleConfigRemoveRequest,
        ): Promise<BundleConfigRemoveResult>;
        "market/update-config"(patch: Partial<Config>): Promise<boolean>;
        "market/update-data"(
            patch: Partial<MarketDataStorePayload>,
        ): Promise<MarketDataStorePayload>;
        "market/package"(name: string): Promise<Registry | undefined>;
        "market/registry"(
            names: string[],
        ): Promise<Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>>;
        "market/ensure-config"(name: string): Promise<boolean>;
        "market/avatar"(key: string, url?: string): Promise<AvatarFetchResult | undefined>;
    }
}

export const name = "market";
export const inject = ["http"];

export const usage = `
如果插件市场页面提示「无法连接到插件市场」，则可以选择一个 Koishi 社区提供的镜像地址，填入下方对应的配置项中。

## 插件市场（填入 search.endpoint）

- Koishi（全球）：https://registry.koishi.chat/index.json
- [Gitee 聚合](https://k.ilharp.cc/4000)（大陆）：https://gitee.com/shangxueink/koishi-registry-aggregator/raw/gh-pages/market.json
- [t4wefan](https://k.ilharp.cc/2611)（大陆）：https://registry.koishi.t4wefan.pub/index.json
- [Lipraty](https://k.ilharp.cc/3530)（大陆）：https://koi.nyan.zone/registry/index.json
- [itzdrli](https://k.ilharp.cc/9975)（全球）：https://kp.itzdrli.cc
- itzdrli 备用：https://koishi.itzdrli.cc
- Koishi Registry GitHub Pages：https://koishijs.github.io/registry/index.json
- Koishi Registry GitHub Raw：https://raw.githubusercontent.com/koishijs/registry/release/index.json
- Koishi Registry jsDelivr：https://cdn.jsdelivr.net/gh/koishijs/registry@release/index.json
- Koishi Registry GitHub 代理：https://ghproxy.net/https://raw.githubusercontent.com/koishijs/registry/release/index.json
- Koishi Registry GitHub 代理 2：https://ghfast.top/https://raw.githubusercontent.com/koishijs/registry/release/index.json

要浏览更多社区镜像，请访问 [Koishi 论坛上的镜像一览](https://k.ilharp.cc/4000)。`;

export function apply(ctx: Context, config: Config = {}) {
    if (!ctx.loader?.writable) {
        return ctx
            .logger("app")
            .warn("koishi-plugin-marketn-refactored is only available for json/yaml config file");
    }

    if (ensureMarketNextConfigDefaults(ctx, config)) {
        ctx.logger("market").info("normalized market-next display config in Koishi config");
        void ctx.loader
            .writeConfig(true)
            .then(() => ctx.get("console")?.refresh("config"))
            .catch((error) => ctx.logger("market").warn(error));
    }

    let activeDataStore: MarketDataStore | undefined;
    const getDataStore = () => activeDataStore;

    ctx.plugin(Installer, config.registry ?? {});

    ctx.inject(["installer"], (ctx) => {
        registerCommands(ctx, config, getDataStore);
    });

    ctx.inject(["console", "installer", "server"], (ctx) => {
        ctx.plugin(DependencyProvider);
        ctx.plugin(RegistryProvider);
        ctx.plugin(RegistryStatusProvider);
        const dataStore = new MarketDataStore(ctx);
        activeDataStore = dataStore;
        ctx.effect(() => () => {
            if (activeDataStore === dataStore) activeDataStore = undefined;
        });
        ctx.plugin(MarketProvider, config.search ?? {});
        setupIdleProbe(ctx, config);

        const here = dirname(fileURLToPath(import.meta.url));
        ctx.console.addEntry({
            dev: resolve(here, "../../client/index.ts"),
            prod: resolve(here, "../../dist"),
        });

        const uiPath = String(
            (ctx.console as unknown as { config?: { uiPath?: string } }).config?.uiPath ?? "",
        ).replace(/\/+$/, "");
        const marketSnapshotRoute = `${uiPath}/market-next/snapshot`;
        const marketSnapshotTransport = new MarketSnapshotTransport(ctx, marketSnapshotRoute);
        const server = (ctx as Context & { server: unknown }).server as {
            get(path: string, handler: (koa: any) => void): void;
        };
        server.get(`${marketSnapshotRoute}/:id`, (koa: any) => {
            const entry = marketSnapshotTransport.get(koa.params.id);
            if (!entry) {
                koa.status = 404;
                koa.body = "market snapshot not found";
                return;
            }
            koa.type = "application/json";
            koa.set("Content-Encoding", "gzip");
            koa.set("Cache-Control", "public, max-age=31536000, immutable");
            koa.set("ETag", `"${entry.id}"`);
            koa.set("X-Content-Type-Options", "nosniff");
            koa.body = entry.body;
        });
        ctx.effect(() => () => marketSnapshotTransport.clear());

        registerListeners(ctx, config, dataStore, marketSnapshotTransport);

        ctx.on("ready", () => {
            void dataStore
                .migrateFromConfig(config)
                .then(() => {
                    if (!removeLegacyCollapsedGroupsConfig(ctx, config)) return;
                    return ctx.loader
                        .writeConfig(true)
                        .then(() => ctx.get("console")?.refresh("config"));
                })
                .catch((error) =>
                    ctx
                        .logger("market")
                        .warn(
                            `failed to migrate market-next data: ${error instanceof Error ? error.message : error}`,
                        ),
                );
            const timer = setTimeout(() => {
                if (!ctx.scope.isActive) return;
                void ensureInstalledPluginConfigs(ctx).catch((error) =>
                    ctx.logger("market").warn(error),
                );
            }, 1000);
            void cleanupAvatarCaches(ctx);
            const avatarTimer = setInterval(
                () => cleanupAvatarCaches(ctx),
                AVATAR_CACHE_SWEEP_INTERVAL,
            );
            ctx.effect(() => () => {
                clearTimeout(timer);
                clearInterval(avatarTimer);
                clearAvatarMemoryCache();
            });
        });
    });
}

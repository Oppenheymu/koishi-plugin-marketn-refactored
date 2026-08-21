import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "koishi";
import "./declarations.js";
import type { Config } from "./config/index.js";
import { registerCommands } from "./console/commands.js";
import { registerListeners } from "./console/listeners/index.js";
import {
    DependencyProvider,
    RegistryProvider,
    RegistryStatusProvider,
} from "./console/providers.js";
import { Installer } from "./installer/index.js";
import type { MarketDataStore } from "./market/data-store.js";
import { setupIdleProbe } from "./market/idle-probe.js";
import { MarketProvider } from "./market/index.js";
import {
    createDataStore,
    normalizeConfigDefaults,
    setupReadyTasks,
    setupSnapshotRoute,
} from "./setup.js";

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

    normalizeConfigDefaults(ctx, config);

    const active: { dataStore?: MarketDataStore | undefined } = {};
    const getDataStore = () => active.dataStore;

    ctx.plugin(Installer, config.registry ?? {});

    ctx.inject(["installer"], (ctx) => {
        registerCommands(ctx, config, getDataStore);
    });

    ctx.inject(["console", "installer", "server"], (ctx) => {
        ctx.plugin(DependencyProvider);
        ctx.plugin(RegistryProvider);
        ctx.plugin(RegistryStatusProvider);
        const dataStore = createDataStore(ctx, active);
        ctx.plugin(MarketProvider, config.search ?? {});
        setupIdleProbe(ctx, config);

        const here = dirname(fileURLToPath(import.meta.url));
        ctx.console.addEntry({
            dev: resolve(here, "../../client/index.ts"),
            prod: resolve(here, "../../dist"),
        });

        const marketSnapshotTransport = setupSnapshotRoute(ctx);
        ctx.effect(() => () => marketSnapshotTransport.clear());

        registerListeners(ctx, config, dataStore, marketSnapshotTransport);
        setupReadyTasks(ctx, config, dataStore);
    });
}

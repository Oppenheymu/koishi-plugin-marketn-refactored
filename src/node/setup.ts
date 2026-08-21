import type { Context } from "koishi";
import {
    AVATAR_CACHE_SWEEP_INTERVAL,
    cleanupAvatarCaches,
    clearAvatarMemoryCache,
} from "./avatar/index.js";
import type { Config } from "./config/index.js";
import {
    ensureMarketNextConfigDefaults,
    removeLegacyCollapsedGroupsConfig,
} from "./config/manage.js";
import { ensureInstalledPluginConfigs } from "./config/plugin-configs.js";
import { MarketDataStore } from "./market/data-store.js";
import { MarketSnapshotTransport } from "./market/snapshot-transport.js";

/** 归一化显示配置缺省值并落盘刷新（失败只记日志）。 */
export function normalizeConfigDefaults(ctx: Context, config: Config) {
    if (!ensureMarketNextConfigDefaults(ctx, config)) return;
    ctx.logger("market").info("normalized market-next display config in Koishi config");
    void ctx.loader
        .writeConfig(true)
        .then(() => ctx.get("console")?.refresh("config"))
        .catch((error) => ctx.logger("market").warn(error));
}

/** 创建 DataStore 并登记激活引用（同一时刻只有一个活跃实例）。 */
export function createDataStore(
    ctx: Context,
    active: { dataStore?: MarketDataStore | undefined },
): MarketDataStore {
    const dataStore = new MarketDataStore(ctx);
    active.dataStore = dataStore;
    ctx.effect(() => () => {
        if (active.dataStore === dataStore) active.dataStore = undefined;
    });
    return dataStore;
}

/** 市场快照路由 handler 所需的 koa 上下文最小结构。 */
interface KoaContextLike {
    params: { id: string };
    status: number;
    body: unknown;
    type: string;
    set(name: string, value: string): void;
}

/** 挂载市场快照 HTTP 路由（gzip + 强缓存 + ETag）。 */
export function setupSnapshotRoute(ctx: Context): MarketSnapshotTransport {
    const uiPath = String(
        (ctx.console as unknown as { config?: { uiPath?: string } }).config?.uiPath ?? "",
    ).replace(/\/+$/, "");
    const marketSnapshotRoute = `${uiPath}/market-next/snapshot`;
    const marketSnapshotTransport = new MarketSnapshotTransport(ctx, marketSnapshotRoute);
    const server = (ctx as Context & { server: unknown }).server as {
        get(path: string, handler: (koa: KoaContextLike) => void): void;
    };
    server.get(`${marketSnapshotRoute}/:id`, (koa: KoaContextLike) => {
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
    return marketSnapshotTransport;
}

/** ready 阶段任务：数据迁移、配置补齐、头像缓存清扫（含定时器清理）。 */
export function setupReadyTasks(ctx: Context, config: Config, dataStore: MarketDataStore) {
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
}

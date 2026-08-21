import { type Context, type Dict, pick, type Session } from "koishi";
import {
    getLatestAllowedUpdate,
    getUpdateCandidates,
    type UpdateIgnorePolicy,
} from "../../shared/update.js";
import { clearAvatarCacheStorage } from "../avatar/index.js";
import type { Config } from "../config/index.js";
import { ensurePluginConfigs } from "../config/manage.js";
import { messageEn, messageZh } from "../locales/generated.js";
import { type MarketDataStore, readMarketDataStore } from "../market/data-store.js";

/** 解析命令参数并返回已在依赖中的候选名（install/uninstall 共用）。 */
async function findInstalledName(ctx: Context, name: string): Promise<string | undefined> {
    const names = ctx.installer.resolveName(name);
    const deps = (await ctx.installer.getDeps()) ?? {};
    return names.find((candidate) => deps[candidate]);
}

interface UpgradeTarget {
    name: string;
    resolved: string;
    target: string;
}

/** 依据更新策略计算可升级的依赖列表（update ignore 策略 + force 覆盖）。 */
async function collectUpgradeTargets(
    ctx: Context,
    config: Config,
    deps: Dict<import("../../core/deps/types.js").Dependency>,
    requested: string[],
    force: boolean,
    getDataStore: () => MarketDataStore | undefined,
    now: number,
): Promise<UpgradeTarget[]> {
    const dataStore = getDataStore();
    const runtimeData = dataStore ? await dataStore.get() : await readMarketDataStore(ctx);
    const policy: UpdateIgnorePolicy = {
        updateIgnoredPackages: config.updateIgnoredPackages,
        updateIgnoreVersions: config.updateIgnoreVersions,
        updateIgnorePrerelease: config.updateIgnorePrerelease,
        updateIgnored: runtimeData.updateIgnored,
    };
    return Array.from(new Set(requested)).flatMap((name) => {
        const dep = deps[name];
        if (!dep?.resolved || dep.local || dep.workspace || dep.invalid) return [];
        const versions = Object.keys(ctx.installer.fullCache[name] ?? {});
        if (!versions.length && dep.latest) versions.push(dep.latest);
        const target = force
            ? getUpdateCandidates(versions, dep.resolved)[0]
            : getLatestAllowedUpdate(name, versions, dep.resolved, policy, now);
        return target ? [{ name, resolved: dep.resolved, target }] : [];
    });
}

/** 展示待升级清单并等待用户确认。 */
async function confirmUpgrade(session: Session, updates: UpgradeTarget[]): Promise<boolean> {
    const output = updates.map(({ name, resolved, target }) => `${name}: ${resolved} -> ${target}`);
    output.unshift(session.text(".available"));
    output.push(session.text(".prompt"));
    await session.send(output.join("\n"));
    const result = await session.prompt();
    return ["Y", "y"].includes(result?.trim());
}

/** 执行升级安装，返回包管理器退出码（0 为成功）。 */
async function performUpgrade(
    ctx: Context,
    session: Session,
    updates: UpgradeTarget[],
): Promise<number | undefined> {
    ctx.loader.envData.message = {
        ...pick(session, ["sid", "channelId", "guildId", "isDirect"]),
        content: session.text(".success"),
    };
    const installNames = updates.map((update) => update.name);
    const installDeps = updates.reduce<Dict<string>>((result, update) => {
        result[update.name] = update.target;
        return result;
    }, {});
    try {
        const code = await ctx.installer.install(installDeps, undefined, () =>
            ensurePluginConfigs(ctx, installNames),
        );
        if (!code) await ensurePluginConfigs(ctx, installNames);
        return code;
    } finally {
        ctx.loader.envData.message = null;
    }
}

/** 注册 plugin.install / plugin.uninstall / plugin.upgrade / plugin.clear-avatar-cache 四个命令。 */
export function registerCommands(
    ctx: Context,
    config: Config,
    getDataStore: () => MarketDataStore | undefined,
) {
    ctx.i18n.define("zh-CN", messageZh);
    ctx.i18n.define("en-US", messageEn);

    ctx.command("plugin.install <name>", { authority: 4 })
        .alias(".i")
        .action(async ({ session }, name) => {
            if (!session) return;
            if (!name) return session.text(".expect-name");
            const installed = await findInstalledName(ctx, name);
            if (installed) return session.text(".already-installed");

            const result = await ctx.installer.findVersion(ctx.installer.resolveName(name));
            if (!result) return session.text(".not-found");

            ctx.loader.envData.message = {
                ...pick(session, ["sid", "channelId", "guildId", "isDirect"]),
                content: session.text(".success"),
            };
            await ctx.installer.install(result, undefined, () =>
                ensurePluginConfigs(ctx, Object.keys(result)),
            );
            await ensurePluginConfigs(ctx, Object.keys(result));
            ctx.loader.envData.message = null;
            return session.text(".success");
        });

    ctx.command("plugin.uninstall <name>", { authority: 4 })
        .alias(".r")
        .action(async ({ session }, name) => {
            if (!session) return;
            if (!name) return session.text(".expect-name");
            const installed = await findInstalledName(ctx, name);
            if (!installed) return session.text(".not-installed");

            await ctx.installer.install({ [installed]: null as unknown as string });
            return session.text(".success");
        });

    ctx.command("plugin.upgrade [name...]", { authority: 4 })
        .alias(".update", ".up")
        .option("self", "-s, --koishi")
        .option("force", "-f, --force")
        .action(async ({ session, options }, ...names) => {
            if (!session) return;
            options ||= {};
            await ctx.installer.refresh(true, true);
            const deps = (await ctx.installer.getDeps({ background: false })) ?? {};
            const requested: string[] = names.length
                ? names
                      .map((name) =>
                          ctx.installer.resolveName(name).find((candidate) => deps[candidate]),
                      )
                      .filter((name): name is string => !!name)
                : Object.keys(deps);
            if (options.self && !requested.includes("koishi")) requested.push("koishi");

            const updates = await collectUpgradeTargets(
                ctx,
                config,
                deps,
                requested,
                !!options.force,
                getDataStore,
                Date.now(),
            );
            if (!updates.length) return session.text(".all-updated");
            if (!(await confirmUpgrade(session, updates))) return session.text(".cancelled");
            const code = await performUpgrade(ctx, session, updates);
            if (code) return session.text(".failed", [code]);
            return session.text(".success");
        });

    ctx.command("plugin.clear-avatar-cache", { authority: 4 }).action(async ({ session }) => {
        if (!session) return;
        const { memory, disk } = await clearAvatarCacheStorage(ctx);
        return session.text(".success", [memory, disk]);
    });
}

import { type Context, type Dict, pick } from "koishi";
import {
    getLatestAllowedUpdate,
    getUpdateCandidates,
    type UpdateIgnorePolicy,
} from "../shared/update.js";
import { clearAvatarCacheStorage } from "./avatar.js";
import type { Config } from "./config.js";
import { ensurePluginConfigs } from "./config-manage.js";
import { type MarketDataStore, readMarketDataStore } from "./data-store.js";
import { messageEn, messageZh } from "./locales-message.js";

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
            const names = ctx.installer.resolveName(name);
            const deps = (await ctx.installer.getDeps()) ?? {};
            const installed = names.find((candidate) => deps[candidate]);
            if (installed) return session.text(".already-installed");

            const result = await ctx.installer.findVersion(names);
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
            const names = ctx.installer.resolveName(name);
            const deps = (await ctx.installer.getDeps()) ?? {};
            const installed = names.find((candidate) => deps[candidate]);
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

            const dataStore = getDataStore();
            const runtimeData = dataStore ? await dataStore.get() : await readMarketDataStore(ctx);
            const policy: UpdateIgnorePolicy = {
                updateIgnoredPackages: config.updateIgnoredPackages,
                updateIgnoreVersions: config.updateIgnoreVersions,
                updateIgnorePrerelease: config.updateIgnorePrerelease,
                updateIgnored: runtimeData.updateIgnored,
            };
            const now = Date.now();
            const updates = Array.from(new Set(requested)).flatMap((name) => {
                const dep = deps[name];
                if (!dep?.resolved || dep.local || dep.workspace || dep.invalid) return [];
                const versions = Object.keys(ctx.installer.fullCache[name] ?? {});
                if (!versions.length && dep.latest) versions.push(dep.latest);
                const target = options.force
                    ? getUpdateCandidates(versions, dep.resolved)[0]
                    : getLatestAllowedUpdate(name, versions, dep.resolved, policy, now);
                return target ? [{ name, resolved: dep.resolved, target }] : [];
            });
            if (!updates.length) return session.text(".all-updated");

            const output = updates.map(
                ({ name, resolved, target }) => `${name}: ${resolved} -> ${target}`,
            );
            output.unshift(session.text(".available"));
            output.push(session.text(".prompt"));
            await session.send(output.join("\n"));
            const result = await session.prompt();
            if (!["Y", "y"].includes(result?.trim())) {
                return session.text(".cancelled");
            }

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
                if (code) return session.text(".failed", [code]);
                await ensurePluginConfigs(ctx, installNames);
            } finally {
                ctx.loader.envData.message = null;
            }
            return session.text(".success");
        });

    ctx.command("plugin.clear-avatar-cache", { authority: 4 }).action(async ({ session }) => {
        if (!session) return;
        const { memory, disk } = await clearAvatarCacheStorage(ctx);
        return session.text(".success", [memory, disk]);
    });
}

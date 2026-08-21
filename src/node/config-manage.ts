import type { Context } from "koishi";
import { loadManifest, Scanner } from "../core/registry/manifest.js";
import { sleep } from "../core/utils/async.js";
import {
    BUNDLE_KEYWORD,
    getPluginShortname,
    isBundlePackageName,
    parseBundleManifest,
} from "../shared/bundle.js";
import {
    type Config,
    configPatchKeys,
    configReloadKeys,
    normalizeMarketSilentRules,
} from "./config.js";
import { SELF_PACKAGE } from "./installer.service.js";

type PluginConfigMap = Record<string, unknown>;

export function hasPluginConfig(plugins: unknown, shortname: string): boolean {
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const prefix = key.split(":", 1)[0]!;
        const name = prefix.replace(/^~/, "");
        if (name === shortname) return true;
        if (name === "group" && hasPluginConfig((plugins as PluginConfigMap)[key], shortname))
            return true;
    }
    return false;
}

function createDisabledPluginConfig(ctx: Context, shortname: string) {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins || !ctx.loader.writable) return;
    let ident: string;
    let key: string;
    do {
        ident = Math.random().toString(36).slice(2, 8);
        key = `~${shortname}:${ident}`;
    } while (key in plugins);
    plugins[key] = {};
    return key;
}

function isPluginBundleDependency(ctx: Context, name: string) {
    if (isBundlePackageName(name)) return true;
    try {
        const meta = loadManifest(name, ctx.baseDir);
        return (
            !!parseBundleManifest((meta.koishi as { bundle?: unknown } | undefined)?.bundle) ||
            meta.keywords?.some((keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD)
        );
    } catch {
        return false;
    }
}

function findPluginParentContext(ctx: Context | undefined, plugins: unknown): Context | undefined {
    if (!ctx) return;
    const scope = ctx.scope as unknown as {
        config?: unknown;
        [key: symbol]: unknown;
    };
    if (scope.config === plugins) return ctx;
    const record = scope[Symbol.for("koishi.loader.record")] as
        | Record<string, { ctx: Context }>
        | undefined;
    for (const fork of Object.values(record ?? {})) {
        const found = findPluginParentContext(fork.ctx, plugins);
        if (found) return found;
    }
    return;
}

async function requestPluginRuntime(ctx: Context, name: string) {
    const listener = ctx.get("console")?.listeners["config/request-runtime"];
    const callback = listener?.callback as ((name: string) => Promise<void>) | undefined;
    await callback?.call(null, name);
}

export async function ensurePluginConfig(ctx: Context, name: string, write = true) {
    if (!Scanner.isPlugin(name)) return false;
    if (name === SELF_PACKAGE) return false;
    if (isPluginBundleDependency(ctx, name)) {
        ctx.logger("market").debug(`skip default config entry for plugin bundle: ${name}`);
        return false;
    }

    const shortname = getPluginShortname(name);
    if (hasPluginConfig(ctx.loader.config?.plugins, shortname)) return false;

    await requestPluginRuntime(ctx, name).catch((error) => ctx.logger("market").warn(error));
    if (hasPluginConfig(ctx.loader.config?.plugins, shortname)) return false;

    const key = createDisabledPluginConfig(ctx, shortname);
    if (!key) return false;
    if (write) await ctx.loader.writeConfig();
    ctx.logger("market").info("created disabled default config entry %c for %c", key, name);
    return true;
}

export async function ensurePluginConfigs(ctx: Context, names: string[]) {
    const start = Date.now();
    let changed = false;
    let checked = 0;
    for (const name of names.filter((name) => Scanner.isPlugin(name))) {
        if (!ctx.scope.isActive) return false;
        if (await ensurePluginConfig(ctx, name, false)) changed = true;
        if (++checked % 20 === 0) await sleep(0);
    }
    if (!changed) return false;
    await ctx.loader.writeConfig();
    await Promise.all([
        ctx.get("console")?.refresh("config"),
        ctx.get("console")?.refresh("packages"),
    ]);
    ctx.logger("market").info(
        `plugin config ensure completed: checked=${checked}, elapsed=${Date.now() - start}ms`,
    );
    return true;
}

export async function ensureInstalledPluginConfigs(ctx: Context) {
    const start = Date.now();
    const manifest = loadManifest(ctx.baseDir);
    const names = Object.keys(manifest.dependencies ?? {})
        .filter((name) => Scanner.isPlugin(name))
        .filter((name) => !isPluginBundleDependency(ctx, name));
    const missing = names.filter(
        (name) => !hasPluginConfig(ctx.loader.config?.plugins, getPluginShortname(name)),
    );
    if (!missing.length) return false;
    await sleep(0);
    const changed = await ensurePluginConfigs(ctx, missing);
    ctx.logger("market").info(
        `installed plugin config repair scan completed: total=${names.length}, missing=${missing.length}, changed=${changed}, elapsed=${Date.now() - start}ms`,
    );
    return changed;
}

function findMarketNextConfigNode(
    plugins: unknown,
    currentConfig: Config,
): { parent: PluginConfigMap; key: string; value: any } | undefined {
    let fallback: { parent: PluginConfigMap; key: string; value: any } | undefined;
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const value = (plugins as PluginConfigMap)[key];
        if (!value || typeof value !== "object") continue;
        const disabled = key.startsWith("~");
        const normalized = disabled ? key.slice(1) : key;
        const [name] = normalized.split(":", 1);
        if (
            value === currentConfig ||
            name === "market-next" ||
            name === "koishi-plugin-marketn-refactored"
        ) {
            if (!disabled) return { parent: plugins as PluginConfigMap, key, value };
            fallback ||= { parent: plugins as PluginConfigMap, key, value };
        }
        if (name === "group") {
            const nested = findMarketNextConfigNode(value, currentConfig);
            if (nested) return nested;
        }
    }
    return fallback;
}

export function ensureMarketNextConfigDefaults(ctx: Context, currentConfig: Config) {
    const target = findMarketNextConfigNode(ctx.loader.config?.plugins, currentConfig);
    if (!target) return false;
    let changed = false;
    if (target.value.frontendMode !== "performance" && target.value.frontendMode !== "polished") {
        target.value.frontendMode = "performance";
        changed = true;
    }
    if (target.value.depsLayout !== "grid" && target.value.depsLayout !== "list") {
        target.value.depsLayout = "grid";
        changed = true;
    }
    if (Object.hasOwn(target.value, "marketLayout")) {
        delete target.value.marketLayout;
        changed = true;
    }
    return changed;
}

export function removeLegacyCollapsedGroupsConfig(ctx: Context, currentConfig: Config) {
    const target = findMarketNextConfigNode(ctx.loader.config?.plugins, currentConfig);
    if (!target || !Object.hasOwn(target.value, "collapsedGroups")) return false;
    delete target.value.collapsedGroups;
    return true;
}

export async function updateMarketNextConfig(
    ctx: Context,
    currentConfig: Config,
    patch: Partial<Config>,
) {
    const target = findMarketNextConfigNode(ctx.loader.config?.plugins, currentConfig);
    if (!target) return false;
    const changedKeys: Array<keyof Config> = [];
    let accepted = false;
    for (const key of configPatchKeys) {
        if (!Object.hasOwn(patch, key)) continue;
        accepted = true;
        const value =
            key === "marketSilentRules"
                ? normalizeMarketSilentRules(patch[key])
                : (patch[key] as never);
        if (target.value[key] === value) continue;
        target.value[key] = value;
        changedKeys.push(key);
    }
    if (!accepted) return false;
    if (!changedKeys.length) return true;
    await ctx.loader.writeConfig(true);
    const requiresReload = changedKeys.some((key) => configReloadKeys.has(key));
    if (requiresReload) {
        const parent = findPluginParentContext(ctx.loader.entry, target.parent);
        if (parent && !target.key.startsWith("~")) {
            await ctx.loader.reload(parent, target.key, target.value);
        }
    }
    await ctx.get("console")?.refresh("config");
    if (requiresReload) await ctx.get("console")?.refresh("entry");
    return true;
}

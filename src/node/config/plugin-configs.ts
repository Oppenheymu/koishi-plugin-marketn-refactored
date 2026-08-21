import type { Context } from "koishi";
import { loadManifest, Scanner } from "../../core/registry/manifest.js";
import { sleep } from "../../core/utils/async.js";
import { BUNDLE_KEYWORD, isBundlePackageName, parseBundleManifest } from "../../shared/bundle.js";
import { getPluginShortname } from "../../shared/bundle-idents.js";
import { refreshConsole } from "../console/refresh.js";
import { SELF_PACKAGE } from "../installer/index.js";
import { hasPluginConfigInTree, type PluginConfigMap } from "./plugins-map.js";

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
    if (hasPluginConfigInTree(ctx.loader.config?.plugins, shortname)) return false;

    await requestPluginRuntime(ctx, name).catch((error) => ctx.logger("market").warn(error));
    if (hasPluginConfigInTree(ctx.loader.config?.plugins, shortname)) return false;

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
    await refreshConsole(ctx, ["config", "packages"]);
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
        (name) => !hasPluginConfigInTree(ctx.loader.config?.plugins, getPluginShortname(name)),
    );
    if (!missing.length) return false;
    await sleep(0);
    const changed = await ensurePluginConfigs(ctx, missing);
    ctx.logger("market").info(
        `installed plugin config repair scan completed: total=${names.length}, missing=${missing.length}, changed=${changed}, elapsed=${Date.now() - start}ms`,
    );
    return changed;
}

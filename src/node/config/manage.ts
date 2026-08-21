import type { Context } from "koishi";
import {
    type Config,
    configPatchKeys,
    configReloadKeys,
    normalizeMarketSilentRules,
} from "./index.js";
import type { PluginConfigMap } from "./plugins-map.js";

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

/** market-next 配置在插件配置树中的定位（parent[key] === value）。 */
interface MarketNextConfigNode {
    parent: PluginConfigMap;
    key: string;
    value: {
        frontendMode?: unknown;
        depsLayout?: unknown;
        marketLayout?: unknown;
        collapsedGroups?: unknown;
        [key: string]: unknown;
    };
}

function findMarketNextConfigNode(
    plugins: unknown,
    currentConfig: Config,
): MarketNextConfigNode | undefined {
    let fallback: MarketNextConfigNode | undefined;
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const value = (plugins as PluginConfigMap)[key];
        const candidate = getMarketConfigCandidate(plugins, key, value, currentConfig);
        if (candidate?.isMatch) {
            if (!candidate.disabled) return candidate.node;
            fallback ||= candidate.node;
        }
        if (candidate?.isGroup) {
            const nested = findMarketNextConfigNode(value, currentConfig);
            if (nested) return nested;
        }
    }
    return fallback;
}

function getMarketConfigCandidate(
    parent: unknown,
    key: string,
    value: unknown,
    currentConfig: Config,
) {
    if (!value || typeof value !== "object") return;
    const node = value as MarketNextConfigNode["value"];
    const disabled = key.startsWith("~");
    const normalized = disabled ? key.slice(1) : key;
    const [name] = normalized.split(":", 1);
    return {
        disabled,
        isGroup: name === "group",
        isMatch:
            value === currentConfig ||
            name === "market-next" ||
            name === "koishi-plugin-marketn-refactored",
        node: { parent: parent as PluginConfigMap, key, value: node },
    };
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
    const changedKeys = applyConfigPatch(target.value, patch);
    if (!changedKeys) return false;
    if (!changedKeys.length) return true;
    await ctx.loader.writeConfig(true);
    const requiresReload = changedKeys.some((key) => configReloadKeys.has(key));
    if (requiresReload) {
        const parent = findPluginParentContext(ctx.loader.entry, target.parent);
        if (parent && !target.key.startsWith("~")) {
            await ctx.loader.reload(parent, target.key, target.value);
        }
    }
    await refreshConfigViews(ctx, requiresReload);
    return true;
}

function applyConfigPatch(target: MarketNextConfigNode["value"], patch: Partial<Config>) {
    const targetRecord = target as Record<string, unknown>;
    const changedKeys: Array<keyof Config> = [];
    let accepted = false;
    for (const key of configPatchKeys) {
        if (!Object.hasOwn(patch, key)) continue;
        accepted = true;
        const value =
            key === "marketSilentRules"
                ? normalizeMarketSilentRules(patch[key])
                : (patch[key] as never);
        if (targetRecord[key] === value) continue;
        targetRecord[key] = value;
        changedKeys.push(key);
    }
    return accepted ? changedKeys : undefined;
}

async function refreshConfigViews(ctx: Context, requiresReload: boolean) {
    await ctx.get("console")?.refresh("config");
    if (requiresReload) await ctx.get("console")?.refresh("entry");
}

import type { Context } from "koishi";
import type {
    BundleInstallMember,
    BundleInstallRequest,
    PluginBundleManifest,
} from "../../shared/bundle.js";
import {
    getBundleGroupIdent,
    getBundleMemberIdent,
    getPluginShortname,
} from "../../shared/bundle.js";
import { findPluginConfigKey } from "../config/plugins-map.js";

type PluginConfigMap = Record<string, any>;

export interface BundleGroup {
    key: string;
    plugins: PluginConfigMap;
    changed?: boolean;
}

export function getBundleGroup(ctx: Context, packageName: string): BundleGroup | undefined {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins) return;
    const key = `group:${getBundleGroupIdent(packageName)}`;
    if (!plugins[key]) return;
    return { key, plugins: plugins[key] };
}

function ensureBundleGroup(
    ctx: Context,
    packageName: string,
    bundle: PluginBundleManifest,
): BundleGroup | undefined {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins || !ctx.loader.writable) return;
    const ident = getBundleGroupIdent(packageName);
    const key = `group:${ident}`;
    let changed = false;
    if (!plugins[key]) {
        plugins[key] = {};
        changed = true;
    }
    if (!plugins[key].$label) {
        plugins[key].$label = bundle.label || getPluginShortname(packageName);
        changed = true;
    }
    if (plugins[key].$collapsed === undefined) {
        plugins[key].$collapsed = false;
        changed = true;
    }
    return { key, plugins: plugins[key], changed };
}

function hasPluginConfigInGroup(plugins: PluginConfigMap, shortname: string) {
    return findPluginConfigKey(plugins, shortname) !== undefined;
}

function findPluginConfig(
    plugins: unknown,
    shortname: string,
    group?: unknown,
): { key: string; parent: PluginConfigMap; value: unknown } | undefined {
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const value = (plugins as PluginConfigMap)[key];
        const prefix = key.split(":", 1)[0]!;
        const name = prefix.replace(/^~/, "");
        if (name === shortname) return { key, parent: plugins as PluginConfigMap, value };
        if (name === "group") {
            const found = findPluginConfig(value, shortname, group);
            if (found) return found;
        }
    }
    return;
}

export interface BundleConfigWriter {
    write: () => Promise<void>;
    group?: BundleGroup | undefined;
    configured: string[];
    moved: string[];
    skipped: string[];
}

export function createBundleConfigWriter(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    selected: BundleInstallMember[],
): BundleConfigWriter {
    const writer: BundleConfigWriter = {
        group: undefined,
        configured: [],
        moved: [],
        skipped: [],
        write: async () => {},
    };
    let groupChanged = false;
    let wrote = false;
    writer.write = async () => {
        if (wrote) return;
        writer.group =
            ensureBundleGroup(ctx, request.package, manifest) ??
            getBundleGroup(ctx, request.package);
        groupChanged ||= !!writer.group?.changed;
        for (const member of selected) {
            if (!member.createConfig) {
                writer.skipped.push(member.package);
                continue;
            }
            const shortname = member.plugin || getPluginShortname(member.package);
            writer.group ||= ensureBundleGroup(ctx, request.package, manifest);
            groupChanged ||= !!writer.group?.changed;
            if (!writer.group) {
                writer.skipped.push(member.package);
                continue;
            }

            if (hasPluginConfigInGroup(writer.group.plugins, shortname)) continue;

            const existing = findPluginConfig(
                ctx.loader.config?.plugins,
                shortname,
                writer.group.plugins,
            );
            if (existing && existing.parent !== writer.group.plugins && member.move) {
                const ident = getBundleMemberIdent(request.package, member);
                const fallbackKey = `~${shortname}:${ident}`;
                const targetKey = existing.key in writer.group.plugins ? fallbackKey : existing.key;
                if (targetKey in writer.group.plugins) {
                    writer.skipped.push(member.package);
                    continue;
                }
                writer.group.plugins[targetKey] = existing.value ?? {};
                delete existing.parent[existing.key];
                writer.moved.push(member.package);
                continue;
            }

            const ident = getBundleMemberIdent(request.package, member);
            const key = `~${shortname}:${ident}`;
            if (writer.group.plugins[key]) continue;
            writer.group.plugins[key] = member.usePreset ? member.config || {} : {};
            writer.configured.push(member.package);
        }
        if (groupChanged || writer.configured.length || writer.moved.length) {
            await ctx.loader.writeConfig();
        }
        wrote = true;
    };
    return writer;
}

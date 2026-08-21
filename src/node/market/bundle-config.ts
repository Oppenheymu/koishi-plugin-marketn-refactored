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
} from "../../shared/bundle-idents.js";
import { findPluginConfigKey, type PluginConfigMap } from "../config/plugins-map.js";

export interface BundleGroup {
    key: string;
    plugins: PluginConfigMap;
    changed?: boolean;
}

export function getBundleGroup(ctx: Context, packageName: string): BundleGroup | undefined {
    const plugins = ctx.loader.config?.plugins as PluginConfigMap | undefined;
    if (!plugins) return;
    const key = `group:${getBundleGroupIdent(packageName)}`;
    const group = plugins[key] as PluginConfigMap | undefined;
    if (!group) return;
    return { key, plugins: group };
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
    const group = plugins[key] as PluginConfigMap;
    if (!group["$label"]) {
        group["$label"] = bundle.label || getPluginShortname(packageName);
        changed = true;
    }
    if (group["$collapsed"] === undefined) {
        group["$collapsed"] = false;
        changed = true;
    }
    return { key, plugins: group, changed };
}

function hasPluginConfigInGroup(plugins: PluginConfigMap, shortname: string) {
    return findPluginConfigKey(plugins, shortname) !== undefined;
}

function findPluginConfig(
    plugins: unknown,
    shortname: string,
): { key: string; parent: PluginConfigMap; value: unknown } | undefined {
    for (const key in (plugins as PluginConfigMap) ?? {}) {
        if (key.startsWith("$")) continue;
        const value = (plugins as PluginConfigMap)[key];
        const prefix = key.split(":", 1)[0]!;
        const name = prefix.replace(/^~/, "");
        if (name === shortname) return { key, parent: plugins as PluginConfigMap, value };
        if (name === "group") {
            const found = findPluginConfig(value, shortname);
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
    let wrote = false;
    writer.write = async () => {
        if (wrote) return;
        await writeBundleConfig(ctx, request, manifest, selected, writer);
        wrote = true;
    };
    return writer;
}

async function writeBundleConfig(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    selected: BundleInstallMember[],
    writer: BundleConfigWriter,
) {
    writer.group =
        ensureBundleGroup(ctx, request.package, manifest) ?? getBundleGroup(ctx, request.package);
    let groupChanged = !!writer.group?.changed;
    for (const member of selected) {
        groupChanged =
            configureBundleMember(ctx, request, manifest, member, writer) || groupChanged;
    }
    if (groupChanged || writer.configured.length || writer.moved.length) {
        await ctx.loader.writeConfig();
    }
}

function configureBundleMember(
    ctx: Context,
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    member: BundleInstallMember,
    writer: BundleConfigWriter,
) {
    if (!member.createConfig) {
        writer.skipped.push(member.package);
        return false;
    }
    const shortname = member.plugin || getPluginShortname(member.package);
    const ensured = ensureBundleGroup(ctx, request.package, manifest);
    writer.group ||= ensured;
    const groupChanged = !!ensured?.changed;
    if (!writer.group) {
        writer.skipped.push(member.package);
        return groupChanged;
    }
    if (hasPluginConfigInGroup(writer.group.plugins, shortname)) return groupChanged;

    const existing = findPluginConfig(ctx.loader.config?.plugins, shortname);
    if (existing && existing.parent !== writer.group.plugins && member.move) {
        return moveBundleMember(request, member, existing, writer) || groupChanged;
    }
    const ident = getBundleMemberIdent(request.package, member);
    const key = `~${shortname}:${ident}`;
    if (writer.group.plugins[key]) return groupChanged;
    writer.group.plugins[key] = member.usePreset ? member.config || {} : {};
    writer.configured.push(member.package);
    return true;
}

function moveBundleMember(
    request: BundleInstallRequest,
    member: BundleInstallMember,
    existing: { key: string; parent: PluginConfigMap; value: unknown },
    writer: BundleConfigWriter,
) {
    const shortname = member.plugin || getPluginShortname(member.package);
    const ident = getBundleMemberIdent(request.package, member);
    const fallbackKey = `~${shortname}:${ident}`;
    const targetKey = existing.key in writer.group!.plugins ? fallbackKey : existing.key;
    if (targetKey in writer.group!.plugins) {
        writer.skipped.push(member.package);
        return false;
    }
    writer.group!.plugins[targetKey] = existing.value ?? {};
    delete existing.parent[existing.key];
    writer.moved.push(member.package);
    return true;
}

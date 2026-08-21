import type { Context, Dict } from "koishi";
import { maxSatisfying } from "semver";
import type { InstallOptions } from "../../core/install/types.js";
import { loadManifest } from "../../core/registry/manifest.js";
import type {
    BundleConfigRemoveRequest,
    BundleConfigRemoveResult,
    BundleInstallMember,
    BundleInstallRequest,
    BundleInstallResult,
    PluginBundleManifest,
    PluginBundleRecord,
} from "../../shared/bundle.js";
import {
    BUNDLE_KEYWORD,
    parseBundleManifest,
    validateBundleManifest,
} from "../../shared/bundle.js";
import { getPluginShortname } from "../../shared/bundle-idents.js";
import type { PluginConfigMap } from "../config/plugins-map.js";
import { INSTALL_REFRESH_CHANNELS, refreshConsole } from "../console/refresh.js";
import {
    type BundleConfigWriter,
    createBundleConfigWriter,
    getBundleGroup,
} from "./bundle-config.js";
import type { MarketDataStore } from "./data-store.js";

export async function removeBundleConfigs(
    ctx: Context,
    request: BundleConfigRemoveRequest,
): Promise<BundleConfigRemoveResult> {
    const group = getBundleGroup(ctx, request.package);
    const result: BundleConfigRemoveResult = {
        groupKey: group?.key,
        removed: [],
    };
    if (!group || !ctx.loader.writable) return result;

    const memberNames = getBundleMemberNames(request);
    const removal = removeBundleMembers(group.plugins, memberNames);
    result.removed.push(...removal.removed);
    if (request.removeEmptyGroup !== false && hasNoBundleMembers(group.plugins)) {
        delete (ctx.loader.config as { plugins?: PluginConfigMap }).plugins![group.key];
        result.removedGroup = true;
    }

    if (result.removed.length || result.removedGroup) {
        await ctx.loader.writeConfig();
        await refreshConsole(ctx, ["config", "packages"]);
        if (removal.needsFullReload) {
            setTimeout(() => {
                if (ctx.scope.isActive) ctx.loader.fullReload();
            }, 1000);
        }
    }

    return result;
}

function getBundleMemberNames(request: BundleConfigRemoveRequest) {
    return new Set(
        (request.members ?? [])
            .map((member) => getPluginShortname(member.plugin || member.package))
            .filter(Boolean),
    );
}

function removeBundleMembers(plugins: PluginConfigMap, memberNames: Set<string>) {
    const removed: string[] = [];
    let needsFullReload = false;
    for (const key of Object.keys(plugins)) {
        if (key.startsWith("$")) continue;
        const shortname = key.split(":", 1)[0]!.replace(/^~/, "");
        if (memberNames.size && !memberNames.has(shortname)) continue;
        delete plugins[key];
        removed.push(key);
        if (!key.startsWith("~")) needsFullReload = true;
    }
    return { removed, needsFullReload };
}

function hasNoBundleMembers(plugins: PluginConfigMap) {
    return Object.keys(plugins).every((key) => key.startsWith("$"));
}

async function assertNoDirectBundleCycles(
    ctx: Context,
    packageName: string,
    members: BundleInstallMember[],
) {
    const bundleName = packageName.toLowerCase();
    for (const member of members) {
        try {
            const registry = await ctx.installer.getRegistry(member.package);
            const versions = Object.keys(registry?.versions ?? {});
            const version = maxSatisfying(versions, member.version, { includePrerelease: true });
            if (!version) continue;
            const remote = registry?.versions?.[version];
            const bundle = parseBundleManifest(
                (remote?.koishi as { bundle?: unknown } | undefined)?.bundle,
            );
            if (!bundle?.members.some((item) => item.package.toLowerCase() === bundleName))
                continue;
            throw new Error(
                `plugin bundle has a direct cycle: ${packageName} <-> ${member.package}`,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes("direct cycle")) throw error;
            ctx.logger("market").debug(
                `plugin bundle cycle check skipped: bundle=${packageName}, member=${member.package}, error=${error instanceof Error ? error.message : error}`,
            );
        }
    }
}

async function resolveBundleManifest(
    ctx: Context,
    request: BundleInstallRequest,
): Promise<PluginBundleManifest> {
    if (!request.version) throw new Error("bundle package version is required");
    const registry = await ctx.installer.getRegistry(request.package);
    if (!registry?.versions)
        throw new Error(`bundle package metadata not loaded: ${request.package}`);
    const remote = registry.versions[request.version];
    if (!remote)
        throw new Error(`bundle package version not found: ${request.package}@${request.version}`);
    const bundle = parseBundleManifest(
        (remote?.koishi as { bundle?: unknown } | undefined)?.bundle,
    );
    const validation = validateBundleManifest(request.package, bundle, {
        keyword: remote?.keywords?.some((keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD),
    });
    if (!validation.valid) {
        throw new Error(`invalid plugin bundle: ${validation.errors.join("; ")}`);
    }
    return bundle!;
}

function resolveSelectedMembers(
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
): BundleInstallMember[] {
    const requestMembers = new Map(
        (request.members ?? []).map((member) => [`${member.package}\n${member.plugin}`, member]),
    );
    return manifest.members
        .map((member) => {
            const option = requestMembers.get(`${member.package}\n${member.plugin}`);
            return {
                ...member,
                selected: !!option?.selected,
                createConfig: option?.createConfig !== false,
                usePreset: option?.usePreset === true,
                move: option?.move === true,
                config: option?.config ?? member.config,
            };
        })
        .filter((member) => member.selected);
}

function buildInstallDeps(request: BundleInstallRequest, selected: BundleInstallMember[]) {
    const deps: Dict<string> = { [request.package]: request.version };
    for (const member of selected) {
        deps[member.package] = member.version;
    }
    return deps;
}

function buildBundleRecord(
    request: BundleInstallRequest,
    manifest: PluginBundleManifest,
    selected: BundleInstallMember[],
    beforeDeps: Dict<string>,
    code: number,
    writer: BundleConfigWriter,
): PluginBundleRecord | undefined {
    if (code) return;
    return {
        package: request.package,
        version: request.version,
        label: manifest.label,
        groupKey: writer.group?.key,
        installedAt: Date.now(),
        members: selected.map((member) => ({
            package: member.package,
            plugin: member.plugin,
            version: member.version,
            required: member.required,
            selected: true,
            installedByBundle: !beforeDeps[member.package],
            configured: writer.configured.includes(member.package),
            moved: writer.moved.includes(member.package),
            skipped: writer.skipped.includes(member.package),
            usePreset: member.usePreset,
        })),
    };
}

export async function installBundle(
    ctx: Context,
    dataStore: MarketDataStore,
    request: BundleInstallRequest,
    forced?: boolean,
    options: InstallOptions = {},
): Promise<BundleInstallResult> {
    options ||= {};
    const manifest = await resolveBundleManifest(ctx, request);
    const selected = resolveSelectedMembers(request, manifest);
    if (!selected.length) throw new Error("plugin bundle has no selected members");
    await assertNoDirectBundleCycles(ctx, request.package, selected);

    const beforeDeps = loadManifest(ctx.baseDir).dependencies ?? {};
    const deps = buildInstallDeps(request, selected);
    const writer = createBundleConfigWriter(ctx, request, manifest, selected);

    const code = await ctx.installer.install(deps, forced, writer.write, options);
    if (!code) {
        await writer.write();
    }

    await refreshConsole(ctx, INSTALL_REFRESH_CHANNELS);
    const record = buildBundleRecord(request, manifest, selected, beforeDeps, code, writer);
    if (record) await dataStore.setBundleRecord(record);
    return {
        code,
        installed: Object.keys(deps),
        configured: writer.configured,
        moved: writer.moved,
        skipped: writer.skipped,
        groupKey: writer.group?.key,
        record,
    };
}

/**
 * @file 合包（plugin bundle）安装/配置移除的 node 侧编排（market 域）。
 *
 * 模块职责:
 * - installBundle:market/bundle-install RPC 的服务端实现。重新拉取并校验
 *   合包清单（不信任 client 传来的清单）、解析勾选成员、防直接循环引用,
 *   然后把"合包自身 + 勾选成员"作为一个 override 交给通用安装器,安装成功
 *   后写配置分组并持久化安装记录;
 * - removeBundleConfigs:只清 koishi.yml 里合包分组成员的配置、不动依赖,
 *   分组清空后顺带删除空分组。
 *
 * 关键设计:
 * - client 传的 bundle/members 仅作选项参考,清单以 registry 元数据重新解析
 *   为准,防止伪造请求写入任意配置;
 * - 成员配置键使用 `~短名:成员标识` 形态（~ 前缀 = 禁用自动重载）,由
 *   bundle-config.ts 的 writer 统一生成;
 * - 安装记录（PluginBundleRecord）写入 MarketDataStore,卸载/管理对话框
 *   靠它回放当时的安装选择。
 */
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

/**
 * 移除合包成员的插件配置（不动依赖）。定位 koishi.yml 的 group:pa-* 分组,
 * 删除指定成员（缺省为全部分组成员）的配置节点;分组清空后按请求删除空
 * 分组。有实际删除时写盘并刷新 config/packages 通道;删除了非 ~ 前缀键
 * （即插件可能正在运行）时延迟 1s 触发 fullReload 让宿主生效。
 */
export async function removeBundleConfigs(
    ctx: Context,
    request: BundleConfigRemoveRequest,
): Promise<BundleConfigRemoveResult> {
    const group = getBundleGroup(ctx, request.package);
    const result: BundleConfigRemoveResult = {
        groupKey: group?.key,
        removed: [],
    };
    // 找不到分组,或 koishi.yml 只读(如由外部编排器管理)时静默空结果
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

/** 把移除请求的成员列表归一成插件短名集合（plugin 键优先,缺省回包名短名）。 */
function getBundleMemberNames(request: BundleConfigRemoveRequest) {
    return new Set(
        (request.members ?? [])
            .map((member) => getPluginShortname(member.plugin || member.package))
            .filter(Boolean),
    );
}

/**
 * 就地删除分组里命中成员短名的配置键。键形态为 `~短名:标识` 或 `短名:标识`,
 * 先剥出短名再比对;空成员集合表示删除组内全部非 $ 键。删除了不带 ~ 前缀的
 * 键意味着插件实例可能已加载,标记 needsFullReload 让调用方触发完整重载。
 */
function removeBundleMembers(plugins: PluginConfigMap, memberNames: Set<string>) {
    const removed: string[] = [];
    let needsFullReload = false;
    for (const key of Object.keys(plugins)) {
        // $ 开头是分组元数据($label/$collapsed),不属于任何成员
        if (key.startsWith("$")) continue;
        const shortname = key.split(":", 1)[0]!.replace(/^~/, "");
        if (memberNames.size && !memberNames.has(shortname)) continue;
        delete plugins[key];
        removed.push(key);
        if (!key.startsWith("~")) needsFullReload = true;
    }
    return { removed, needsFullReload };
}

/** 分组是否只剩 $ 元数据键（没有成员配置,可整体删除）。 */
function hasNoBundleMembers(plugins: PluginConfigMap) {
    return Object.keys(plugins).every((key) => key.startsWith("$"));
}

/**
 * 防御合包间的直接循环引用:A 的成员指向 B、B 的成员又指回 A 会让安装
 * 编排无限递归。逐成员取 registry 元数据里"满足版本范围的最高版本",
 * 解析其 koishi.bundle 清单,发现指回本合包即抛错。取元数据失败只记
 * debug 日志跳过（循环检查是尽力而为,不阻断正常安装）。
 */
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

/**
 * 从 registry 元数据重新解析并校验合包清单。client 传来的 bundle 字段
 * 不可信,此处按请求版本取远端 koishi.bundle、跑完整校验（命名/关键字/
 * 成员结构）,不通过即抛错阻断安装。
 */
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

/**
 * 把 client 勾选的成员选项合并进服务端清单:以清单成员为基准,按
 * `package\nplugin` 组合键查请求里的选项,吸收 selected/createConfig/
 * usePreset/move/config,最后只留勾选项。清单里没有的请求成员自然被丢弃。
 */
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

/** 组装安装 override:合包自身 + 各勾选成员的精确版本请求。 */
function buildInstallDeps(request: BundleInstallRequest, selected: BundleInstallMember[]) {
    const deps: Dict<string> = { [request.package]: request.version };
    for (const member of selected) {
        deps[member.package] = member.version;
    }
    return deps;
}

/**
 * 安装成功后构建持久化记录:逐成员标记 installedByBundle(安装前
 * package.json 里没有的算本次新装)与 configured/moved/skipped(来自
 * writer 的实际写入结果),交给调用方写入 MarketDataStore。
 * 安装失败（code 非 0）时不产出记录。
 */
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

/**
 * 合包安装入口:校验清单 → 解析勾选 → 防循环 → 安装（writer.write 挂进
 * 安装器的完成回调,回滚场景下不会执行写配置）→ 成功后再显式写一次配置
 * （兜底）→ 刷新 console → 持久化安装记录。返回值携带各结果明细供
 * client 弹层展示"装了什么/配了什么/跳过什么"。
 */
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

    // 安装前先留一份依赖快照:判断哪些成员是"因本次合包而新装"
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

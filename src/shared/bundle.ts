import type { Dict } from "koishi";
import { validRange } from "semver";

/**
 * 插件捆绑包（plugin bundle / 合包）清单的类型与解析校验纯函数。
 *
 * 合包约定：一个 npm 包通过 package.json 里的 `koishi.bundle` 字段声明一组
 * 插件成员（各自的包名/插件键/版本范围/预置配置），并以关键字 `market:package`
 * 与 `koishi-plugin-pa-*` 命名互相印证。安装合包时按成员逐项安装并把配置
 * 写入 koishi.yml 的 `group:pa-*` 分组（分组标识派生见 bundle-idents.ts）。
 *
 * 架构位置：位于 shared 共享语言层，node 端（market/bundle.ts 安装编排、
 * 契约校验 zod）与 client 端（bundle-install 对话框的成员勾选/冲突展示）
 * 引用同一份类型与判定函数，避免两端对清单规则的理解漂移。
 * 本文件仅做解析/校验，不做任何 I/O；敏感配置扫描（scanSensitiveConfig）
 * 因同样服务于合包配置，放在 bundle-idents.ts。
 */

/** 合包清单中的单个成员（包名 package.json 内 koishi.bundle.members 的结构化形态）。 */
export interface PluginBundleMember {
    /** 成员插件的 npm 包名（必须小写且符合 Koishi 插件包命名） */
    package: string;
    /** 插件在配置文件中使用的键名（koishi.yml plugins 下的键，如 "chat"） */
    plugin: string;
    /** 成员的 semver 版本范围（如 ^1.0.0） */
    version: string;
    /** 是否必装成员（client 默认勾选且不可取消） */
    required?: boolean | undefined;
    /** 预置的插件配置（安装时可作为初始配置写入） */
    config?: Dict | undefined;
}

/** 合包清单（package.json 的 koishi.bundle 字段解析结果）。 */
export interface PluginBundleManifest {
    /** 展示名（写入配置分组的 $label） */
    label?: string | undefined;
    /** 合包描述 */
    description?: string | undefined;
    /** 成员列表（校验要求非空） */
    members: PluginBundleMember[];
}

/** 合包清单校验结果。 */
export interface PluginBundleValidation {
    /** 是否通过校验（无 error 即通过，warning 不影响） */
    valid: boolean;
    /** 阻断性错误列表（命名/结构/成员字段不合法） */
    errors: string[];
    /** 非阻断性警告列表（缺关键字、重复包名、插件键可能冲突等） */
    warnings: string[];
}

/** 安装后持久化的成员记录（PluginBundleRecord.members 的元素，记录当时的安装状态）。 */
export interface PluginBundleRecordMember extends PluginBundleMember {
    /** 安装时是否勾选 */
    selected: boolean;
    /** 是否因本次合包安装而新装（此前 package.json 中不存在） */
    installedByBundle?: boolean | undefined;
    /** 是否为它写入了插件配置 */
    configured?: boolean | undefined;
    /** 已有配置是否被移动进了合包分组 */
    moved?: boolean | undefined;
    /** 是否被跳过（已有可用配置等原因未处理） */
    skipped?: boolean | undefined;
    /** 是否应用了清单预置配置 */
    usePreset?: boolean | undefined;
}

/** 合包安装记录（写入 MarketDataStore，供后续卸载/展示回放）。 */
export interface PluginBundleRecord {
    /** 合包 npm 包名 */
    package: string;
    /** 安装的合包版本 */
    version: string;
    /** 展示名（来自清单 label） */
    label?: string | undefined;
    /** 对应 koishi.yml 的分组键（group:pa-*，无则为 undefined） */
    groupKey?: string | undefined;
    /** 安装时间戳（Date.now()） */
    installedAt: number;
    /** 成员安装状态明细 */
    members: PluginBundleRecordMember[];
}

/** 安装请求中的成员（client 勾选后的形态，在清单成员之上补充安装选项）。 */
export interface BundleInstallMember extends PluginBundleMember {
    /** 是否勾选安装（未勾选的成员不参与安装） */
    selected: boolean;
    /** 是否为其创建插件配置（组内已有配置时无意义） */
    createConfig: boolean;
    /** 是否使用清单里的预置 config 作为初始配置 */
    usePreset: boolean;
    /** 与本地现状的冲突类别：组内已有配置 / 组外已有配置 / 已装版本不满足范围 */
    conflict?: "same-group" | "other-config" | "package-mismatch";
    /** 是否把组外已有配置移动进合包分组 */
    move?: boolean;
}

/** 合包安装请求（market/bundle-install RPC 的载荷）。 */
export interface BundleInstallRequest {
    /** 合包 npm 包名 */
    package: string;
    /** 要安装的合包版本（用于从 registry 元数据取清单） */
    version: string;
    /** 解析后的合包清单（服务端会重新解析校验，不直接信任此字段） */
    bundle: PluginBundleManifest;
    /** client 侧勾选完成的成员选项 */
    members: BundleInstallMember[];
}

/** 合包安装结果。 */
export interface BundleInstallResult {
    /** 包管理器退出码（0 为成功） */
    code: number;
    /** 参与安装的包名（合包自身 + 勾选成员） */
    installed: string[];
    /** 写入了插件配置的成员包名 */
    configured: string[];
    /** 已有配置被移动进分组的成员包名 */
    moved: string[];
    /** 被跳过配置写入的成员包名 */
    skipped: string[];
    /** koishi.yml 分组键（group:pa-*） */
    groupKey?: string | undefined;
    /** 安装成功时生成的安装记录（失败为 undefined） */
    record?: PluginBundleRecord | undefined;
}

/** 移除合包配置请求（卸载/管理场景，只清配置不动依赖）。 */
export interface BundleConfigRemoveRequest {
    /** 合包 npm 包名（用于定位分组键） */
    package: string;
    /** 要移除的成员；缺省表示移除全部分组成员 */
    members?: Array<Pick<PluginBundleMember, "package" | "plugin">>;
    /** 成员清空后是否连带删除空分组（默认 true） */
    removeEmptyGroup?: boolean;
}

/** 移除合包配置结果。 */
export interface BundleConfigRemoveResult {
    /** 被操作的分组键（找不到分组时为 undefined） */
    groupKey?: string | undefined;
    /** 被移除的配置键列表 */
    removed: string[];
    /** 分组本身是否被整体删除 */
    removedGroup?: boolean;
}

/** 标识合包的 package.json 关键字（与命名约定共同构成合包识别依据）。 */
export const BUNDLE_KEYWORD = "market:package";
/** 合包命名约定：koishi-plugin-pa-*（pa = package bundle），可带 @scope。 */
export const BUNDLE_PACKAGE_RE = /^(?:@[0-9a-z-]+\/)?koishi-plugin-pa-[0-9a-z-]+$/;
/** 合法 Koishi 插件包名：普通 koishi-plugin-* 或官方 @koishijs/plugin-*。 */
export const PLUGIN_PACKAGE_RE =
    /^(?:@[^/]+\/)?koishi-plugin-[0-9a-z-]+$|^@koishijs\/plugin-[0-9a-z-]+$/;

/** 判断包名是否符合合包命名约定（额外要求全小写，避免大写绕过正则）。 */
export function isBundlePackageName(name = "") {
    return name === name.toLowerCase() && BUNDLE_PACKAGE_RE.test(name);
}

/** 判断关键字列表中是否含有合包标识 market:package（大小写不敏感）。 */
export function hasBundleKeyword(keywords?: string[]) {
    return !!keywords?.some((keyword) => keyword.toLowerCase() === BUNDLE_KEYWORD);
}

/**
 * 宽口径的"疑似合包"判定：命名约定、关键字、koishi.bundle 字段任一命中即算。
 * 市场列表据此给条目打 bundle 徽标；具体校验仍以 validateBundleManifest 为准。
 */
export function isBundleLike(meta: {
    name?: string;
    keywords?: string[];
    koishi?: { bundle?: unknown };
}) {
    return (
        isBundlePackageName(meta.name) ||
        hasBundleKeyword(meta.keywords) ||
        !!parseBundleManifest(meta.koishi?.bundle)
    );
}

/**
 * 把 package.json 的 koishi.bundle 字段宽容解析为清单对象。
 * 任何非对象输入返回 undefined；成员字段类型不合法时取空值而非整份失败
 * （宽松解析配合 validateBundleManifest 收紧，两步分离便于展示"尽力解析"结果）。
 */
export function parseBundleManifest(value: unknown): PluginBundleManifest | undefined {
    if (!isRecord(value)) return;
    const { label, description, members } = value;
    return {
        label: typeof label === "string" ? label : undefined,
        description: typeof description === "string" ? description : undefined,
        members: Array.isArray(members)
            ? (members.map(parseBundleMember).filter(Boolean) as PluginBundleMember[])
            : [],
    };
}

/** 解析单个成员：字段类型不符时给空串/undefined，非法条目由 filter(Boolean) 剔除。 */
function parseBundleMember(value: unknown): PluginBundleMember | undefined {
    if (!isRecord(value)) return;
    const { package: pkg, plugin, version, required, config } = value;
    return {
        package: typeof pkg === "string" ? pkg : "",
        plugin: typeof plugin === "string" ? plugin : "",
        version: typeof version === "string" ? version : "",
        required: required === true,
        config: isRecord(config) ? config : undefined,
    };
}

/** 窄化的普通对象判定（排除数组与 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 校验合包清单：包名命名、关键字、成员字段逐一检查，产出 errors（阻断）与
 * warnings（提示）。只有"疑似合包"（命名命中、声明了关键字或带 bundle 字段）
 * 才强制要求 pa-* 命名，普通插件包不受影响。纯函数，无副作用。
 *
 * @param packageName 合包 npm 包名
 * @param bundle 解析后的清单（可缺省，缺省报 missing koishi.bundle）
 * @param options.keyword 元数据是否声明了 market:package 关键字
 */
export function validateBundleManifest(
    packageName: string,
    bundle?: PluginBundleManifest,
    options: { keyword?: boolean } = {},
): PluginBundleValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalizedName = packageName.toLowerCase();
    if (packageName !== normalizedName) errors.push("package name must be lowercase");
    if (isBundlePackageName(packageName) || options.keyword || bundle) {
        if (!isBundlePackageName(packageName)) {
            errors.push(
                "bundle package name must be koishi-plugin-pa-* or @scope/koishi-plugin-pa-*",
            );
        }
    }
    if (!bundle) {
        errors.push("missing koishi.bundle");
        return { valid: false, errors, warnings };
    }
    if (!bundle.members.length) errors.push("koishi.bundle.members must not be empty");
    if (!options.keyword) warnings.push(`missing keyword "${BUNDLE_KEYWORD}"`);

    const seen = new Set<string>();
    const seenPackages = new Set<string>();
    const seenPlugins = new Set<string>();
    for (const [index, member] of bundle.members.entries()) {
        validateBundleMember(
            member,
            index,
            seen,
            seenPackages,
            seenPlugins,
            errors,
            warnings,
            packageName,
        );
    }

    return { valid: !errors.length, errors, warnings };
}

/**
 * 校验单个成员并就地写入 errors/warnings。三类去重集合分别用于：
 * package+plugin 组合完全重复（error）、同一包名重复列出（warning，
 * 允许同包不同 plugin 键）、plugin 键冲突（warning，配置键大小写不敏感）。
 */
function validateBundleMember(
    member: PluginBundleMember,
    index: number,
    seen: Set<string>,
    seenPackages: Set<string>,
    seenPlugins: Set<string>,
    errors: string[],
    warnings: string[],
    packageName: string,
) {
    const prefix = `members[${index}]`;
    const normalizedPackage = member.package.toLowerCase();
    if (!member.package) errors.push(`${prefix}.package is required`);
    else if (member.package !== normalizedPackage)
        errors.push(`${prefix}.package must be lowercase`);
    else if (!PLUGIN_PACKAGE_RE.test(member.package)) {
        errors.push(`${prefix}.package is not a valid Koishi plugin package name`);
    } else if (normalizedPackage === packageName.toLowerCase()) {
        // 防自引用：成员指向合包自身会造成安装时的循环依赖
        errors.push(`${prefix}.package must not reference the bundle package itself`);
    }

    if (!member.plugin) errors.push(`${prefix}.plugin is required`);
    else if (!/^(?:@[^/]+\/)?[0-9a-z][0-9a-z-]*(?:\/[0-9a-z][0-9a-z-]*)?$/.test(member.plugin)) {
        warnings.push(
            `${prefix}.plugin should use lowercase package-like keys to avoid config conflicts`,
        );
    }

    if (!member.version) errors.push(`${prefix}.version is required`);
    else if (!validRange(member.version.trim()))
        errors.push(`${prefix}.version is not a valid semver range`);

    // 组合键用 \n 分隔，避免包名与插件键拼在一起产生歧义碰撞
    const key = `${member.package}\n${member.plugin}`;
    if (seen.has(key)) errors.push(`${prefix} duplicates another member`);
    seen.add(key);
    if (member.package) {
        if (seenPackages.has(normalizedPackage))
            warnings.push(`${prefix}.package is listed more than once`);
        seenPackages.add(normalizedPackage);
    }
    if (member.plugin) {
        const normalizedPlugin = member.plugin.toLowerCase();
        if (seenPlugins.has(normalizedPlugin))
            warnings.push(`${prefix}.plugin may conflict with another member`);
        seenPlugins.add(normalizedPlugin);
    }
}

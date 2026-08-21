import { type Dict, Schema, Time } from "koishi";
import type { PluginBundleRecord } from "../../shared/bundle.js";
import type {
    MarketSilentCustomRule,
    MarketSilentDateRule,
    MarketSilentRecentRule,
    MarketSilentRule,
    MarketSilentStatusRule,
} from "../../shared/types.js";
import type { UpdateIgnoreRule } from "../../shared/update.js";
import { InstallerConfig } from "../installer/config.js";
import { schemaEn, schemaZh } from "../locales/generated.js";
import { MarketProviderConfig } from "../market/index.js";

export type {
    MarketSilentCustomRule,
    MarketSilentDateRule,
    MarketSilentRecentRule,
    MarketSilentRule,
    MarketSilentStatusRule,
} from "../../shared/types.js";

export interface Config {
    registry?: InstallerConfig;
    search?: MarketProviderConfig;
    frontendMode?: "performance" | "polished";
    depsLayout?: "grid" | "list";
    marketSilentStatusRules?: MarketSilentStatusRule[];
    marketSilentDateRules?: MarketSilentDateRule[];
    marketSilentRecentRules?: MarketSilentRecentRule[];
    marketSilentCustomRules?: MarketSilentCustomRule[];
    marketSilentRules?: MarketSilentRule[];
    marketSilentFilters?: string;
    idleProbe?: boolean;
    idleProbeDelay?: number;
    idleProbeBootDelay?: number;
    idleProbeInterval?: number;
    bulkMode?: boolean;
    removeConfig?: boolean | undefined;
    updateIgnoredPackages?: string;
    updateIgnoreDuration?: number;
    updateIgnoreVersions?: number;
    updateIgnorePrerelease?: boolean;
    collapsedGroups?: Dict<boolean>;
    updateIgnored?: Dict<string | UpdateIgnoreRule>;
    bundleRecords?: Dict<PluginBundleRecord>;
}

const MarketSilentRuleType = Schema.union([
    Schema.const("preview").description("状态：预览版插件"),
    Schema.const("insecure").description("状态：不安全插件"),
    Schema.const("bundle").description("状态：插件包"),
    Schema.const("created-before").description("创建时间：早于指定日期"),
    Schema.const("created-after").description("创建时间：晚于指定日期"),
    Schema.const("updated-before").description("更新时间：早于指定日期"),
    Schema.const("updated-after").description("更新时间：晚于指定日期"),
    Schema.const("created-within").description("创建时间：最近 N 天内"),
    Schema.const("updated-within").description("更新时间：最近 N 天内"),
    Schema.const("custom").description("自定义高级条件"),
]);

const MarketSilentRules = Schema.array(
    Schema.object({
        type: MarketSilentRuleType.default("preview").description("规则类型"),
        value: Schema.string()
            .default("")
            .description(
                "规则值。状态类留空；日期类填写 YYYY-MM-DD，例如 2024-01-01；最近 N 天填写数字，例如 30；自定义规则填写搜索条件，例如 category:adapter。",
            ),
        note: Schema.string().default("").description("备注"),
        enabled: Schema.boolean().default(true).description("是否启用"),
    }),
)
    .role("table")
    .default([])
    .description("插件市场永久静默过滤。添加规则后，命中的插件会直接从市场页隐藏。");

export const Config: Schema<Config> = Schema.object({
    frontendMode: Schema.union([
        Schema.const("performance").description("性能模式"),
        Schema.const("polished").description("精致模式"),
    ])
        .role("radio")
        .default("performance")
        .description("Frontend display mode."),
    depsLayout: Schema.union([
        Schema.const("grid").description("网格"),
        Schema.const("list").description("列表"),
    ])
        .role("radio")
        .default("grid")
        .description("Dependencies page layout."),
    idleProbe: Schema.boolean()
        .default(true)
        .description("Run dependency and market metadata probes while Console is idle."),
    idleProbeDelay: Schema.number()
        .role("time")
        .default(Time.minute * 5)
        .description("How long Console must stay idle before the background probe starts."),
    idleProbeBootDelay: Schema.number()
        .role("time")
        .default(Time.minute)
        .description("Minimum delay after startup before idle probing is allowed."),
    idleProbeInterval: Schema.number()
        .role("time")
        .default(Time.hour * 6)
        .description("Minimum interval between idle background probes."),
    bulkMode: Schema.boolean()
        .default(false)
        .hidden()
        .description("Batch operation mode for dependency changes."),
    removeConfig: Schema.union([
        Schema.const(undefined).description("Ask every time"),
        Schema.const(true).description("Always remove plugin config"),
        Schema.const(false).description("Never remove plugin config"),
    ])
        .hidden()
        .description("Whether to remove existing plugin config when uninstalling a plugin."),
    updateIgnoredPackages: Schema.string()
        .role("textarea")
        .hidden()
        .description("Dependency package names that should not be checked for updates."),
    updateIgnoreDuration: Schema.number()
        .role("time")
        .default(0)
        .hidden()
        .description("Default duration for ignoring one update. 0 means no time-based expiry."),
    updateIgnoreVersions: Schema.number()
        .min(1)
        .max(20)
        .step(1)
        .default(1)
        .hidden()
        .description(
            "How many consecutive newer versions should be ignored after ignoring one update.",
        ),
    updateIgnorePrerelease: Schema.boolean()
        .default(false)
        .hidden()
        .description("Ignore alpha, beta, rc and other prerelease versions when checking updates."),
    collapsedGroups: Schema.dict(Boolean).hidden(),
    registry: InstallerConfig,
    search: MarketProviderConfig,
    marketSilentFilters: Schema.string()
        .role("textarea")
        .hidden()
        .description("Legacy permanent silent filters."),
    marketSilentStatusRules: Schema.array(Schema.any()).hidden(),
    marketSilentDateRules: Schema.array(Schema.any()).hidden(),
    marketSilentRecentRules: Schema.array(Schema.any()).hidden(),
    marketSilentCustomRules: Schema.array(Schema.any()).hidden(),
    marketSilentRules: MarketSilentRules,
}).i18n({
    "zh-CN": schemaZh,
    "en-US": schemaEn,
});

/** market/update-config 白名单（只有这些键允许写回 loader 配置）。 */
export const configPatchKeys: Array<keyof Config> = [
    "frontendMode",
    "depsLayout",
    "marketSilentStatusRules",
    "marketSilentDateRules",
    "marketSilentRecentRules",
    "marketSilentCustomRules",
    "marketSilentRules",
    "marketSilentFilters",
    "idleProbe",
    "idleProbeDelay",
    "idleProbeBootDelay",
    "idleProbeInterval",
    "bulkMode",
    "removeConfig",
    "updateIgnoredPackages",
    "updateIgnoreDuration",
    "updateIgnoreVersions",
    "updateIgnorePrerelease",
];

/** 变更后需要 reload 插件的键。 */
export const configReloadKeys = new Set<keyof Config>([
    "idleProbe",
    "idleProbeDelay",
    "idleProbeBootDelay",
    "idleProbeInterval",
]);

/** market/update-config 的静默规则归一化。 */
export function normalizeMarketSilentRules(value: unknown): MarketSilentRule[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((rule): rule is MarketSilentRule => !!rule && typeof rule === "object")
        .map((rule) => {
            const normalized: MarketSilentRule = {
                value: normalizeMarketSilentRuleValue(rule),
                enabled: rule.enabled ?? true,
            };
            if (rule.type !== undefined) normalized.type = rule.type;
            if (rule.note !== undefined) normalized.note = rule.note;
            return normalized;
        });
}

function normalizeMarketSilentRuleValue(rule: MarketSilentRule) {
    const value = String(rule.value ?? "").trim();
    if (value) return value;
    if (rule.date) return String(rule.date).trim();
    if (rule.days != null) return String(rule.days).trim();
    if (rule.query) return String(rule.query).trim();
    return "";
}

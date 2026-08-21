import type { Dict } from "koishi";
import type { PluginBundleMember } from "./bundle.js";

const SENSITIVE_RE =
    /(command|script|exec|shell|path|file|token|secret|password|sql|url|webhook|endpoint)/i;

export function getPluginShortname(name: string) {
    return name.replace(/(koishi-|^@koishijs\/)plugin-/, "");
}

export function normalizeBundleIdent(value: string) {
    return (
        value
            .toLowerCase()
            .replace(/^@/, "")
            .replace(/[^0-9a-z]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "bundle"
    );
}

export function getBundleGroupIdent(packageName: string) {
    return `pa-${normalizeBundleIdent(getPluginShortname(packageName))}`;
}

export function getBundleMemberIdent(
    packageName: string,
    member: Pick<PluginBundleMember, "package" | "plugin">,
) {
    return `pa-${normalizeBundleIdent(getPluginShortname(packageName))}-${normalizeBundleIdent(getPluginShortname(member.plugin || member.package))}`;
}

export function scanSensitiveConfig(value: unknown, path = ""): string[] {
    const result: string[] = [];
    if (!value || typeof value !== "object") return result;
    for (const [key, child] of Object.entries(value as Dict)) {
        const next = path ? `${path}.${key}` : key;
        if (SENSITIVE_RE.test(key)) result.push(next);
        result.push(...scanSensitiveConfig(child, next));
    }
    return result;
}

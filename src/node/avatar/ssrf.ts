import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const AVATAR_BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const AVATAR_ALLOWED_HOSTS = new Set([
    "www.npmjs.com",
    "npmjs.com",
    "s.gravatar.com",
    "gravatar.com",
    "www.gravatar.com",
    "cravatar.cn",
    "www.cravatar.cn",
]);
const AVATAR_DEFAULT_HINTS = new Set([
    "default",
    "mp",
    "identicon",
    "monsterid",
    "wavatar",
    "retro",
    "robohash",
    "blank",
]);

/** SSRF 防护：解析目标域名并做私网/被屏蔽主机判定。 */
export async function isBlockedAvatarTarget(url: URL) {
    const hostname = normalizeAvatarHostname(url.hostname);
    if (!hostname || AVATAR_BLOCKED_HOSTS.has(hostname)) return true;
    if (isAllowedAvatarHost(hostname)) return false;
    const directIp = isIP(hostname);
    if (directIp) return isPrivateAddress(hostname, directIp);
    try {
        const records = await lookup(hostname, { all: true, verbatim: false });
        if (!records.length) return true;
        return records.some((record) => isPrivateAddress(record.address, record.family));
    } catch {
        return true;
    }
}

/** 判断某个头像 URL 是否为 gravatar 默认占位图（命中后磁盘缓存不落盘）。 */
export function isAvatarCacheLikelyDefault(url: string, key: string) {
    try {
        const parsed = new URL(url);
        const hostname = normalizeAvatarHostname(parsed.hostname);
        const isGravatarHost = [
            "cravatar.cn",
            "www.cravatar.cn",
            "s.gravatar.com",
            "gravatar.com",
            "www.gravatar.com",
        ].includes(hostname);
        if (!isGravatarHost) return false;
        if (getAvatarDefaultMode(parsed)) return true;
        if (!key.startsWith("gravatar:")) return false;
        const mode = (parsed.searchParams.get("d") || parsed.searchParams.get("default") || "")
            .trim()
            .toLowerCase();
        return mode !== "404";
    } catch {
        return false;
    }
}

export function isAvatarDefaultResponse(headers: Headers) {
    const from = headers.get("avatar-from")?.trim().toLowerCase();
    return from === "default" || from === "mp";
}

function isAllowedAvatarHost(hostname: string) {
    return AVATAR_ALLOWED_HOSTS.has(hostname);
}

function normalizeAvatarHostname(hostname: string) {
    return hostname
        .toLowerCase()
        .replace(/^\[(.*)\]$/, "$1")
        .replace(/\.$/, "");
}

function getAvatarDefaultMode(url: URL) {
    const value = url.searchParams.get("d") || url.searchParams.get("default") || "";
    const normalized = value.trim().toLowerCase();
    return normalized && AVATAR_DEFAULT_HINTS.has(normalized) ? normalized : "";
}

function isPrivateAddress(address: string, family = isIP(address)) {
    if (family === 4) {
        const parts = address.split(".").map((part) => Number(part));
        if (
            parts.length !== 4 ||
            parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
        )
            return true;
        const a = parts[0]!;
        const b = parts[1]!;
        return (
            a === 0 ||
            a === 10 ||
            a === 127 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168) ||
            a >= 224
        );
    }
    if (family === 6) {
        const value = address.toLowerCase();
        const first = Number.parseInt(value.split(":")[0] || "0", 16);
        return (
            value === "::1" ||
            value === "::" ||
            value.startsWith("::ffff:") ||
            (Number.isFinite(first) && (first & 0xffc0) === 0xfe80) ||
            value.startsWith("fc") ||
            value.startsWith("fd") ||
            value.startsWith("ff")
        );
    }
    return true;
}

import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { type Context, Time } from "koishi";
import { writeJsonAtomic } from "../../core/utils/atomic-write.js";
import { isAvatarCacheLikelyDefault } from "./ssrf.js";

export interface AvatarFetchResult {
    data: string;
    type: string;
    cached?: boolean;
    key?: string;
}

interface AvatarDiskCacheEntry extends AvatarFetchResult {
    key: string;
    url: string;
    cachedAt: number;
}

const avatarCache = new Map<string, AvatarFetchResult & { expiresAt: number }>();
const AVATAR_CACHE_TTL = Time.day * 7;
export const AVATAR_CACHE_SWEEP_INTERVAL = Time.hour;
const AVATAR_MAX_ENTRIES = 512;

let avatarDiskCleanupTask: Promise<void> | undefined;

export function cleanupAvatarCache() {
    const now = Date.now();
    for (const [key, entry] of avatarCache) {
        if (entry.expiresAt <= now) avatarCache.delete(key);
    }
    while (avatarCache.size > AVATAR_MAX_ENTRIES) {
        const key = avatarCache.keys().next().value;
        if (!key) break;
        avatarCache.delete(key);
    }
}

export function cleanupAvatarCaches(ctx: Context) {
    cleanupAvatarCache();
    void cleanupAvatarDiskCache(ctx);
}

export function clearAvatarMemoryCache() {
    avatarCache.clear();
}

export function getAvatarMemoryCache(key: string) {
    return avatarCache.get(key);
}

export function cacheAvatarMemory(key: string, result: AvatarFetchResult) {
    avatarCache.set(key, { ...result, expiresAt: Date.now() + AVATAR_CACHE_TTL });
}

function getAvatarCacheDir(ctx: Context) {
    return resolve(ctx.baseDir, "cache", "market-next-avatars");
}

export function normalizeAvatarCacheKey(key: string) {
    return (
        key.replace(/[^0-9A-Za-z:@._-]/g, "-").slice(0, 128) ||
        `url:${createHash("sha1").update(key).digest("hex")}`
    );
}

function getAvatarCacheFile(ctx: Context, key: string) {
    return resolve(
        getAvatarCacheDir(ctx),
        `${createHash("sha1").update(normalizeAvatarCacheKey(key)).digest("hex")}.json`,
    );
}

function normalizeAvatarDiskCache(value: unknown, key: string): AvatarDiskCacheEntry | undefined {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record["key"] && record["key"] !== key) return;
    if (!record["key"] && record["url"] !== key) return;
    if (typeof record["url"] !== "string" || !record["url"]) return;
    if (typeof record["type"] !== "string" || !record["type"].startsWith("image/")) return;
    if (typeof record["data"] !== "string" || !record["data"]) return;
    const cachedAt = Number(record["cachedAt"]);
    if (!Number.isFinite(cachedAt)) return;
    if (Date.now() - cachedAt > AVATAR_CACHE_TTL) return;
    return { key, url: record["url"], type: record["type"], data: record["data"], cachedAt };
}

export async function readAvatarDiskCache(
    ctx: Context,
    key: string,
): Promise<AvatarFetchResult | undefined> {
    try {
        const file = getAvatarCacheFile(ctx, key);
        const entry = normalizeAvatarDiskCache(JSON.parse(await fsp.readFile(file, "utf8")), key);
        if (!entry) {
            void fsp.unlink(file).catch(() => {});
            return;
        }
        if (isAvatarCacheLikelyDefault(entry.url, key)) {
            void fsp.unlink(file).catch(() => {});
            return;
        }
        avatarCache.set(key, {
            data: entry.data,
            type: entry.type,
            expiresAt: entry.cachedAt + AVATAR_CACHE_TTL,
        });
        return { data: entry.data, type: entry.type, cached: true };
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            ctx.logger("market").debug(
                `failed to read avatar disk cache: ${error instanceof Error ? error.message : error}`,
            );
        }
    }
    return undefined;
}

export async function writeAvatarDiskCache(
    ctx: Context,
    key: string,
    url: string,
    result: AvatarFetchResult,
) {
    try {
        const file = getAvatarCacheFile(ctx, key);
        const entry: AvatarDiskCacheEntry = {
            key,
            url,
            type: result.type,
            data: result.data,
            cachedAt: Date.now(),
        };
        await writeJsonAtomic(file, entry, { newline: false });
    } catch (error) {
        ctx.logger("market").debug(
            `failed to write avatar disk cache: ${error instanceof Error ? error.message : error}`,
        );
    }
}

async function cleanupAvatarDiskCache(ctx: Context) {
    if (avatarDiskCleanupTask) return avatarDiskCleanupTask;
    avatarDiskCleanupTask = (async () => {
        try {
            const dir = getAvatarCacheDir(ctx);
            const files = await fsp.readdir(dir).catch(() => [] as string[]);
            const entries = await Promise.all(
                files
                    .filter((file) => file.endsWith(".json"))
                    .map(async (file) => {
                        const path = resolve(dir, file);
                        try {
                            const stat = await fsp.stat(path);
                            let cachedAt = stat.mtimeMs;
                            try {
                                const value = JSON.parse(await fsp.readFile(path, "utf8"));
                                cachedAt = Number(value.cachedAt) || cachedAt;
                                if (
                                    !value?.key ||
                                    !value?.url ||
                                    typeof value?.data !== "string" ||
                                    typeof value?.type !== "string"
                                ) {
                                    await fsp.unlink(path).catch(() => {});
                                    return;
                                }
                                if (
                                    isAvatarCacheLikelyDefault(
                                        value.url,
                                        normalizeAvatarCacheKey(value.key),
                                    )
                                ) {
                                    await fsp.unlink(path).catch(() => {});
                                    return;
                                }
                            } catch {
                                await fsp.unlink(path).catch(() => {});
                                return;
                            }
                            if (Date.now() - cachedAt > AVATAR_CACHE_TTL) {
                                await fsp.unlink(path).catch(() => {});
                                return;
                            }
                            return { path, cachedAt };
                        } catch {
                            return;
                        }
                    }),
            );
            const alive = entries.filter(
                (entry): entry is { path: string; cachedAt: number } => !!entry,
            );
            alive.sort((a, b) => b.cachedAt - a.cachedAt);
            await Promise.all(
                alive
                    .slice(AVATAR_MAX_ENTRIES)
                    .map((entry) => fsp.unlink(entry.path).catch(() => {})),
            );
        } finally {
            avatarDiskCleanupTask = undefined;
        }
    })();
    return avatarDiskCleanupTask;
}

export async function clearAvatarCacheStorage(ctx: Context) {
    const memory = avatarCache.size;
    avatarCache.clear();
    if (avatarDiskCleanupTask) await avatarDiskCleanupTask.catch(() => {});
    const dir = getAvatarCacheDir(ctx);
    const files = await fsp.readdir(dir).catch((error) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [] as string[];
        throw error;
    });
    const disk = files.filter((file) => file.endsWith(".json")).length;
    await fsp.rm(dir, { recursive: true, force: true });
    return { memory, disk };
}

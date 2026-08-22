/**
 * @file 头像双级缓存:进程内 Map + baseDir/cache/market-next-avatars 磁盘 JSON。
 *
 * 模块职责:
 * - 内存缓存(TTL 7 天、上限 512 条)提供零 I/O 的同步命中路径;
 * - 磁盘缓存跨进程重启存活,读回时逐条校验 key/url/type/data/cachedAt,
 *   过期或疑似 gravatar 默认占位图的条目直接删除、不回填内存;
 * - 清理任务单飞去重,所有清理/读写失败都静默降级(缓存只加速,不影响正确性)。
 *
 * 关键设计:
 * - 磁盘文件名 = sha1(归一化 key):归一化只保留 [0-9A-Za-z:@._-] 并截断
 *   128 字符,归一化结果为空时回退整串 sha1,保证文件名安全且定长;
 * - 写盘走 writeJsonAtomic,避免读到半截 JSON;
 * - 疑似默认占位图的条目不落盘也不回读:占位图与具体用户无关,缓存只会污染。
 *
 * 架构位置:node 适配层 avatar 模块,被 avatar/index.ts 的 fetchAvatar 与
 * plugin.clear-avatar-cache 命令消费。
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { type Context, Time } from "koishi";
import { writeJsonAtomic } from "../../core/utils/atomic-write.js";
import { isAvatarCacheLikelyDefault } from "./ssrf.js";

/** 头像抓取/缓存命中的统一返回结构。 */
export interface AvatarFetchResult {
    /** base64 编码的图片内容 */
    data: string;
    /** Content-Type(本模块只接受 image/* 前缀) */
    type: string;
    /** 命中缓存时为 true */
    cached?: boolean;
    /** 预留字段:当前实现不填充,磁盘条目的 key 存在 AvatarDiskCacheEntry 上 */
    key?: string;
}

/** 磁盘缓存条目:抓取结果 + 请求键、来源 URL 与写入时间(用于回读校验与判过期)。 */
interface AvatarDiskCacheEntry extends AvatarFetchResult {
    key: string;
    url: string;
    cachedAt: number;
}

/** 内存缓存:key = 归一化缓存键,value = 抓取结果 + 过期时间戳。 */
const avatarCache = new Map<string, AvatarFetchResult & { expiresAt: number }>();
/** 缓存有效期(内存与磁盘共用同一 TTL):7 天。 */
const AVATAR_CACHE_TTL = Time.day * 7;
/** 对外暴露的清扫间隔(1 小时),供 index.ts / 宿主注册定时清扫。 */
export const AVATAR_CACHE_SWEEP_INTERVAL = Time.hour;
/** 缓存条数上限:超出后按插入顺序(FIFO)逐出最旧条目。 */
const AVATAR_MAX_ENTRIES = 512;

/** 进行中的磁盘清理任务(单飞:并发调用复用同一轮清理)。 */
let avatarDiskCleanupTask: Promise<void> | undefined;

/** 清扫内存缓存:先删过期条目,再按插入顺序逐出最旧的直至回到上限。 */
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

/** 全量清理入口:先清内存,再异步触发磁盘清理(void:不等待扫盘完成)。 */
export function cleanupAvatarCaches(ctx: Context) {
    cleanupAvatarCache();
    void cleanupAvatarDiskCache(ctx);
}

/** 清空内存缓存(测试与手动清理用,不碰磁盘)。 */
export function clearAvatarMemoryCache() {
    avatarCache.clear();
}

/** 读内存缓存条目(含 expiresAt,是否过期由调用方判断)。 */
export function getAvatarMemoryCache(key: string) {
    return avatarCache.get(key);
}

/** 写入内存缓存条目,按 TTL 附加过期时间。 */
export function cacheAvatarMemory(key: string, result: AvatarFetchResult) {
    avatarCache.set(key, { ...result, expiresAt: Date.now() + AVATAR_CACHE_TTL });
}

/** 磁盘缓存目录:baseDir/cache/market-next-avatars。 */
function getAvatarCacheDir(ctx: Context) {
    return resolve(ctx.baseDir, "cache", "market-next-avatars");
}

/**
 * 归一化缓存键:把文件系统不安全字符替换成 "-",并截断到 128 字符。
 * 全部字符被过滤导致结果为空时,回退为整串 sha1,保证键恒非空且可参与
 * 文件名构造。
 */
export function normalizeAvatarCacheKey(key: string) {
    return (
        key.replace(/[^0-9A-Za-z:@._-]/g, "-").slice(0, 128) ||
        `url:${createHash("sha1").update(key).digest("hex")}`
    );
}

/** 缓存文件路径:目录 + sha1(归一化键).json(避免键超长或特殊字符进入文件名)。 */
function getAvatarCacheFile(ctx: Context, key: string) {
    return resolve(
        getAvatarCacheDir(ctx),
        `${createHash("sha1").update(normalizeAvatarCacheKey(key)).digest("hex")}.json`,
    );
}

/**
 * 校验并归一化磁盘缓存条目:结构不完整、key(旧格式退回 url)与请求键不
 * 匹配、type 非 image/*、cachedAt 非法或已超过 TTL 的条目一律判无效,
 * 交由调用方删除文件。宁可 miss 也不能让脏数据回到内存缓存。
 */
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

/**
 * 读取磁盘缓存:命中且有效时回填内存缓存并返回 cached: true;条目无效或
 * 疑似 gravatar 默认占位图时删除文件并返回 undefined(占位图不配占用缓存)。
 * 读失败只记 debug,ENOENT(首次无缓存)连日志都不记。
 */
export async function readAvatarDiskCache(
    ctx: Context,
    key: string,
): Promise<AvatarFetchResult | undefined> {
    try {
        const file = getAvatarCacheFile(ctx, key);
        const entry = normalizeAvatarDiskCache(JSON.parse(await fsp.readFile(file, "utf8")), key);
        if (!entry) {
            // 无效条目顺手清掉,避免下次再解析一遍
            void fsp.unlink(file).catch(() => {});
            return;
        }
        if (isAvatarCacheLikelyDefault(entry.url, key)) {
            void fsp.unlink(file).catch(() => {});
            return;
        }
        // 回填内存缓存:过期时间沿用磁盘条目的 cachedAt + TTL,而非重新计时
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

/**
 * 写入磁盘缓存(原子写)。失败只记 debug:磁盘缓存写失败只损失跨重启的
 * 命中率,不应打断头像抓取主流程。
 */
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

/**
 * 磁盘清理(单飞去重:并发调用复用同一轮任务,结束后清空引用允许下轮)。
 * 扫描目录内全部 .json:结构损坏、疑似默认占位图、超过 TTL 的文件就地删除;
 * 幸存条目按 cachedAt 从新到旧排序,超出上限的末尾部分批量删除。
 */
async function cleanupAvatarDiskCache(ctx: Context) {
    if (avatarDiskCleanupTask) return avatarDiskCleanupTask;
    avatarDiskCleanupTask = (async () => {
        try {
            const dir = getAvatarCacheDir(ctx);
            // 目录不存在(从未写过缓存)视作空目录
            const files = await fsp.readdir(dir).catch(() => [] as string[]);
            const entries = await Promise.all(
                files
                    .filter((file) => file.endsWith(".json"))
                    .map(async (file) => {
                        const path = resolve(dir, file);
                        try {
                            const stat = await fsp.stat(path);
                            // mtime 兜底:JSON 解析失败或没有 cachedAt 时按文件时间判过期
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
            // 新->旧排序后,超过上限的尾部即最旧条目,批量删除
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

/**
 * 彻底清空缓存存储:清内存、等待在途清理任务收尾、整目录递归删除。
 * 返回删除前的内存条数与磁盘 .json 文件数,供 clear-avatar-cache 命令回显。
 */
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

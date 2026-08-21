import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Dict } from "koishi";
import type { RouteStatsBook } from "../../racing/stats.js";
import { formatError } from "../../utils/format.js";
import { clamp } from "../../utils/math.js";
import type { CacheEntry, CacheFile, CacheStore, PersistedRouteStats } from "../types.js";

export interface CacheIoDeps {
    cacheFile: string;
    cacheDir: string;
    stats: RouteStatsBook;
    log: { debug(message: string): void; warn(message: string): void };
}

/** 路由统计共储序列化（v3 布局）。 */
export function serializeRouteStats(stats: RouteStatsBook): Dict<PersistedRouteStats> {
    const result: Dict<PersistedRouteStats> = {};
    for (const [endpoint, entry] of Object.entries(stats.stats)) {
        if (!entry) continue;
        result[endpoint] = {
            score: clamp(entry.score, -6, 3),
            averageElapsed: entry.averageElapsed,
            lastSuccess: entry.lastSuccess,
            contentEncoding: entry.contentEncoding,
            consecutiveFailures: entry.consecutiveFailures,
            cooldownUntil: entry.cooldownUntil,
        };
    }
    return result;
}

/** 原子写缓存清单 + 拆分条目文件，并清理失效拆分文件。移植自旧 MarketProvider 缓存写入族。 */
export async function writeCacheStore(deps: CacheIoDeps, cache: CacheStore) {
    try {
        await fsp.mkdir(dirname(deps.cacheFile), { recursive: true });
        const entries: Dict<CacheEntry> = {};
        for (const [endpoint, entry] of Object.entries(cache.entries)) {
            if (!entry) continue;
            if (Array.isArray(entry.result?.objects)) {
                await writeEntryFile(deps, entry as CacheFile);
                const { result: _result, ...meta } = entry as CacheFile;
                entries[endpoint] = {
                    ...meta,
                    file: entryFilename(endpoint),
                    objects: _result.objects.length,
                };
            } else if (entry.file) {
                entries[endpoint] = entry;
            }
        }
        const tempFile = `${deps.cacheFile}.${process.pid}.${Date.now()}.tmp`;
        await fsp.writeFile(tempFile, JSON.stringify({ ...cache, version: 3, entries }));
        await fsp.rename(tempFile, deps.cacheFile);
        await pruneFiles(deps, entries);
    } catch (error) {
        deps.log.warn(`failed to write market disk cache: ${formatError(error)}`);
    }
    return undefined;
}

function entryFilename(endpoint: string) {
    return `${createHash("sha1").update(endpoint).digest("hex").slice(0, 16)}.json`;
}

async function writeEntryFile(deps: CacheIoDeps, entry: CacheFile) {
    await fsp.mkdir(deps.cacheDir, { recursive: true });
    const file = resolve(deps.cacheDir, entryFilename(entry.endpoint));
    const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tempFile, JSON.stringify(entry.result));
    await fsp.rename(tempFile, file);
}

async function pruneFiles(deps: CacheIoDeps, entries: Dict<CacheEntry>) {
    try {
        const keep = new Set(
            Object.values(entries)
                .map((entry) => entry?.file)
                .filter(Boolean),
        );
        const files = await fsp.readdir(deps.cacheDir).catch(() => [] as string[]);
        await Promise.all(
            files
                .filter((file) => file.endsWith(".json") && !keep.has(file))
                .map((file) => fsp.unlink(resolve(deps.cacheDir, file)).catch(() => {})),
        );
    } catch (error) {
        deps.log.debug(`failed to prune split market cache files: ${formatError(error)}`);
    }
}

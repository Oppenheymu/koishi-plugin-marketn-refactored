import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import { assertInside, readFileHash } from "./tar.js";

export const LOCAL_UPLOAD_CHUNK_SIZE = 512 * 1024;

export function validateUploadFilename(value: unknown) {
    if (
        typeof value !== "string" ||
        basename(value) !== value ||
        !value.toLowerCase().endsWith(".tgz")
    ) {
        throw new Error("请选择 npm pack 生成的 .tgz 文件。");
    }
    return value;
}

export function decodeBase64Chunk(value: unknown) {
    if (
        typeof value !== "string" ||
        value.length > Math.ceil(LOCAL_UPLOAD_CHUNK_SIZE / 3) * 4 + 4 ||
        value.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
    ) {
        throw new Error("本地插件上传分块编码无效。");
    }
    const buffer = Buffer.from(value, "base64");
    if (buffer.toString("base64") !== value) throw new Error("本地插件上传分块编码无效。");
    return buffer;
}

export function formatUploadBytes(value: number) {
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KiB`;
    return `${Math.ceil(value / 1024 / 1024)} MiB`;
}

/** 清理过期的孤儿分片文件（不属于任何活跃会话且超过 TTL）。 */
export async function sweepTemporaryUploads(
    temporaryRoot: string,
    activePaths: Set<string>,
    now: number,
    ttl: number,
) {
    const entries = await fsp.readdir(temporaryRoot, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
        throw error;
    });
    await Promise.all(
        entries.map(async (entry) => {
            if (!entry.isFile() || !entry.name.endsWith(".part")) return;
            const path = resolve(temporaryRoot, entry.name);
            if (activePaths.has(path)) return;
            const stat = await fsp.stat(path);
            if (now - stat.mtimeMs <= ttl) return;
            await fsp.rm(path, { force: true });
        }),
    );
}

/** 原子落位：目标已存在则校验哈希一致，rename 竞态时复核。 */
export async function placeUploadArchive(
    root: string,
    sessionPath: string,
    targetFilename: string,
    hash: string,
) {
    const target = resolve(root, targetFilename);
    assertInside(root, target);
    const existing = await readFileHash(target);
    if (existing && existing !== hash) {
        throw new Error("同名本地插件归档已存在，但文件内容不一致。");
    }
    if (!existing) {
        try {
            await fsp.rename(sessionPath, target);
        } catch (error) {
            const concurrent = await readFileHash(target);
            if (concurrent !== hash) throw error;
            await fsp.rm(sessionPath, { force: true });
        }
    } else {
        await fsp.rm(sessionPath, { force: true });
    }
    return target;
}

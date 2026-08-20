import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { dirname, relative } from "node:path";
import type { PackageJson } from "@koishijs/registry";
import { valid } from "semver";
import { list } from "tar";
import { Scanner } from "../registry/manifest.js";
import { createHashedLocalBindingFilename } from "./local-binding.js";

const MAX_ARCHIVE_ENTRIES = 8192;
const MAX_ARCHIVE_EXPANDED_SIZE = 256 * 1024 * 1024;
const MAX_PACKAGE_MANIFEST_SIZE = 1024 * 1024;

/** 校验并读取 .tgz 归档根部的 package/package.json（防解压炸弹/路径穿越/符号链接）。 */
export async function inspectPackageArchive(path: string): Promise<PackageJson> {
    let entryCount = 0;
    let expandedSize = 0;
    let manifestFound = false;
    const chunks: Buffer[] = [];

    try {
        await list({
            file: path,
            strict: true,
            maxReadSize: 1024 * 1024,
            maxMetaEntrySize: 1024 * 1024,
            maxDecompressionRatio: 200,
            onReadEntry(entry) {
                entryCount++;
                expandedSize += Number(entry.size) || 0;
                if (entryCount > MAX_ARCHIVE_ENTRIES || expandedSize > MAX_ARCHIVE_EXPANDED_SIZE) {
                    throw new Error("本地插件归档解压后内容过大或文件数量过多。");
                }
                validateArchiveEntry(entry.path, entry.type);
                if (entry.path.replace(/\\/g, "/") !== "package/package.json") return;
                if (manifestFound) throw new Error("本地插件归档包含重复的 package.json。");
                if (entry.size <= 0 || entry.size > MAX_PACKAGE_MANIFEST_SIZE) {
                    throw new Error("本地插件 package.json 大小无效。");
                }
                manifestFound = true;
                entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
            },
        });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`无法读取本地插件归档：${detail}`);
    }

    if (!manifestFound)
        throw new Error("本地插件归档中缺少 package/package.json。请使用 npm pack 生成 .tgz。");
    let manifest: PackageJson;
    try {
        manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        throw new Error("本地插件 package.json 不是有效的 JSON。");
    }
    if (!manifest || typeof manifest !== "object") throw new Error("本地插件 package.json 无效。");
    if (typeof manifest.name !== "string" || !Scanner.isPlugin(manifest.name)) {
        throw new Error("归档中的包名不是有效的 Koishi 插件名称。");
    }
    if (typeof manifest.version !== "string" || !valid(manifest.version)) {
        throw new Error("归档中的插件版本不是有效的 SemVer。");
    }
    return manifest;
}

function validateArchiveEntry(value: string, type: string) {
    const path = value.replace(/\\/g, "/");
    const parts = path.split("/").filter(Boolean);
    if (!path || path.startsWith("/") || parts[0] !== "package" || parts.includes("..")) {
        throw new Error(`本地插件归档包含非法路径：${value}`);
    }
    if (
        type === "SymbolicLink" ||
        type === "Link" ||
        type === "CharacterDevice" ||
        type === "BlockDevice" ||
        type === "FIFO"
    ) {
        throw new Error(`本地插件归档包含不允许的条目类型：${type}`);
    }
}

/** 生成 .yarn/local 下的规范归档文件名（含内容 hash 前缀）。 */
export function createCanonicalLocalPackageFilename(name: string, version: string, hash: string) {
    const slug = name
        .replace(/^@/, "")
        .replace(/[\\/]+/g, "-")
        .replace(/[^a-z0-9@._+-]+/gi, "-")
        .slice(0, 120);
    return createHashedLocalBindingFilename(`${slug}-${version}.tgz`, hash.slice(0, 12));
}

/** 读取文件内容 sha256；不存在返回 undefined。 */
export async function readFileHash(path: string) {
    try {
        const stat = await fsp.stat(path);
        if (!stat.isFile()) throw new Error("本地插件归档目标不是文件。");
        return createHash("sha256")
            .update(await fsp.readFile(path))
            .digest("hex");
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
        throw error;
    }
}

export function assertInside(root: string, target: string) {
    if (dirname(target) !== root || relative(root, target).startsWith("..")) {
        throw new Error("本地插件归档目标路径无效。");
    }
}

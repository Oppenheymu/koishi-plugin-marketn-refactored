import { promises as fsp, type Stats } from "node:fs";
import { basename } from "node:path";
import type {
    InstallHistoryEntry,
    InstallHistoryMetadata,
    InstallHistoryStatus,
    InstallLogDetail,
    InstallLogger,
} from "../types.js";
import {
    getInstallLogDir,
    getInstallLogPath,
    INSTALL_LOG_DETAIL_LIMIT,
    INSTALL_LOG_HEAD_LIMIT,
    INSTALL_LOG_TAIL_LIMIT,
} from "./retention.js";
import { sanitizeInstallLogText } from "./store.js";

export interface InstallLogReaderDeps {
    cwd: string;
    log: InstallLogger;
    activeFile: () => string | undefined;
    waitForWrite: () => Promise<void>;
    cleanup: () => Promise<void>;
}

async function readInstallLogMetadata(cwd: string, id: string, log: InstallLogger) {
    const file = getInstallLogPath(cwd, id);
    if (!file) return undefined;
    try {
        const metadata: InstallHistoryMetadata = JSON.parse(
            await fsp.readFile(`${file}.json`, "utf8"),
        );
        if (metadata?.version !== 1 || metadata.id !== id || !Array.isArray(metadata.changes))
            return undefined;
        return metadata;
    } catch (error) {
        if (
            (error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT" &&
            !(error instanceof SyntaxError)
        ) {
            log.debug(
                `failed to read install log metadata ${id}: ${error instanceof Error ? error.message : error}`,
            );
        }
        return undefined;
    }
}

async function readInstallLog(file: string, limit: number, headLimit: number, tailLimit: number) {
    const stat = await fsp.stat(file);
    if (stat.size <= limit) {
        return {
            content: await fsp.readFile(file, "utf8"),
            truncated: false,
            size: stat.size,
        };
    }
    const handle = await fsp.open(file, "r");
    try {
        const headSize = Math.min(headLimit, stat.size);
        const tailSize = Math.min(tailLimit, Math.max(0, stat.size - headSize));
        const head = Buffer.alloc(headSize);
        const tail = Buffer.alloc(tailSize);
        if (headSize) await handle.read(head, 0, headSize, 0);
        if (tailSize) await handle.read(tail, 0, tailSize, stat.size - tailSize);
        return {
            content: `${head.toString("utf8")}\n\n... ${stat.size - headSize - tailSize} bytes omitted ...\n\n${tail.toString("utf8")}`,
            truncated: true,
            size: stat.size,
        };
    } finally {
        await handle.close();
    }
}

function parseLegacyInstallLog(
    id: string,
    content: string,
    size: number,
    activeFile?: string,
): InstallHistoryEntry {
    const fields = parseLegacyFields(content);
    const active = basename(activeFile || "") === id;
    const status = resolveLegacyStatus(content, active);
    const finishedAt = getLegacyFinishedAt(content, status);
    return {
        id,
        startedAt: fields.startedAt,
        finishedAt,
        duration:
            fields.startedAt && finishedAt ? Math.max(0, finishedAt - fields.startedAt) : undefined,
        status,
        deps: fields.deps,
        forced: fields.forced,
        installEndpoint:
            fields.endpoint && fields.endpoint !== "(default)" ? fields.endpoint : undefined,
        size,
        changes: [],
    };
}

function parseLegacyFields(content: string) {
    const field = (name: string) =>
        content.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1]?.trim();
    return {
        startedAt: Date.parse(field("startedAt") || "") || 0,
        deps: field("deps") || "(unknown)",
        forced: field("forced") === "true",
        endpoint: field("installEndpoint"),
    };
}

function resolveLegacyStatus(content: string, active: boolean): InstallHistoryStatus {
    if (active) return "running";
    if (/dependency operation finished with code 0\s*$/m.test(content)) return "success";
    if (
        /dependency operation (?:failed|finished with code|ended without)|package manager (?:terminated|failed to start)/m.test(
            content,
        )
    ) {
        return "error";
    }
    return "unknown";
}

function getLegacyFinishedAt(content: string, status: InstallHistoryStatus) {
    if (status === "running") return undefined;
    const timestamps = [...content.matchAll(/^\[([^\]]+)\]/gm)];
    return Date.parse(timestamps[timestamps.length - 1]?.[1] || "") || undefined;
}

function createInstallHistoryEntry(
    metadata: InstallHistoryMetadata,
    size: number,
    activeFile?: string,
): InstallHistoryEntry {
    const status: InstallHistoryStatus =
        metadata.status === "running" && basename(activeFile || "") !== metadata.id
            ? "unknown"
            : metadata.status;
    return {
        id: metadata.id,
        startedAt: metadata.startedAt,
        finishedAt: metadata.finishedAt,
        duration: metadata.finishedAt
            ? Math.max(0, metadata.finishedAt - metadata.startedAt)
            : undefined,
        status,
        deps: metadata.deps,
        forced: metadata.forced,
        installEndpoint: metadata.installEndpoint,
        size,
        changes: metadata.changes,
    };
}

async function getInstallHistoryEntry(
    id: string,
    deps: InstallLogReaderDeps,
): Promise<InstallHistoryEntry | undefined> {
    const file = getInstallLogPath(deps.cwd, id);
    if (!file) return undefined;
    if (file === deps.activeFile()) await deps.waitForWrite();
    let stat: Stats;
    try {
        stat = await fsp.stat(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") throw error;
        return undefined;
    }
    const metadata = await readInstallLogMetadata(deps.cwd, id, deps.log);
    if (metadata) return createInstallHistoryEntry(metadata, stat.size, deps.activeFile());
    const preview = await readInstallLog(
        file,
        INSTALL_LOG_HEAD_LIMIT + INSTALL_LOG_TAIL_LIMIT,
        INSTALL_LOG_HEAD_LIMIT,
        INSTALL_LOG_TAIL_LIMIT,
    );
    return parseLegacyInstallLog(id, preview.content, stat.size, deps.activeFile());
}

export async function getInstallHistory(
    limit = 20,
    deps: InstallLogReaderDeps,
): Promise<InstallHistoryEntry[]> {
    await deps.cleanup();
    const count = Math.min(50, Math.max(1, Math.floor(Number(limit) || 20)));
    const dir = getInstallLogDir(deps.cwd);
    let files: Array<{ id: string; mtime: number }> = [];
    try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        files = (
            await Promise.all(
                entries
                    .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
                    .map(async (entry) => ({
                        id: entry.name,
                        mtime: (await fsp.stat(`${dir}/${entry.name}`)).mtimeMs,
                    })),
            )
        )
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, count);
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
        throw error;
    }
    const records = await Promise.all(files.map((file) => getInstallHistoryEntry(file.id, deps)));
    return records.filter((item): item is InstallHistoryEntry => !!item);
}

export async function getInstallLogDetail(
    id: string,
    deps: InstallLogReaderDeps,
): Promise<InstallLogDetail | undefined> {
    const file = getInstallLogPath(deps.cwd, id);
    if (!file) return undefined;
    const entry = await getInstallHistoryEntry(id, deps);
    if (!entry) return undefined;
    const result = await readInstallLog(file, INSTALL_LOG_DETAIL_LIMIT, 128 * 1024, 384 * 1024);
    return {
        ...entry,
        content: sanitizeInstallLogText(result.content),
        truncated: result.truncated,
    };
}

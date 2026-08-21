import { createHash, randomUUID } from "node:crypto";
import { promises as fsp } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";
import { resolve } from "node:path";
import type { PackageJson } from "@koishijs/registry";
import { createLocalBindingRequest, MAX_LOCAL_BINDING_PACK_SIZE } from "./local-binding.js";
import {
    decodeBase64Chunk,
    formatUploadBytes,
    LOCAL_UPLOAD_CHUNK_SIZE,
    placeUploadArchive,
    sweepTemporaryUploads,
    validateUploadFilename,
} from "./session-io.js";
import { createCanonicalLocalPackageFilename, inspectPackageArchive } from "./tar.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "./types.js";

const LOCAL_UPLOAD_TTL = 15 * 60 * 1000;

interface ValidatedLocalPackage {
    manifest: PackageJson;
    hash: string;
    targetFilename: string;
}

interface LocalUploadSession {
    id: string;
    originalFilename: string;
    path: string;
    size: number;
    received: number;
    nextIndex: number;
    touchedAt: number;
    handle?: FileHandle | undefined;
    hash: ReturnType<typeof createHash>;
    validated?: ValidatedLocalPackage | undefined;
}

/** 本地 .tgz 分块上传会话：分片写入、解包校验、原子落位 .yarn/local。 */
export class LocalPackageUploadStore {
    private readonly root: string;
    private readonly temporaryRoot: string;
    private readonly sessions = new Map<string, LocalUploadSession>();
    private readonly warn: (message: string) => void;

    constructor(baseDir: string, warn: (message: string) => void) {
        this.root = resolve(baseDir, ".yarn", "local");
        this.temporaryRoot = resolve(this.root, ".market-next-upload");
        this.warn = warn;
    }

    async start(request: LocalPackageUploadStartRequest): Promise<LocalPackageUploadStartResult> {
        await this.pruneExpired();
        const filename = validateUploadFilename(request?.filename);
        const size = Number(request?.size);
        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_LOCAL_BINDING_PACK_SIZE) {
            throw new Error(
                `本地插件归档大小必须在 1 B 到 ${formatUploadBytes(MAX_LOCAL_BINDING_PACK_SIZE)} 之间。`,
            );
        }

        await fsp.mkdir(this.temporaryRoot, { recursive: true });
        const uploadId = randomUUID();
        const path = resolve(this.temporaryRoot, `${uploadId}.part`);
        const handle = await open(path, "wx");
        this.sessions.set(uploadId, {
            id: uploadId,
            originalFilename: filename,
            path,
            size,
            received: 0,
            nextIndex: 0,
            touchedAt: Date.now(),
            handle,
            hash: createHash("sha256"),
        });
        return {
            uploadId,
            chunkSize: LOCAL_UPLOAD_CHUNK_SIZE,
            maxSize: MAX_LOCAL_BINDING_PACK_SIZE,
        };
    }

    async append(request: LocalPackageUploadChunkRequest): Promise<LocalPackageUploadProgress> {
        const session = this.getSession(request?.uploadId);
        if (session.validated) throw new Error("本地插件归档已经完成校验。");
        if (!Number.isSafeInteger(request?.index) || request.index !== session.nextIndex) {
            throw new Error("本地插件上传分块顺序无效，请重新上传。");
        }
        const buffer = decodeBase64Chunk(request?.data);
        const remaining = session.size - session.received;
        if (
            !buffer.length ||
            buffer.length > LOCAL_UPLOAD_CHUNK_SIZE ||
            buffer.length > remaining
        ) {
            throw new Error("本地插件上传分块大小无效，请重新上传。");
        }
        if (!session.handle) throw new Error("本地插件上传会话已经关闭。");

        const { bytesWritten } = await session.handle.write(
            buffer,
            0,
            buffer.length,
            session.received,
        );
        if (bytesWritten !== buffer.length) throw new Error("本地插件归档写入不完整，请重新上传。");
        session.hash.update(buffer);
        session.received += bytesWritten;
        session.nextIndex++;
        session.touchedAt = Date.now();
        return { received: session.received, size: session.size };
    }

    async finish(
        request: LocalPackageUploadFinishRequest,
    ): Promise<ValidatedLocalPackage & { uploadId: string; filename: string; size: number }> {
        const session = this.getSession(request?.uploadId);
        if (session.validated) {
            return {
                ...session.validated,
                uploadId: session.id,
                filename: session.originalFilename,
                size: session.size,
            };
        }
        if (session.received !== session.size) {
            throw new Error(
                `本地插件归档尚未上传完成（${formatUploadBytes(session.received)} / ${formatUploadBytes(session.size)}）。`,
            );
        }
        await this.closeHandle(session);

        try {
            const hash = session.hash.digest("hex");
            const manifest = await inspectPackageArchive(session.path);
            const targetFilename = createCanonicalLocalPackageFilename(
                manifest.name,
                manifest.version,
                hash,
            );
            session.validated = { manifest, hash, targetFilename };
            session.touchedAt = Date.now();
            return {
                ...session.validated,
                uploadId: session.id,
                filename: session.originalFilename,
                size: session.size,
            };
        } catch (error) {
            await this.removeSession(session);
            throw error;
        }
    }

    async commit(uploadId: string): Promise<LocalPackageUploadCommitResult> {
        const session = this.getSession(uploadId);
        if (!session.validated) throw new Error("请先完成本地插件归档校验。");
        await this.closeHandle(session);
        await fsp.mkdir(this.root, { recursive: true });
        await placeUploadArchive(
            this.root,
            session.path,
            session.validated.targetFilename,
            session.validated.hash,
        );
        this.sessions.delete(session.id);

        return {
            name: session.validated.manifest.name,
            version: session.validated.manifest.version,
            filename: session.validated.targetFilename,
            request: createLocalBindingRequest(session.validated.targetFilename),
            size: session.size,
            hash: session.validated.hash,
        };
    }

    async cancel(uploadId: string) {
        const session = this.sessions.get(uploadId);
        if (!session) return false;
        await this.removeSession(session);
        return true;
    }

    async pruneExpired(now = Date.now()) {
        const expired = [...this.sessions.values()].filter(
            (session) => now - session.touchedAt > LOCAL_UPLOAD_TTL,
        );
        await Promise.all(
            expired.map((session) =>
                this.removeSession(session).catch((error) => {
                    this.warn(
                        `failed to clean expired local upload ${session.id}: ${error instanceof Error ? error.message : error}`,
                    );
                }),
            ),
        );
        const activePaths = new Set([...this.sessions.values()].map((session) => session.path));
        await sweepTemporaryUploads(this.temporaryRoot, activePaths, now, LOCAL_UPLOAD_TTL);
    }

    async dispose() {
        await Promise.all(
            [...this.sessions.values()].map((session) =>
                this.removeSession(session).catch((error) => {
                    this.warn(
                        `failed to dispose local upload ${session.id}: ${error instanceof Error ? error.message : error}`,
                    );
                }),
            ),
        );
    }

    private getSession(uploadId: string) {
        if (typeof uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
            throw new Error("本地插件上传会话无效。");
        }
        const session = this.sessions.get(uploadId);
        if (!session) throw new Error("本地插件上传已过期，请重新选择文件。");
        return session;
    }

    private async closeHandle(session: LocalUploadSession) {
        const handle = session.handle;
        session.handle = undefined;
        await handle?.close();
    }

    private async removeSession(session: LocalUploadSession) {
        this.sessions.delete(session.id);
        await this.closeHandle(session).catch(() => {});
        await fsp.rm(session.path, { force: true });
    }
}

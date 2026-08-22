/**
 * @file 本地 .tgz 分块上传会话存储(core/upload 域)。
 *
 * 模块职责:LocalPackageUploadStore 维护"start → append* → finish → commit"
 * 的完整上传生命周期:分片顺序写入临时 .part 文件、流式计算 sha256、
 * finish 时解包校验(inspectPackageArchive)、commit 时原子落位到 .yarn/local。
 *
 * 关键设计:
 * - 严格顺序分片(index 必须等于 nextIndex)防止乱序/重复写入错位;
 * - 会话 TTL 15 分钟(start 时顺带清理过期会话与孤儿 .part 文件);
 * - finish 幂等:已校验的会话重复 finish 直接复用校验结果;
 * - 校验失败即销毁会话,避免残留可被继续 commit 的半成品状态。
 *
 * 架构位置:core 领域层,由 node/installer(wire.ts 组装)与
 * core/install/sources/upload 消费;文件系统直接经 node:fs 访问
 * (core 允许使用 node 内置模块,禁止 koishi 运行时)。
 */
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

/** 会话空闲超时:超过 15 分钟无活动即清理(分块上传中断后不能永久占盘)。 */
const LOCAL_UPLOAD_TTL = 15 * 60 * 1000;

/** finish/commit 校验通过后缓存的归档信息(重复 finish 幂等复用)。 */
interface ValidatedLocalPackage {
    /** 归档内解析出的 package.json */
    manifest: PackageJson;
    /** 全量内容的 sha256(hex) */
    hash: string;
    /** 规范化的目标文件名(含 hash 后缀) */
    targetFilename: string;
}

/** 单个进行中的上传会话(临时 .part 文件 + 写入进度 + 流式哈希)。 */
interface LocalUploadSession {
    id: string;
    /** client 声明的原始文件名(仅展示用,落盘用规范名) */
    originalFilename: string;
    /** 临时 .part 文件绝对路径 */
    path: string;
    /** 声明的总字节数 */
    size: number;
    /** 已写字节数(同时是下一块的写入偏移) */
    received: number;
    /** 下一个合法分块序号(强顺序约束) */
    nextIndex: number;
    /** 最后活动时间(TTL 判定) */
    touchedAt: number;
    /** 打开的文件句柄(finish 后关闭) */
    handle?: FileHandle | undefined;
    /** 流式 sha256(每块 update,finish 时 digest) */
    hash: ReturnType<typeof createHash>;
    /** finish 校验结果(未校验时 undefined) */
    validated?: ValidatedLocalPackage | undefined;
}

/** 本地 .tgz 分块上传会话：分片写入、解包校验、原子落位 .yarn/local。 */
export class LocalPackageUploadStore {
    /** 归档最终存放目录 <baseDir>/.yarn/local */
    private readonly root: string;
    /** 临时分片目录(root/.market-next-upload) */
    private readonly temporaryRoot: string;
    /** uploadId → 会话(内存态,重启即失效,.part 由 sweep 兜底清理) */
    private readonly sessions = new Map<string, LocalUploadSession>();
    /** 清理失败等非致命问题的告警通道 */
    private readonly warn: (message: string) => void;

    constructor(baseDir: string, warn: (message: string) => void) {
        this.root = resolve(baseDir, ".yarn", "local");
        this.temporaryRoot = resolve(this.root, ".market-next-upload");
        this.warn = warn;
    }

    /**
     * 开始一次上传:清理过期会话与孤儿文件后,校验文件名与大小,
     * 创建排他的 .part 文件("wx" 防意外覆盖)并返回分块约定。
     */
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
        // "wx" 排他创建:uploadId 是 UUID 理论上不冲突,此举是防御性兜底
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

    /**
     * 追加一个分块:校验会话状态、序号顺序与块大小(不得超约定上限、
     * 不得超剩余空间),按 received 偏移写入并流式更新哈希。
     * 已 finish(校验完成)的会话拒绝继续写入。
     */
    async append(request: LocalPackageUploadChunkRequest): Promise<LocalPackageUploadProgress> {
        const session = this.getSession(request?.uploadId);
        if (session.validated) throw new Error("本地插件归档已经完成校验。");
        // 严格顺序:序号必须等于 nextIndex,杜绝乱序/重放导致的字节错位
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

    /**
     * 完成上传并做解包校验:字节数收齐后关闭句柄,计算最终哈希、
     * 解析归档 manifest、生成规范文件名并缓存为 validated(幂等:
     * 重复调用直接复用结果)。校验失败立即销毁会话,client 需重新上传。
     */
    async finish(
        request: LocalPackageUploadFinishRequest,
    ): Promise<ValidatedLocalPackage & { uploadId: string; filename: string; size: number }> {
        const session = this.getSession(request?.uploadId);
        if (session.validated) {
            // 幂等分支:client 网络重试等场景下重复 finish 不应报错
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
            // 校验失败会话不可再用:清掉临时文件,避免残留"差一步就能落盘"的状态
            await this.removeSession(session);
            throw error;
        }
    }

    /**
     * 提交:把已校验的归档原子落位到 .yarn/local(同名同内容直接复用),
     * 销毁会话并返回可写入 package.json 的 file: 依赖串。
     */
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

    /** 主动取消:会话不存在返回 false,存在则删除会话与临时文件。 */
    async cancel(uploadId: string) {
        const session = this.sessions.get(uploadId);
        if (!session) return false;
        await this.removeSession(session);
        return true;
    }

    /**
     * 清理过期会话(超过 TTL 无活动)与不属于任何活跃会话的孤儿 .part 文件。
     * 每次 start 都会顺带执行;单个清理失败仅告警,不阻断后续。
     */
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

    /** 销毁全部会话(插件停用/进程退出时调用),单个失败仅告警。 */
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

    /** 取会话并做基本合法性校验(uploadId 须为 UUID 形态且会话仍存活)。 */
    private getSession(uploadId: string) {
        if (typeof uploadId !== "string" || !/^[0-9a-f-]{36}$/i.test(uploadId)) {
            throw new Error("本地插件上传会话无效。");
        }
        const session = this.sessions.get(uploadId);
        if (!session) throw new Error("本地插件上传已过期，请重新选择文件。");
        return session;
    }

    /** 关闭会话文件句柄(置空后关闭,重复调用安全)。 */
    private async closeHandle(session: LocalUploadSession) {
        const handle = session.handle;
        session.handle = undefined;
        await handle?.close();
    }

    /** 彻底移除会话:出表 → 关句柄(失败忽略)→ 删临时文件。 */
    private async removeSession(session: LocalUploadSession) {
        this.sessions.delete(session.id);
        await this.closeHandle(session).catch(() => {});
        await fsp.rm(session.path, { force: true });
    }
}

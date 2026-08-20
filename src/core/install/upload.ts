import { createHash } from "node:crypto";
import { promises as fsp, type Stats } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { PackageJson } from "@koishijs/registry";
import { execa } from "execa";
import type { Dict } from "koishi";
import type { DependencyResolver } from "../deps/resolver.js";
import type { Dependency } from "../deps/types.js";
import { resolvePackageManifest, Scanner } from "../registry/manifest.js";
import {
    createHashedLocalBindingFilename,
    createLocalBindingRequest,
    MAX_LOCAL_BINDING_PACK_SIZE,
    parseNpmPackOutput,
} from "../upload/local-binding.js";
import type { LocalPackageUploadStore } from "../upload/session.js";
import {
    getLocalPackageOperation,
    type LocalPackageUploadChunkRequest,
    type LocalPackageUploadCommitResult,
    type LocalPackageUploadFinishRequest,
    type LocalPackageUploadPreview,
    type LocalPackageUploadProgress,
    type LocalPackageUploadStartRequest,
    type LocalPackageUploadStartResult,
} from "../upload/types.js";
import { MINUTE } from "../utils/time.js";
import { snapshotPackageManifest } from "./manifest-restore.js";
import type { InstallLogger, LocalBindingResult } from "./types.js";

export interface LocalPackageUploadServiceDeps {
    cwd: string;
    log: InstallLogger;
    timeout?: number | undefined;
    uploads: LocalPackageUploadStore;
    resolver: DependencyResolver;
}

/** 本地 .tgz 上传会话 + 本地插件绑定（npm pack 落地 .yarn/local）。 */
export class LocalPackageUploadService {
    private readonly deps: LocalPackageUploadServiceDeps;

    constructor(deps: LocalPackageUploadServiceDeps) {
        this.deps = deps;
    }

    startLocalPackageUpload(
        request: LocalPackageUploadStartRequest,
    ): Promise<LocalPackageUploadStartResult> {
        return this.deps.uploads.start(request);
    }

    appendLocalPackageUpload(
        request: LocalPackageUploadChunkRequest,
    ): Promise<LocalPackageUploadProgress> {
        return this.deps.uploads.append(request);
    }

    commitLocalPackageUpload(uploadId: string): Promise<LocalPackageUploadCommitResult> {
        return this.deps.uploads.commit(uploadId);
    }

    cancelLocalPackageUpload(uploadId: string) {
        return this.deps.uploads.cancel(uploadId);
    }

    async finishLocalPackageUpload(
        request: LocalPackageUploadFinishRequest,
    ): Promise<LocalPackageUploadPreview> {
        const result = await this.deps.uploads.finish(request);
        const snapshot = await snapshotPackageManifest(this.deps.cwd);
        const currentRequest = snapshot.dependencies[result.manifest.name];
        const depCache = this.deps.resolver.getDeps({ background: false }) as Dict<Dependency>;
        const currentVersion = depCache[result.manifest.name]?.resolved;
        const scripts = Object.keys(result.manifest.scripts ?? {}).filter((name) =>
            ["preinstall", "install", "postinstall", "prepare"].includes(name),
        );
        return {
            uploadId: result.uploadId,
            filename: result.filename,
            name: result.manifest.name,
            version: result.manifest.version,
            description:
                typeof result.manifest.description === "string"
                    ? result.manifest.description
                    : undefined,
            size: result.size,
            hash: result.hash,
            scripts,
            currentRequest,
            currentVersion,
            operation: getLocalPackageOperation(
                currentRequest,
                currentVersion,
                result.manifest.version,
            ),
        };
    }

    async prepareLocalBinding(name: string): Promise<LocalBindingResult> {
        const packageSnapshot = await snapshotPackageManifest(this.deps.cwd);
        if (!Scanner.isPlugin(name) || !Object.hasOwn(packageSnapshot.dependencies, name)) {
            throw new Error("只能绑定当前 package.json 中的 Koishi 插件依赖。");
        }
        const depCache = this.deps.resolver.getDeps({ background: false }) as Dict<Dependency>;
        const dependency = depCache[name];
        if (!dependency?.resolved || dependency.source !== "unbound") {
            throw new Error("该插件不是来源未绑定的本地插件。");
        }
        const currentRequest = packageSnapshot.dependencies[name]!.replace(/^[~^]/, "");
        if (dependency.request !== currentRequest) {
            throw new Error("package.json 已发生变化，请刷新依赖后重试。");
        }

        let manifestFile: string;
        try {
            manifestFile = resolvePackageManifest(name, this.deps.cwd);
        } catch {
            throw new Error("无法定位本地插件目录；请确认插件仍可被当前 Koishi 实例加载。");
        }
        const sourceDir = dirname(manifestFile);
        const manifest = JSON.parse(await fsp.readFile(manifestFile, "utf8")) as PackageJson;
        if (manifest.name !== name || manifest.version !== dependency.resolved) {
            throw new Error("本地插件清单与当前依赖状态不一致，请刷新依赖后重试。");
        }

        const destination = resolve(this.deps.cwd, ".yarn", "local");
        await fsp.mkdir(destination, { recursive: true });
        const temporary = await fsp.mkdtemp(resolve(destination, ".market-next-pack-"));
        try {
            const { stdout } = await execa(
                "npm",
                ["pack", sourceDir, "--ignore-scripts", "--json", "--pack-destination", temporary],
                { cwd: this.deps.cwd, timeout: Math.max(MINUTE, this.deps.timeout ?? 0) },
            );
            const pack = parseNpmPackOutput(stdout);
            if (
                (pack.name && pack.name !== name) ||
                (pack.version && pack.version !== dependency.resolved)
            ) {
                throw new Error("本地插件打包结果与当前依赖不一致。");
            }
            const packedFile = resolve(temporary, pack.filename);
            if (
                dirname(packedFile) !== temporary ||
                relative(temporary, packedFile).startsWith("..")
            ) {
                throw new Error("本地插件打包路径无效。");
            }
            const stat = await fsp.stat(packedFile);
            if (
                !stat.isFile() ||
                stat.size <= 0 ||
                stat.size > MAX_LOCAL_BINDING_PACK_SIZE ||
                stat.size !== pack.size
            ) {
                throw new Error("本地插件打包文件无效或过大。");
            }
            const content = await fsp.readFile(packedFile);
            const hash = createHash("sha256").update(content).digest("hex");
            const filename = createHashedLocalBindingFilename(pack.filename, hash.slice(0, 12));
            const target = resolve(destination, filename);
            if (dirname(target) !== destination || relative(destination, target).startsWith("..")) {
                throw new Error("本地插件目标路径无效。");
            }

            const validateExistingTarget = async () => {
                let targetStat: Stats;
                try {
                    targetStat = await fsp.stat(target);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
                    throw error;
                }
                if (!targetStat.isFile() || targetStat.size !== stat.size) {
                    throw new Error("同名本地插件归档已存在，但文件状态不一致。");
                }
                const targetHash = createHash("sha256")
                    .update(await fsp.readFile(target))
                    .digest("hex");
                if (targetHash !== hash) {
                    throw new Error("同名本地插件归档已存在，但文件内容不一致。");
                }
                return true;
            };

            if (!(await validateExistingTarget())) {
                try {
                    await fsp.rename(packedFile, target);
                } catch (error) {
                    if (!(await validateExistingTarget())) throw error;
                }
            }
            this.deps.log.info(
                `local plugin source prepared: ${name}@${dependency.resolved}, file=${filename}, size=${pack.size}`,
            );
            return {
                request: createLocalBindingRequest(filename),
                filename,
                size: pack.size,
            };
        } finally {
            await fsp.rm(temporary, { recursive: true, force: true }).catch((error) => {
                this.deps.log.debug(
                    `failed to remove local binding temp directory ${temporary}: ${error instanceof Error ? error.message : error}`,
                );
            });
        }
    }
}

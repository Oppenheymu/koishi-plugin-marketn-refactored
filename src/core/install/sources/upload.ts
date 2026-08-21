import type { Dict } from "koishi";
import type { DependencyResolver } from "../../deps/resolver.js";
import type { Dependency } from "../../deps/types.js";
import { prepareLocalBinding } from "../../upload/local-binding.js";
import type { LocalPackageUploadStore } from "../../upload/session.js";
import {
    getLocalPackageOperation,
    type LocalPackageUploadChunkRequest,
    type LocalPackageUploadCommitResult,
    type LocalPackageUploadFinishRequest,
    type LocalPackageUploadPreview,
    type LocalPackageUploadProgress,
    type LocalPackageUploadStartRequest,
    type LocalPackageUploadStartResult,
} from "../../upload/types.js";
import type { InstallLogger, LocalBindingResult } from "../types.js";
import { snapshotPackageManifest } from "./manifest-restore.js";

export interface LocalPackageUploadServiceDeps {
    cwd: string;
    log: InstallLogger;
    timeout?: number | undefined;
    uploads: LocalPackageUploadStore;
    resolver: DependencyResolver;
}

/** 本地 .tgz 上传会话门面 + 本地插件绑定入口（绑定实现在 upload/local-binding.js）。 */
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

    prepareLocalBinding(name: string): Promise<LocalBindingResult> {
        return prepareLocalBinding(this.deps, name);
    }
}

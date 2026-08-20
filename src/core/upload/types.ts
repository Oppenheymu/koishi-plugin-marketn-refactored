import { compare, valid } from "semver";

export type LocalPackageOperation = "install" | "upgrade" | "downgrade" | "replace";

export interface LocalPackageUploadStartRequest {
    filename: string;
    size: number;
}

export interface LocalPackageUploadStartResult {
    uploadId: string;
    chunkSize: number;
    maxSize: number;
}

export interface LocalPackageUploadChunkRequest {
    uploadId: string;
    index: number;
    data: string;
}

export interface LocalPackageUploadProgress {
    received: number;
    size: number;
}

export interface LocalPackageUploadFinishRequest {
    uploadId: string;
}

export interface LocalPackageUploadPreview {
    uploadId: string;
    filename: string;
    name: string;
    version: string;
    description?: string | undefined;
    size: number;
    hash: string;
    scripts: string[];
    currentRequest?: string | undefined;
    currentVersion?: string | undefined;
    operation: LocalPackageOperation;
}

export interface LocalPackageUploadCommitResult {
    name: string;
    version: string;
    filename: string;
    request: string;
    size: number;
    hash: string;
}

/** 依据当前已装版本与目标版本判断本地归档的操作语义。 */
export function getLocalPackageOperation(
    currentRequest: string | undefined,
    currentVersion: string | undefined,
    targetVersion: string,
): LocalPackageOperation {
    if (!currentRequest) return "install";
    if (!currentVersion || !valid(currentVersion) || !valid(targetVersion)) return "replace";
    const result = compare(targetVersion, currentVersion);
    if (result > 0) return "upgrade";
    if (result < 0) return "downgrade";
    return "replace";
}

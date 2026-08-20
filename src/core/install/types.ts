export interface InstallLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: unknown): void;
    error(message: unknown): void;
}

export interface InstallOptions {
    installEndpoint?: string | undefined;
}

export interface InstallFallbackCandidate {
    endpoint: string;
    label: string;
    reason: string;
}

export type InstallHistoryStatus = "running" | "success" | "error" | "unknown";

export interface InstallHistoryChange {
    name: string;
    beforeRequest: string | null;
    beforeResolved: string | null;
    afterRequest: string | null;
    afterResolved: string | null;
}

export interface InstallHistoryEntry {
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    duration?: number | undefined;
    status: InstallHistoryStatus;
    deps: string;
    forced: boolean;
    installEndpoint?: string | undefined;
    size: number;
    changes: InstallHistoryChange[];
}

export interface LocalBindingResult {
    request: string;
    filename: string;
    size: number;
}

export interface InstallLogDetail extends InstallHistoryEntry {
    content: string;
    truncated: boolean;
}

/** 安装日志的持久化元数据（.log.json）。 */
export interface InstallHistoryMetadata {
    version: 1;
    id: string;
    startedAt: number;
    finishedAt?: number | undefined;
    status: InstallHistoryStatus;
    deps: string;
    forced: boolean;
    installEndpoint?: string | undefined;
    changes: InstallHistoryChange[];
}

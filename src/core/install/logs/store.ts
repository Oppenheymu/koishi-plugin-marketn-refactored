import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import type { Dict } from "koishi";
import { formatDeps } from "../planner.js";
import type {
    InstallHistoryChange,
    InstallHistoryMetadata,
    InstallLogger,
    InstallOptions,
} from "../types.js";
import { getInstallLogDir, type InstallLogRetention } from "./retention.js";

export function sanitizeInstallLogText(value: string) {
    return value
        .replace(
            /* biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI OSC 序列清洗 */ /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g,
            "",
        )
        .replace(
            /* biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI CSI 序列清洗 */ /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
            "",
        )
        .replace(/\r(?!\n)/g, "");
}
function formatLogTimestamp(value: number) {
    return new Date(value).toISOString().replace(/[:.]/g, "-");
}

function sanitizeLogSegment(value: string) {
    return (
        value
            .replace(/[^a-z0-9@._+-]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "operation"
    );
}

export interface InstallLogStoreDeps {
    cwd: string;
    log: InstallLogger;
    retention: InstallLogRetention;
    broadcast: (type: "stdout" | "stderr", line: string) => void;
    /** 成功后回填 afterResolved（依赖缓存的最新值） */
    resolveAfter: (name: string) => string | undefined;
}

/** 单次安装会话的日志写盘 + 广播 + 元数据维护。 */
export class InstallLogStore {
    private file: string | undefined;
    private metadataFile: string | undefined;
    private metadata: InstallHistoryMetadata | undefined;
    private writeTask = Promise.resolve();
    private readonly deps: InstallLogStoreDeps;

    constructor(deps: InstallLogStoreDeps) {
        this.deps = deps;
    }

    get activeFile() {
        return this.file;
    }

    get activeMetadataFile() {
        return this.metadataFile;
    }

    get activeMetadata() {
        return this.metadata;
    }

    async waitForWrite() {
        await this.writeTask;
    }

    async start(
        deps: Dict<string>,
        forced?: boolean,
        options: InstallOptions = {},
        changes: InstallHistoryChange[] = [],
    ) {
        await this.deps.retention.cleanup();
        const dir = getInstallLogDir(this.deps.cwd);
        await fsp.mkdir(dir, { recursive: true });
        const now = Date.now();
        const suffix = sanitizeLogSegment(formatDeps(deps) || "noop");
        const file = resolve(dir, `${formatLogTimestamp(now)}-${suffix}.log`);
        const id = basename(file);
        await fsp.writeFile(
            file,
            [
                "market-next dependency operation log",
                `startedAt: ${new Date(now).toISOString()}`,
                `cwd: ${this.deps.cwd}`,
                `deps: ${formatDeps(deps) || "(none)"}`,
                `forced: ${!!forced}`,
                `installEndpoint: ${options.installEndpoint || "(default)"}`,
                "",
            ].join("\n"),
        );
        this.file = file;
        this.metadataFile = `${file}.json`;
        this.metadata = {
            version: 1,
            id,
            startedAt: now,
            status: "running",
            deps: formatDeps(deps) || "(none)",
            forced: !!forced,
            installEndpoint: options.installEndpoint || undefined,
            changes,
        };
        this.writeTask = Promise.resolve();
        await this.writeMetadata().catch((error) => {
            this.deps.log.debug(
                `failed to write install log metadata ${this.metadataFile}: ${error instanceof Error ? error.message : error}`,
            );
        });
        this.deps.log.info(`dependency install log started: ${file}`);
    }

    emit(type: "stdout" | "stderr", line: string) {
        const cleanLine = sanitizeInstallLogText(line);
        this.deps.broadcast(type, cleanLine);
        this.write(type, cleanLine);
    }

    write(type: string, line: string) {
        const file = this.file;
        if (!file) return;
        const text = `[${new Date().toISOString()}] [${type}] ${line}\n`;
        this.writeTask = this.writeTask
            .then(() => fsp.appendFile(file, text))
            .catch((error) => {
                this.deps.log.debug(
                    `failed to write install log ${file}: ${error instanceof Error ? error.message : error}`,
                );
            });
    }

    async finish(result?: { code?: number | null; failed?: boolean; reason?: string }) {
        if (!this.file) return;
        if (result?.failed) {
            // 失败详情已由 catch 路径 emit，这里仅收尾。
        } else if (result?.code == null) {
            this.write("stderr", "dependency operation ended without a package manager exit code");
        } else if (result.code) {
            this.write("stderr", `dependency operation finished with code ${result.code}`);
        } else {
            this.write("stdout", "dependency operation finished with code 0");
        }
        await this.writeTask;
        if (this.metadata) {
            const success = !result?.failed && result?.code === 0;
            this.metadata.status = success ? "success" : "error";
            this.metadata.finishedAt = Date.now();
            if (success) {
                this.metadata.changes = this.metadata.changes.map((change) => ({
                    ...change,
                    afterResolved: this.deps.resolveAfter(change.name) ?? null,
                }));
            }
            await this.writeMetadata().catch((error) => {
                this.deps.log.debug(
                    `failed to finish install log metadata ${this.metadataFile}: ${error instanceof Error ? error.message : error}`,
                );
            });
        }
        this.deps.log.info(`dependency install log saved: ${this.file}`);
        this.file = undefined;
        this.metadataFile = undefined;
        this.metadata = undefined;
        this.writeTask = Promise.resolve();
    }

    private async writeMetadata() {
        if (!this.metadataFile || !this.metadata) return;
        await fsp.writeFile(this.metadataFile, `${JSON.stringify(this.metadata, null, 2)}\n`);
    }
}

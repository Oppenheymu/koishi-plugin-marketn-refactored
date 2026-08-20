import { promises as fsp } from "node:fs";
import { basename, resolve } from "node:path";
import { DAY, HOUR } from "../../utils/time.js";
import type { InstallLogger } from "../types.js";

export const INSTALL_LOG_DIR = "market-next-install-logs";
export const INSTALL_LOG_DETAIL_LIMIT = 512 * 1024;
export const INSTALL_LOG_HEAD_LIMIT = 8 * 1024;
export const INSTALL_LOG_TAIL_LIMIT = 32 * 1024;
const DEFAULT_INSTALL_LOG_RETENTION = 3 * DAY;

export function getInstallLogDir(cwd: string) {
    return resolve(cwd, "data", INSTALL_LOG_DIR);
}

export function getInstallLogPath(cwd: string, id: string) {
    if (!id || basename(id) !== id || !id.endsWith(".log")) return undefined;
    return resolve(getInstallLogDir(cwd), id);
}

/** 安装日志保留时长：新字段优先，回退 deprecated 字段，最终默认 3 天。 */
export function getInstallLogRetention(config: {
    installLogRetentionHours?: number | undefined;
    installLogRetention?: number | undefined;
}) {
    const hours = Number(config.installLogRetentionHours);
    if (Number.isFinite(hours) && hours > 0) return Math.max(1, hours) * HOUR;
    const legacyRetention = Number(config.installLogRetention);
    return Number.isFinite(legacyRetention) && legacyRetention > 0
        ? Math.max(HOUR, legacyRetention)
        : DEFAULT_INSTALL_LOG_RETENTION;
}

/** 安装日志清理：删除超过保留时长的 .log/.log.json（跳过活跃会话）。 */
export class InstallLogRetention {
    private task: Promise<void> | undefined;
    private readonly cwd: string;
    private readonly getRetention: () => number;
    private readonly log: InstallLogger;

    constructor(cwd: string, getRetention: () => number, log: InstallLogger) {
        this.cwd = cwd;
        this.getRetention = getRetention;
        this.log = log;
    }

    cleanup(activeFile?: string, activeMetadataFile?: string): Promise<void> {
        if (this.task) return this.task;
        this.task = this.runCleanup(activeFile, activeMetadataFile).finally(() => {
            this.task = undefined;
        });
        return this.task;
    }

    private async runCleanup(activeFile?: string, activeMetadataFile?: string) {
        const dir = getInstallLogDir(this.cwd);
        try {
            const entries = await fsp.readdir(dir, { withFileTypes: true });
            const now = Date.now();
            await Promise.all(
                entries
                    .filter(
                        (entry) =>
                            entry.isFile() &&
                            (entry.name.endsWith(".log") || entry.name.endsWith(".log.json")),
                    )
                    .map(async (entry) => {
                        const path = resolve(dir, entry.name);
                        if (path === activeFile || path === activeMetadataFile) return;
                        try {
                            const stat = await fsp.stat(path);
                            if (now - stat.mtimeMs <= this.getRetention()) return;
                            await fsp.rm(path, { force: true });
                        } catch (error) {
                            this.log.debug(
                                `failed to cleanup install log ${path}: ${error instanceof Error ? error.message : error}`,
                            );
                        }
                    }),
            );
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.log.debug(
                    `failed to cleanup install logs: ${error instanceof Error ? error.message : error}`,
                );
            }
        }
    }
}

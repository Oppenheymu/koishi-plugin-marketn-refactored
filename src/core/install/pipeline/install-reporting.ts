import type { Dict } from "koishi";
import type { Dependency } from "../../deps/types.js";
import type { EnvironmentSnapshotSource } from "../../environment/snapshot.js";
import type { InstallLogStore } from "../logs/store.js";
import type { PackageManifestSnapshot } from "../sources/manifest-restore.js";
import type { InstallLogger, InstallOptions } from "../types.js";
import { type createInstallHistoryChanges, formatDeps, formatLocalDeps } from "./planner.js";

/** 日志/快照上报所需的执行器依赖面（InstallExecutorDeps 的结构性子集）。 */
export interface InstallReportingDeps {
    log: InstallLogger;
    logs: InstallLogStore;
    recordEnvironmentSnapshot: (
        source: EnvironmentSnapshotSource,
        operationId?: string,
    ) => Promise<unknown>;
}

/** 记录环境快照并吞掉失败（安装前后两处共用；失败只记日志不中断流程）。 */
export async function recordSnapshotSafely(
    deps: InstallReportingDeps,
    kind: "external" | "operation",
    operationId?: string,
) {
    await deps.recordEnvironmentSnapshot(kind, operationId).catch((error) => {
        deps.log.warn(
            `failed to record ${kind === "operation" ? "dependency" : "pre-operation"} environment snapshot: ${error instanceof Error ? error.message : error}`,
        );
    });
}

/** 开始安装日志并校验快照有效。 */
export async function beginInstallLog(
    deps: InstallReportingDeps,
    deps2: Dict<string>,
    forced: boolean | undefined,
    options: InstallOptions,
    changes: ReturnType<typeof createInstallHistoryChanges>,
    localDeps: Dict<Dependency>,
    snapshot: PackageManifestSnapshot | undefined,
    snapshotError: unknown,
): Promise<PackageManifestSnapshot> {
    await deps.logs.start(deps2, forced, options, changes).catch((error) => {
        deps.log.warn(
            `failed to start dependency install log: ${error instanceof Error ? error.message : error}`,
        );
    });
    deps.log.info(
        `dependency install requested: deps=${formatDeps(deps2)}, forced=${!!forced}, installEndpoint=${options.installEndpoint || "(default)"}`,
    );
    deps.logs.emit("stdout", `dependency install requested: ${formatDeps(deps2) || "(none)"}`);
    if (options.installEndpoint) {
        deps.logs.emit("stdout", `using temporary npm registry: ${options.installEndpoint}`);
    }
    if (snapshotError) throw snapshotError;
    if (!snapshot) throw new Error("failed to snapshot package.json before dependency operation");
    deps.log.debug(`dependency install local state: ${formatLocalDeps(localDeps)}`);
    return snapshot;
}

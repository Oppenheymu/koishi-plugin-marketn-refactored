import type { Dict } from "koishi";
import { classifyDependencySource } from "../../../shared/dependency-source.js";
import type { Dependency } from "../../deps/types.js";
import { SECOND } from "../../utils/time.js";
import { type InstallReportingDeps, recordSnapshotSafely } from "./install-reporting.js";
import { formatDeps } from "./planner.js";

const FULL_RELOAD_DELAY = SECOND;

/** reload 判定与安装收尾所需的执行器依赖面（InstallExecutorDeps 的结构性子集）。 */
export interface InstallFinalizerDeps extends InstallReportingDeps {
    /** require.resolve(name) in require.cache 的等价判定（含解析失败 → true） */
    isPackageLoaded: (name: string) => boolean;
    isActive: () => boolean;
    fullReload: () => void;
}

/** 本地依赖安装后是否需要整帧重载（旧 _installLocked 的 reload 判定循环）。 */
export function detectFullReload(
    deps: InstallFinalizerDeps,
    localDeps: Dict<Dependency>,
    newDeps: Dict<Dependency>,
    previousRequests: Dict<string>,
    requests: Dict<string>,
) {
    let shouldReload = false;
    for (const name in localDeps) {
        const resolved = localDeps[name]?.resolved;
        if (!newDeps[name]) continue;
        const requestChanged = previousRequests[name] !== requests[name];
        const localRequestChanged =
            requestChanged &&
            classifyDependencySource(requests[name] ?? "", {
                workspace: newDeps[name]?.workspace,
                installed: !!newDeps[name]?.resolved,
            }).local;
        if (newDeps[name]?.resolved === resolved && !localRequestChanged) continue;
        if (deps.isPackageLoaded(name)) shouldReload = true;
        deps.log.debug(
            `dependency changed may require full reload: ${name}, previous=${resolved ?? "-"}, current=${newDeps[name]?.resolved ?? "-"}`,
        );
    }
    return shouldReload;
}

/** 安装成功后的收尾：环境快照、完成日志与按需整帧重载。 */
export async function finalizeInstall(
    deps: InstallFinalizerDeps,
    requests: Dict<string>,
    needsPackageManager: boolean,
    shouldReload: boolean,
    start: number,
) {
    await recordSnapshotSafely(deps, "operation", deps.logs.activeMetadata?.id);
    deps.log.info(
        `dependency install completed: deps=${formatDeps(requests)}, forced=${!!needsPackageManager}, fullReload=${shouldReload}, elapsed=${Date.now() - start}ms`,
    );
    if (shouldReload) {
        deps.logs.emit("stdout", `full reload scheduled in ${FULL_RELOAD_DELAY}ms`);
        deps.log.info(`dependency install triggers full reload after ${FULL_RELOAD_DELAY}ms`);
        setTimeout(() => {
            if (deps.isActive()) deps.fullReload();
        }, FULL_RELOAD_DELAY);
    }
}

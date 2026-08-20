import type { Dict } from "koishi";
import { valid } from "semver";
import type { Dependency } from "../deps/types.js";
import { getEnvironmentDiff, getEnvironmentInstallChanges } from "./diff.js";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "./snapshot.js";

/** 从 manifest 请求 + 本地解析结果构建环境依赖快照（captureCurrentEnvironmentSnapshot 主体）。 */
export function buildEnvironmentDependencies(
    manifestDeps: Dict<string>,
    localDeps: Dict<Dependency>,
) {
    const dependencies: Dict<EnvironmentDependencySnapshot> = {};
    for (const [name, request] of Object.entries(manifestDeps)) {
        const normalizedRequest = request.replace(/^[~^]/, "");
        dependencies[name] = {
            request,
            resolved: localDeps[name]?.resolved,
            workspace: localDeps[name]?.workspace,
            source: localDeps[name]?.source,
            local: localDeps[name]?.local,
            bound: localDeps[name]?.bound,
            invalid: !localDeps[name]?.local && !valid(normalizedRequest),
        };
    }
    return dependencies;
}

/** 应用环境快照前的纯规划：diff + 不可恢复项 + 安装请求变化。 */
export function planEnvironmentApply(current: EnvironmentSnapshot, target: EnvironmentSnapshot) {
    const diff = getEnvironmentDiff(current, target);
    const unsupported = diff.filter((change) => change.status === "unsupported");
    const changes = getEnvironmentInstallChanges(diff, target);
    return { diff, unsupported, changes };
}

import type { Dict } from "koishi";
import { satisfies } from "semver";
import { classifyDependencySource } from "../../../shared/dependency-source.js";
import type { Dependency } from "../../deps/types.js";
import type { InstallHistoryChange } from "../types.js";

export function formatDeps(deps: Dict<string>) {
    const entries = Object.entries(deps);
    if (!entries.length) return "(none)";
    return entries.map(([name, version]) => `${name}@${version || "(remove)"}`).join(", ");
}

export function formatLocalDeps(deps: Dict<Dependency>) {
    const entries = Object.entries(deps);
    if (!entries.length) return "(none)";
    return entries
        .map(
            ([name, dep]) =>
                `${name}{request=${dep.request || "-"},resolved=${dep.resolved ?? "-"},source=${dep.source ?? "-"},local=${!!dep.local}}`,
        )
        .join(", ");
}

export function createInstallHistoryChanges(
    before: Dict<string>,
    after: Dict<string>,
    localDeps: Dict<Dependency>,
): InstallHistoryChange[] {
    return Object.keys(after).map((name) => ({
        name,
        beforeRequest: Object.hasOwn(before, name) ? before[name]! : null,
        beforeResolved: localDeps[name]?.resolved ?? null,
        afterRequest: after[name] || null,
        afterResolved: null,
    }));
}

/** 判断是否需要真的跑包管理器（无变化/已满足的请求可跳过）。 */
export function requiresPackageManager(
    deps: Dict<string>,
    localDeps: Dict<Dependency>,
    manifestDeps: Dict<string>,
    depCache: Dict<Dependency>,
    forced?: boolean,
) {
    if (forced) return true;
    for (const name in deps) {
        const nextRequest = deps[name];
        const currentRequest = manifestDeps[name];
        const currentSource = classifyDependencySource(currentRequest ?? "", {
            workspace: depCache[name]?.workspace,
            installed: !!depCache[name]?.resolved,
        });
        const nextSource = classifyDependencySource(nextRequest ?? "", {
            workspace: localDeps[name]?.workspace,
            installed: !!localDeps[name]?.resolved,
        });
        if (!nextRequest) return true;
        if (currentRequest !== nextRequest && (currentSource.local || nextSource.local))
            return true;
        const { resolved, local } = localDeps[name] || {};
        if (local || (resolved && satisfies(resolved, nextRequest, { includePrerelease: true })))
            continue;
        return true;
    }
    return false;
}

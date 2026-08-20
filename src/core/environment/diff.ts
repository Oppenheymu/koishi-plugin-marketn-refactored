import type { Dict } from "koishi";
import { compare, valid } from "semver";
import type { EnvironmentDependencySnapshot, EnvironmentSnapshot } from "./snapshot.js";

export type EnvironmentChangeStatus =
    | "upgrade"
    | "downgrade"
    | "added"
    | "removed"
    | "changed"
    | "unchanged"
    | "unsupported";

export interface EnvironmentSnapshotChange {
    name: string;
    currentRequest?: string | undefined;
    currentVersion?: string | undefined;
    targetRequest?: string | undefined;
    targetVersion?: string | undefined;
    status: EnvironmentChangeStatus;
    reason?: "local" | undefined;
}

export interface EnvironmentSnapshotPreview {
    snapshot: import("./snapshot.js").EnvironmentSnapshotSummary;
    changes: EnvironmentSnapshotChange[];
    actionableCount: number;
    unsupportedCount: number;
}

function sameDependency(
    left?: EnvironmentDependencySnapshot,
    right?: EnvironmentDependencySnapshot,
) {
    if (!left || !right) return false;
    if (left.local || right.local) {
        return (
            left.request === right.request &&
            left.source === right.source &&
            !!left.local === !!right.local
        );
    }
    return (left.resolved || left.request) === (right.resolved || right.request);
}

function displayVersion(dependency?: EnvironmentDependencySnapshot) {
    return dependency?.resolved || dependency?.request;
}

/** 当前环境与目标快照的逐依赖差异（按名排序）。 */
export function getEnvironmentDiff(current: EnvironmentSnapshot, target: EnvironmentSnapshot) {
    const names = new Set([
        ...Object.keys(current.dependencies),
        ...Object.keys(target.dependencies),
    ]);
    return [...names]
        .sort((a, b) => a.localeCompare(b))
        .map((name): EnvironmentSnapshotChange => {
            const currentDependency = current.dependencies[name];
            const targetDependency = target.dependencies[name];
            const base = {
                name,
                currentRequest: currentDependency?.request,
                currentVersion: displayVersion(currentDependency),
                targetRequest: targetDependency?.request,
                targetVersion: displayVersion(targetDependency),
            };

            if (sameDependency(currentDependency, targetDependency)) {
                return { ...base, status: "unchanged" };
            }

            if (currentDependency?.local || targetDependency?.local) {
                return { ...base, status: "unsupported", reason: "local" };
            }

            if (!currentDependency) return { ...base, status: "added" };
            if (!targetDependency) return { ...base, status: "removed" };

            const currentVersion = currentDependency.resolved;
            const targetVersion = targetDependency.resolved;
            if (currentVersion && targetVersion && valid(currentVersion) && valid(targetVersion)) {
                const direction = compare(targetVersion, currentVersion);
                if (direction > 0) return { ...base, status: "upgrade" };
                if (direction < 0) return { ...base, status: "downgrade" };
            }
            return { ...base, status: "changed" };
        });
}

/** 由 diff 推导出要交给包管理器执行的请求变化。 */
export function getEnvironmentInstallChanges(
    diff: EnvironmentSnapshotChange[],
    target: EnvironmentSnapshot,
) {
    const changes: Dict<string> = {};
    for (const change of diff) {
        if (change.status === "unchanged") continue;
        if (change.status === "unsupported") continue;
        const dependency = target.dependencies[change.name];
        changes[change.name] = dependency ? dependency.resolved || dependency.request : "";
    }
    return changes;
}

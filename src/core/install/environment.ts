import { planEnvironmentApply } from "../environment/apply.js";
import { getEnvironmentDiff } from "../environment/diff.js";
import {
    type EnvironmentSnapshotStore,
    type EnvironmentSnapshotSummary,
    summarizeEnvironmentSnapshot,
} from "../environment/snapshot.js";
import type { InstallOrchestrator } from "./orchestrator.js";
import { formatDeps } from "./planner.js";
import type { InstallQueue } from "./queue.js";
import type { InstallLogger, InstallOptions } from "./types.js";

export interface EnvironmentSnapshotOpsDeps {
    log: InstallLogger;
    environments: EnvironmentSnapshotStore;
    queue: InstallQueue;
    orchestrator: InstallOrchestrator;
}

/** 环境快照的读取/预览/恢复（复用 orchestrator 的 capture 与 installLocked）。 */
export class EnvironmentSnapshotOps {
    private readonly deps: EnvironmentSnapshotOpsDeps;

    constructor(deps: EnvironmentSnapshotOpsDeps) {
        this.deps = deps;
    }

    async getEnvironmentSnapshots(): Promise<EnvironmentSnapshotSummary[]> {
        const orchestrator = this.deps.orchestrator;
        const current = orchestrator.isInstalling
            ? await orchestrator.captureCurrentEnvironmentSnapshot("external")
            : await orchestrator.recordCurrentEnvironmentSnapshot("external");
        const snapshots = await this.deps.environments.list();
        return snapshots.map((snapshot) => summarizeEnvironmentSnapshot(snapshot, current.id));
    }

    async getEnvironmentSnapshotPreview(id: string) {
        const orchestrator = this.deps.orchestrator;
        const target = await this.deps.environments.get(id);
        if (!target) return undefined;
        const current = orchestrator.isInstalling
            ? await orchestrator.captureCurrentEnvironmentSnapshot("external")
            : await orchestrator.recordCurrentEnvironmentSnapshot("external");
        const changes = getEnvironmentDiff(current, target);
        return {
            snapshot: summarizeEnvironmentSnapshot(target, current.id),
            changes,
            actionableCount: changes.filter(
                (change) => !["unchanged", "unsupported"].includes(change.status),
            ).length,
            unsupportedCount: changes.filter((change) => change.status === "unsupported").length,
        };
    }

    async applyEnvironmentSnapshot(id: string, options: InstallOptions = {}) {
        options ||= {};
        return this.deps.queue.withLock(`environmentSnapshot=${id}`, async () => {
            const target = await this.deps.environments.get(id);
            if (!target) throw new Error("目标环境版本不存在或已被清理。");
            const current =
                await this.deps.orchestrator.captureCurrentEnvironmentSnapshot("external");
            const { unsupported, changes } = planEnvironmentApply(current, target);
            if (unsupported.length) {
                throw new Error(
                    `目标环境包含无法自动恢复的本地依赖：${unsupported.map((change) => change.name).join(", ")}`,
                );
            }
            if (!Object.keys(changes).length) {
                await this.deps.environments.record(current);
                return 0;
            }
            this.deps.log.info(
                `environment snapshot restore requested: target=${id}, changes=${formatDeps(changes)}`,
            );
            return this.deps.orchestrator.installLocked(changes, true, undefined, options);
        });
    }
}

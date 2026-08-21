import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import type { Dict } from "koishi";
import { classifyDependencySource, type DependencySource } from "../../shared/dependency-source.js";
import { writeJsonAtomic } from "../utils/atomic-write.js";

export interface EnvironmentDependencySnapshot {
    request: string;
    resolved?: string | undefined;
    workspace?: boolean | undefined;
    source?: DependencySource | undefined;
    local?: boolean | undefined;
    bound?: boolean | undefined;
    invalid?: boolean | undefined;
}

export type EnvironmentSnapshotSource = "startup" | "operation" | "external";

export interface EnvironmentSnapshot {
    id: string;
    createdAt: number;
    lastSeenAt?: number | undefined;
    source: EnvironmentSnapshotSource;
    operationId?: string | undefined;
    dependencies: Dict<EnvironmentDependencySnapshot>;
}

export interface EnvironmentSnapshotSummary {
    id: string;
    createdAt: number;
    lastSeenAt?: number | undefined;
    source: EnvironmentSnapshotSource;
    operationId?: string | undefined;
    dependencyCount: number;
    current: boolean;
}

interface PersistedEnvironmentSnapshotStore {
    version: 1;
    snapshots: EnvironmentSnapshot[];
}

const MAX_SNAPSHOTS = 60;

/** 依赖快照归一化：键排序、source 补全、可选字段去空。 */
function normalizeEnvironmentDependencies(dependencies: Dict<EnvironmentDependencySnapshot>) {
    const result: Dict<EnvironmentDependencySnapshot> = {};
    for (const name of Object.keys(dependencies).sort((a, b) => a.localeCompare(b))) {
        const dependency = dependencies[name];
        if (!dependency || typeof dependency.request !== "string") continue;
        const source = classifyDependencySource(dependency.request, {
            workspace: dependency.workspace,
        });
        result[name] = {
            request: dependency.request,
            resolved: dependency.resolved || undefined,
            workspace: dependency.workspace || undefined,
            source: dependency.source || source.source,
            local: (dependency.local ?? source.local) || undefined,
            bound: dependency.bound,
            invalid: dependency.invalid || undefined,
        };
    }
    return result;
}

function canonicalDependencies(dependencies: Dict<EnvironmentDependencySnapshot>) {
    const normalized = normalizeEnvironmentDependencies(dependencies);
    return JSON.stringify(
        Object.entries(normalized).map(([name, dependency]) => [
            name,
            dependency.local ? dependency.request : dependency.resolved || dependency.request,
            dependency.source || "",
            !!dependency.local,
        ]),
    );
}

function getEnvironmentSnapshotId(dependencies: Dict<EnvironmentDependencySnapshot>) {
    return `env-${createHash("sha256")
        .update(canonicalDependencies(dependencies))
        .digest("hex")
        .slice(0, 20)}`;
}

export function createEnvironmentSnapshot(
    dependencies: Dict<EnvironmentDependencySnapshot>,
    source: EnvironmentSnapshotSource,
    operationId?: string,
    now = Date.now(),
): EnvironmentSnapshot {
    const normalized = normalizeEnvironmentDependencies(dependencies);
    return {
        id: getEnvironmentSnapshotId(normalized),
        createdAt: now,
        lastSeenAt: now,
        source,
        operationId,
        dependencies: normalized,
    };
}

export function summarizeEnvironmentSnapshot(
    snapshot: EnvironmentSnapshot,
    currentId?: string,
): EnvironmentSnapshotSummary {
    return {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        lastSeenAt: snapshot.lastSeenAt,
        source: snapshot.source,
        operationId: snapshot.operationId,
        dependencyCount: Object.keys(snapshot.dependencies).length,
        current: snapshot.id === currentId,
    };
}

/** 环境快照的防抖落盘存储（上限 MAX_SNAPSHOTS）。 */
export class EnvironmentSnapshotStore {
    private readonly filename: string;
    private readonly onError: (message: string) => void;
    private loaded?: Promise<void>;
    private writeTask = Promise.resolve();
    private value: PersistedEnvironmentSnapshotStore = { version: 1, snapshots: [] };

    constructor(filename: string, onError: (message: string) => void) {
        this.filename = filename;
        this.onError = onError;
    }

    private async load() {
        if (!this.loaded) {
            this.loaded = (async () => {
                try {
                    const parsed = JSON.parse(
                        await fsp.readFile(this.filename, "utf8"),
                    ) as PersistedEnvironmentSnapshotStore;
                    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots))
                        throw new Error("invalid snapshot store");
                    this.value = {
                        version: 1,
                        snapshots: parsed.snapshots.filter(
                            (snapshot) => snapshot?.id && snapshot?.dependencies,
                        ),
                    };
                } catch (error) {
                    if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                        this.onError(
                            `failed to read environment snapshots: ${error instanceof Error ? error.message : error}`,
                        );
                    }
                    this.value = { version: 1, snapshots: [] };
                }
            })();
        }
        await this.loaded;
    }

    private async waitForWrites() {
        await this.load();
        await this.writeTask;
    }

    private async persist() {
        await writeJsonAtomic(this.filename, this.value, { indent: 2 });
    }

    async record(snapshot: EnvironmentSnapshot) {
        await this.load();
        let result!: EnvironmentSnapshot;
        const task = this.writeTask.then(async () => {
            const existing = this.value.snapshots.find((item) => item.id === snapshot.id);
            if (existing) {
                existing.lastSeenAt = snapshot.lastSeenAt || Date.now();
                if (snapshot.source === "operation") {
                    existing.source = snapshot.source;
                    existing.operationId = snapshot.operationId;
                }
                result = existing;
            } else {
                this.value.snapshots.unshift(snapshot);
                result = snapshot;
            }
            this.value.snapshots.sort(
                (a, b) => (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt),
            );
            this.value.snapshots.splice(MAX_SNAPSHOTS);
            await this.persist();
        });
        this.writeTask = task.catch((error) => {
            this.onError(
                `failed to write environment snapshots: ${error instanceof Error ? error.message : error}`,
            );
        });
        await task;
        return result;
    }

    async list() {
        await this.waitForWrites();
        return [...this.value.snapshots];
    }

    async get(id: string) {
        await this.waitForWrites();
        return this.value.snapshots.find((snapshot) => snapshot.id === id);
    }
}

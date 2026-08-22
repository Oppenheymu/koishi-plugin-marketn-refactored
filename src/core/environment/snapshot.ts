/**
 * @file 环境快照:类型、构建与持久化存储(core/environment 域)。
 *
 * 环境快照记录某一时刻宿主全部依赖的请求/已装版本/来源分类,是回滚的
 * 依据:createEnvironmentSnapshot 按"归一化依赖表"的内容哈希生成稳定 id
 * —— 内容相同即同一快照,天然去重;EnvironmentSnapshotStore 负责防抖落盘
 * (上限 60 条,按 lastSeenAt 淘汰),快照在安装前后(startup/operation/
 * external 三种来源)各记一次。
 *
 * 架构位置:被 install/orchestrator(capture/record)与 install/environment
 * (回滚预览)消费;diff/apply 逻辑在邻文件,本文件只管形状与存取。
 */
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import type { Dict } from "koishi";
import { classifyDependencySource, type DependencySource } from "../../shared/dependency-source.js";
import { writeJsonAtomic } from "../utils/atomic-write.js";

/** 单个依赖在快照中的形态(请求 + 已装状态 + 来源分类)。 */
export interface EnvironmentDependencySnapshot {
    /** package.json 中的原始请求串 */
    request: string;
    /** 已装版本(未安装时缺省) */
    resolved?: string | undefined;
    /** 是否 workspace 成员 */
    workspace?: boolean | undefined;
    /** 来源分类(registry/local/unbound 等) */
    source?: DependencySource | undefined;
    /** 是否本地来源依赖 */
    local?: boolean | undefined;
    bound?: boolean | undefined;
    /** 请求是否非法(非本地且非合法 semver) */
    invalid?: boolean | undefined;
}

/** 快照来源:启动采集 / 安装操作后 / 外部变更(安装前兜底)。 */
export type EnvironmentSnapshotSource = "startup" | "operation" | "external";

/** 环境快照(依赖表的完整存档)。 */
export interface EnvironmentSnapshot {
    /** 内容哈希 id(env-<sha256 前 20 位>,内容相同即同 id) */
    id: string;
    /** 首次创建时间 */
    createdAt: number;
    /** 最近一次以同内容出现的时间(淘汰排序依据) */
    lastSeenAt?: number | undefined;
    source: EnvironmentSnapshotSource;
    /** 关联的安装日志 id(source=operation 时) */
    operationId?: string | undefined;
    dependencies: Dict<EnvironmentDependencySnapshot>;
}

/** 快照摘要(列表展示用,不含依赖明细)。 */
export interface EnvironmentSnapshotSummary {
    id: string;
    createdAt: number;
    lastSeenAt?: number | undefined;
    source: EnvironmentSnapshotSource;
    operationId?: string | undefined;
    /** 依赖条目数 */
    dependencyCount: number;
    /** 是否当前环境对应的快照 */
    current: boolean;
}

/** 快照文件的落盘结构(version 1)。 */
interface PersistedEnvironmentSnapshotStore {
    version: 1;
    snapshots: EnvironmentSnapshot[];
}

/** 最多保留的快照条数(超出按 lastSeenAt 淘汰最旧)。 */
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
            // source 缺失时按请求串重新分类补全
            source: dependency.source || source.source,
            local: (dependency.local ?? source.local) || undefined,
            bound: dependency.bound,
            invalid: dependency.invalid || undefined,
        };
    }
    return result;
}

/**
 * 生成依赖表的规范化文本(用于内容哈希):只取影响语义的字段
 * (name/版本或请求/source/local),键已排序,确保内容等价的
 * 两份快照哈希一致。
 */
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

/** 由依赖表内容生成快照 id(env- + sha256 前 20 位)。 */
function getEnvironmentSnapshotId(dependencies: Dict<EnvironmentDependencySnapshot>) {
    return `env-${createHash("sha256")
        .update(canonicalDependencies(dependencies))
        .digest("hex")
        .slice(0, 20)}`;
}

/** 构建环境快照:归一化依赖表并生成内容哈希 id。 */
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

/** 快照 → 摘要(currentId 相同者标记为当前环境)。 */
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
    /** 惰性且单飞的文件加载 */
    private loaded?: Promise<void>;
    /** 写任务链:所有写操作串行排队,读侧等待 */
    private writeTask = Promise.resolve();
    private value: PersistedEnvironmentSnapshotStore = { version: 1, snapshots: [] };

    constructor(filename: string, onError: (message: string) => void) {
        this.filename = filename;
        this.onError = onError;
    }

    /** 惰性加载快照文件:损坏/不存在时回退空库(ENOENT 不算错误)。 */
    private async load() {
        if (!this.loaded) {
            this.loaded = (async () => {
                try {
                    const parsed = JSON.parse(
                        await fsp.readFile(this.filename, "utf8"),
                    ) as PersistedEnvironmentSnapshotStore;
                    if (parsed?.version !== 1 || !Array.isArray(parsed.snapshots))
                        throw new Error("invalid snapshot store");
                    // 逐条过滤缺 id/依赖表的坏条目,避免单条损坏拖垮整库
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

    /** 等待加载与全部排队中的写任务(保证读到最新落盘内容)。 */
    private async waitForWrites() {
        await this.load();
        await this.writeTask;
    }

    /** 原子写整库(临时文件 + rename)。 */
    private async persist() {
        await writeJsonAtomic(this.filename, this.value, { indent: 2 });
    }

    /**
     * 记录快照:同 id(同内容)已存在则只刷新 lastSeenAt(operation 来源
     * 还会补记来源与日志 id),否则插到队首;随后按 lastSeenAt 排序、
     * 截断到上限并落盘。写操作串行排在 writeTask 链上,互不交错。
     */
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
        // 链尾吞掉错误只上报,不阻断后续写任务
        this.writeTask = task.catch((error) => {
            this.onError(
                `failed to write environment snapshots: ${error instanceof Error ? error.message : error}`,
            );
        });
        await task;
        return result;
    }

    /** 列出全部快照(副本,按 lastSeenAt 降序)。 */
    async list() {
        await this.waitForWrites();
        return [...this.value.snapshots];
    }

    /** 按 id 取单个快照(找不到为 undefined)。 */
    async get(id: string) {
        await this.waitForWrites();
        return this.value.snapshots.find((snapshot) => snapshot.id === id);
    }
}

import { promises as fsp } from "node:fs";
import { resolve } from "node:path";
import { DataService } from "@koishijs/console";
import type { Context, Dict } from "koishi";
import { writeJsonAtomic } from "../../core/utils/atomic-write.js";
import type { PluginBundleRecord } from "../../shared/bundle.js";
import type { UpdateIgnoreRule } from "../../shared/update.js";

const COLLAPSED_GROUPS_VERSION = 1;

export interface MarketDataStorePayload {
    override: Dict<string>;
    updateIgnored: Dict<string | UpdateIgnoreRule>;
    bundleRecords: Dict<PluginBundleRecord>;
    collapsedGroups: Dict<boolean>;
}

const emptyStore = (): MarketDataStorePayload => ({
    override: {},
    updateIgnored: {},
    bundleRecords: {},
    collapsedGroups: {},
});

/** 只读读取 market-next 数据文件（升级命令兜底路径）。 */
export async function readMarketDataStore(ctx: Context): Promise<MarketDataStorePayload> {
    const file = resolve(ctx.baseDir, "data", "market-next.json");
    try {
        return normalizeStore(JSON.parse(await fsp.readFile(file, "utf8")));
    } catch (error) {
        if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
            ctx.logger("market").warn(
                `failed to read market-next data store: ${error instanceof Error ? error.message : error}`,
            );
        }
        return emptyStore();
    }
}

/** marketData 通道：override / updateIgnored / bundleRecords / collapsedGroups 的持久化存储。 */
export class MarketDataStore extends DataService<MarketDataStorePayload> {
    private file: string;
    private data = emptyStore();
    private ready: Promise<void> | undefined;
    private writeTask: Promise<void> | undefined;
    private writeTimer: NodeJS.Timeout | undefined;
    private writePending = false;
    private hasCollapsedGroupsState = false;
    private collapsedGroupsVersion = 0;

    constructor(ctx: Context) {
        super(ctx, "marketData", { immediate: true, authority: 4 });
        this.file = resolve(ctx.baseDir, "data", "market-next.json");
        this.ready = this.load();
        ctx.effect(() => () => {
            if (this.writeTimer) clearTimeout(this.writeTimer);
            void this.ready?.then(() => this.write());
        });
    }

    override async get() {
        await this.ready;
        return this.snapshot();
    }

    override async patch(patch: Partial<MarketDataStorePayload>) {
        await this.ready;
        let changed = false;
        for (const key of [
            "override",
            "updateIgnored",
            "bundleRecords",
            "collapsedGroups",
        ] as const) {
            if (!Object.hasOwn(patch, key)) continue;
            this.data[key] = normalizeDict(patch[key]);
            if (key === "collapsedGroups") this.hasCollapsedGroupsState = true;
            changed = true;
        }
        if (!changed) return this.snapshot();
        this.scheduleWrite();
        super.patch(this.snapshot());
        return this.snapshot();
    }

    async setBundleRecord(record: PluginBundleRecord) {
        await this.ready;
        this.data.bundleRecords ||= {};
        this.data.bundleRecords[record.package] = record;
        const snapshot = this.snapshot();
        super.patch(snapshot);
        await this.flushWriteNow();
        return snapshot;
    }

    async migrateFromConfig(config: {
        updateIgnored?: Dict<string | UpdateIgnoreRule>;
        bundleRecords?: Dict<PluginBundleRecord>;
        collapsedGroups?: Dict<boolean>;
    }) {
        await this.ready;
        const patch: Partial<MarketDataStorePayload> = {};
        const migrateCollapsedGroups = this.collapsedGroupsVersion < COLLAPSED_GROUPS_VERSION;
        if (
            !Object.keys(this.data.updateIgnored).length &&
            Object.keys(config.updateIgnored ?? {}).length
        ) {
            patch.updateIgnored = config.updateIgnored ?? {};
        }
        if (
            !Object.keys(this.data.bundleRecords).length &&
            Object.keys(config.bundleRecords ?? {}).length
        ) {
            patch.bundleRecords = config.bundleRecords ?? {};
        }
        if (!this.hasCollapsedGroupsState) {
            patch.collapsedGroups = config.collapsedGroups ?? {};
        }
        if (migrateCollapsedGroups) {
            const collapsedGroups = normalizeDict<boolean>(
                patch.collapsedGroups ?? this.data.collapsedGroups,
            );
            delete collapsedGroups["installed"];
            patch.collapsedGroups = collapsedGroups;
            this.collapsedGroupsVersion = COLLAPSED_GROUPS_VERSION;
        }
        if (Object.keys(patch).length) await this.patch(patch);
        if (migrateCollapsedGroups) await this.flushWriteNow();
    }

    private snapshot(): MarketDataStorePayload {
        return {
            override: { ...this.data.override },
            updateIgnored: { ...this.data.updateIgnored },
            bundleRecords: { ...this.data.bundleRecords },
            collapsedGroups: { ...this.data.collapsedGroups },
        };
    }

    private async load() {
        try {
            const content = await fsp.readFile(this.file, "utf8");
            const value = JSON.parse(content);
            this.hasCollapsedGroupsState = Object.hasOwn(value, "collapsedGroups");
            this.collapsedGroupsVersion = Number.isInteger(value?.collapsedGroupsVersion)
                ? Math.max(0, value.collapsedGroupsVersion)
                : 0;
            this.data = normalizeStore(value);
        } catch (error) {
            if ((error as NodeJS.ErrnoException | undefined)?.code !== "ENOENT") {
                this.ctx
                    .logger("market")
                    .warn(
                        `failed to read market-next data store: ${error instanceof Error ? error.message : error}`,
                    );
            }
            this.hasCollapsedGroupsState = false;
            this.collapsedGroupsVersion = 0;
            this.data = emptyStore();
        }
    }

    private scheduleWrite() {
        if (this.writeTimer) clearTimeout(this.writeTimer);
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            this.flushWrite();
        }, 0);
    }

    private flushWrite() {
        if (this.writeTask) {
            this.writePending = true;
            return;
        }
        this.writeTask = this.write().finally(() => {
            this.writeTask = undefined;
            if (!this.writePending) return;
            this.writePending = false;
            this.flushWrite();
        });
    }

    private async flushWriteNow() {
        if (this.writeTimer) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        if (this.writeTask) await this.writeTask;
        this.writePending = false;
        await this.write();
    }

    private async write() {
        try {
            await writeJsonAtomic(
                this.file,
                {
                    ...this.data,
                    collapsedGroupsVersion: this.collapsedGroupsVersion,
                },
                { indent: 2, newline: false },
            );
        } catch (error) {
            this.ctx
                .logger("market")
                .warn(
                    `failed to write market-next data store: ${error instanceof Error ? error.message : error}`,
                );
        }
    }
}

function normalizeStore(value: unknown): MarketDataStorePayload {
    const record = isRecord(value) ? value : {};
    return {
        override: normalizeDict(record["override"]),
        updateIgnored: normalizeDict(record["updateIgnored"]),
        bundleRecords: normalizeDict(record["bundleRecords"]),
        collapsedGroups: normalizeDict<boolean>(record["collapsedGroups"]),
    };
}

function normalizeDict<T = unknown>(value: unknown): Dict<T> {
    if (!isRecord(value)) return {};
    return { ...(value as Dict<T>) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

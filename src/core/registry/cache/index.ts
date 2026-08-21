import type { Dict } from "koishi";
import type { RequestScope } from "../../racing/request-scope.js";
import { MINUTE } from "../../utils/time.js";
import type { RegistryClient } from "../client/index.js";
import {
    type DependencyMetaKey,
    filterCompatibleVersions,
    getVersions,
    type RemotePackage,
} from "../manifest.js";

const NOT_FOUND_CACHE_TTL = 5 * MINUTE;

export type PackageVersions = Dict<Pick<RemotePackage, DependencyMetaKey>>;

export interface PackageCacheDeps {
    client: RegistryClient;
    scope: RequestScope;
    log: { debug(message: string): void; warn(message: string): void };
    /** tempCache 聚合后的通道广播（节流在适配层） */
    onFlush: () => void;
}

/**
 * 包版本缓存：fullCache（全量）/ tempCache（增量广播）/ notFoundCache（404 负缓存）三层
 * + pkgTasks 任务去重。成块移植自旧 Installer 的缓存方法。
 */
export class PackageCache {
    fullCache: Dict<PackageVersions> = {};
    tempCache: Dict<PackageVersions> = {};
    private pkgTasks: Dict<Promise<PackageVersions | undefined>> = {};
    private notFoundCache: Dict<number> = {};
    private readonly deps: PackageCacheDeps;

    constructor(deps: PackageCacheDeps) {
        this.deps = deps;
    }

    notFoundAt(name: string) {
        return this.notFoundCache[name];
    }

    isNotFoundCached(name: string) {
        const notFoundAt = this.notFoundCache[name];
        return !!notFoundAt && Date.now() - notFoundAt < NOT_FOUND_CACHE_TTL;
    }

    setPackage(name: string, versions: RemotePackage[]) {
        delete this.notFoundCache[name];
        this.fullCache[name] = this.tempCache[name] = getVersions(versions);
        this.flush();
        this.pkgTasks[name] = Promise.resolve(this.fullCache[name]);
    }

    getPackage(name: string) {
        if (this.isNotFoundCached(name)) {
            return Promise.resolve(undefined);
        }
        delete this.notFoundCache[name];
        if (!this.pkgTasks[name]) {
            const task = this._getPackage(name, this.deps.scope.current);
            this.pkgTasks[name] = task;
            task.then(
                (versions) => {
                    if (this.pkgTasks[name] !== task) return;
                    if (!versions) delete this.pkgTasks[name];
                },
                (error: unknown) => {
                    if (this.pkgTasks[name] !== task) return;
                    delete this.pkgTasks[name];
                    const reason = this.deps.client.formatError(error).reason;
                    if (reason === "not-found") this.notFoundCache[name] = Date.now();
                },
            );
        }
        return this.pkgTasks[name];
    }

    async findVersion(names: string[]) {
        const entries = await Promise.all(
            names.map(async (name) => {
                try {
                    const versions = Object.entries((await this.getPackage(name)) ?? {});
                    if (!versions.length) return undefined;
                    return { [name]: versions[0]![0] };
                } catch {
                    return undefined;
                }
            }),
        );
        return entries.find(Boolean);
    }

    flush() {
        this.deps.onFlush();
    }

    clear() {
        this.pkgTasks = {};
        this.notFoundCache = {};
        this.fullCache = {};
        this.tempCache = {};
    }

    private async _getPackage(name: string, serial: number): Promise<PackageVersions | undefined> {
        try {
            const registry = await this.deps.client.getRegistry(name, serial);
            if (this.deps.scope.isStale(serial)) return undefined;
            if (!registry) return undefined;
            delete this.notFoundCache[name];
            this.fullCache[name] = this.tempCache[name] = filterCompatibleVersions(name, registry);
            this.flush();
            return this.fullCache[name];
        } catch (error) {
            this.deps.log.warn(error instanceof Error ? error.message : String(error));
            throw error;
        }
    }
}

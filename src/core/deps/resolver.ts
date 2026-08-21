import type { Dict } from "koishi";
import pMap from "p-map";
import { valid } from "semver";
import {
    classifyDependencySource,
    classifyRegistryNotFoundDependency,
    reuseConfirmedDependencySource,
} from "../../shared/dependency-source.js";
import type { RequestScope } from "../racing/request-scope.js";
import type { PackageCache } from "../registry/cache.js";
import type { RegistryErrorDetail } from "../registry/errors.js";
import {
    loadManifest,
    type PackageJson,
    pickMetadataProbe,
    Scanner,
} from "../registry/manifest.js";
import type { Dependency } from "./types.js";

const MINUTE = 60_000;

export interface DependencyResolverDeps {
    cwd: () => string;
    cache: PackageCache;
    scope: RequestScope;
    concurrency: () => number | undefined;
    formatError: (error: unknown) => RegistryErrorDetail;
    /** 元数据刷新前的路由探测预热（client.ensureMetadataEndpoint） */
    ensureProbe: (name: string) => Promise<void>;
    log: { debug(message: string): void; info(message: string): void; warn(message: string): void };
    /** 元数据刷新完成后的通道刷新（console.refresh('dependencies')） */
    onMetadataRefreshed: () => void;
}

/** 依赖快照与 latest 元数据刷新。成块移植自旧 Installer 的依赖相关方法。 */
export class DependencyResolver {
    private manifest: PackageJson | undefined;
    private depCache: Dict<Dependency> = {};
    private depTask: Promise<Dict<Dependency>> | undefined;
    private depMetadataFresh = false;
    private readonly deps: DependencyResolverDeps;

    constructor(deps: DependencyResolverDeps) {
        this.deps = deps;
    }

    /** 重载宿主 package.json（安装后/刷新前调用）。 */
    reloadManifest() {
        this.manifest = loadManifest(this.deps.cwd());
    }

    getLocalDepsSnapshot(): Dict<Dependency> {
        const start = Date.now();
        this.manifest ??= loadManifest(this.deps.cwd());
        const manifest = this.manifest;
        const result: Dict<Dependency> = {};
        for (const [name, request] of Object.entries(manifest.dependencies ?? {})) {
            result[name] = { request: request.replace(/^[~^]/, "") };
        }
        const names = Object.keys(result);
        for (const name of names) {
            const dep = result[name]!;
            try {
                const meta = loadManifest(name, this.deps.cwd());
                dep.resolved = meta.version;
                dep.workspace = meta.$workspace;
                this.deps.log.debug(
                    `local dependency resolved: ${name}@${meta.version}, workspace=${!!meta.$workspace}, request=${dep.request}`,
                );
            } catch {
                this.deps.log.debug(
                    `local dependency not found before metadata fetch: ${name}, request=${dep.request}`,
                );
            }

            const source = classifyDependencySource(dep.request, {
                workspace: dep.workspace,
                installed: !!dep.resolved,
            });
            Object.assign(dep, source);

            if (!dep.local && !valid(dep.request)) {
                dep.invalid = true;
                this.deps.log.debug(
                    `dependency request is not exact semver: ${name}, request=${dep.request}`,
                );
            }

            const previous = this.depCache?.[name];
            const notFoundAt = this.deps.cache.notFoundAt(name);
            const preserved = reuseConfirmedDependencySource(
                previous,
                dep,
                !!notFoundAt && Date.now() - notFoundAt < 5 * MINUTE,
            );
            if (preserved) Object.assign(dep, preserved);
            if (
                previous?.latest &&
                previous.request === dep.request &&
                previous.resolved === dep.resolved
            ) {
                dep.latest = previous.latest;
            }
        }
        const installed = Object.values(result).filter((dep) => dep.resolved).length;
        const invalid = Object.values(result).filter((dep) => dep.invalid).length;
        this.deps.log.info(
            `dependency local snapshot ready: total=${names.length}, installed=${installed}, invalid=${invalid}, elapsed=${Date.now() - start}ms`,
        );
        return result;
    }

    markRegistryNotFoundDependency(
        name: string,
        dependency: Dependency | undefined = this.depCache[name],
    ) {
        const source = classifyRegistryNotFoundDependency(dependency, Scanner.isPlugin(name));
        if (!source || !dependency) return false;
        Object.assign(dependency, source);
        dependency.invalid = false;
        delete dependency.latest;
        this.deps.log.info(
            `dependency classified as unbound local plugin: ${name}@${dependency.resolved}`,
        );
        return true;
    }

    private async refreshMetadata(result = this.depCache, serial = this.deps.scope.current) {
        const start = Date.now();
        const names = Object.keys(result);
        const targets = names.filter((name) => !result[name]!.local && !result[name]!.invalid);
        this.deps.log.debug(
            `refresh dependency metadata started: total=${names.length}, targets=${targets.length}, concurrency=${this.deps.concurrency() ?? 4}`,
        );
        const probeName = pickMetadataProbe(targets);
        if (probeName) await this.deps.ensureProbe(probeName);
        this.deps.log.debug(`refresh dependency metadata route ready: probe=${probeName ?? "-"}`);
        await pMap(
            targets,
            async (name) => {
                if (this.deps.scope.isStale(serial)) return;
                try {
                    const versions = await this.deps.cache.getPackage(name);
                    if (this.deps.scope.isStale(serial)) return;
                    if (versions) {
                        result[name]!.latest = Object.keys(versions)[0];
                        this.deps.log.debug(
                            `dependency latest resolved: ${name}, resolved=${result[name]!.resolved ?? "-"}, latest=${result[name]!.latest}, versions=${Object.keys(versions).length}`,
                        );
                    } else if (
                        this.deps.cache.isNotFoundCached(name) &&
                        this.markRegistryNotFoundDependency(name, result[name])
                    ) {
                        this.deps.log.debug(
                            `dependency npm not-found result reused from cache: ${name}`,
                        );
                    } else {
                        this.deps.log.debug(
                            `dependency latest unresolved: ${name}, resolved=${result[name]!.resolved ?? "-"}, request=${result[name]!.request}`,
                        );
                    }
                } catch (error) {
                    if (this.deps.scope.isStale(serial)) return;
                    const detail = this.deps.formatError(error);
                    if (
                        detail.reason === "not-found" &&
                        this.markRegistryNotFoundDependency(name, result[name])
                    ) {
                        // 全路由 404 可确认：已安装、registry 形态命名的插件实为本地包
                    } else {
                        this.deps.log.debug(
                            `dependency metadata refresh skipped after error: ${name}, reason=${detail.reason}, error=${detail.error}`,
                        );
                    }
                }
            },
            { concurrency: this.deps.concurrency() ?? 4 },
        );
        this.deps.log.info(
            `dependency metadata refresh completed: total=${names.length}, targets=${targets.length}, elapsed=${Date.now() - start}ms`,
        );
        if (!this.deps.scope.isStale(serial)) {
            this.depMetadataFresh = true;
            this.deps.onMetadataRefreshed();
        }
        return result;
    }

    refreshDependencyMetadata(wait = false) {
        if (this.depMetadataFresh) return wait ? Promise.resolve(this.depCache) : undefined;
        if (!this.depTask) {
            const task = this.refreshMetadata(this.depCache, this.deps.scope.current);
            this.depTask = task;
            task.then(
                () => {
                    if (this.depTask === task) this.depTask = undefined;
                },
                (error: unknown) => {
                    if (this.depTask === task) this.depTask = undefined;
                    this.deps.log.warn(
                        `dependency metadata refresh failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                },
            );
        }
        return wait ? this.depTask : undefined;
    }

    getDeps(options: { metadata?: boolean; background?: boolean } = {}) {
        if (!Object.keys(this.depCache).length) {
            this.depCache = this.getLocalDepsSnapshot();
        }
        if (options.metadata) return this.refreshDependencyMetadata(true);
        if (options.background !== false) void this.refreshDependencyMetadata(false);
        return this.depCache;
    }

    /** 轻量重建：重载 manifest + 重建本地快照（不清包缓存），用于安装回滚后。 */
    reload() {
        this.reloadManifest();
        this.depMetadataFresh = false;
        this.depCache = this.getLocalDepsSnapshot();
        return this.depCache;
    }

    /** 全量重置（refresh/probe 入口调用）：清缓存与元数据状态，重建本地快照。 */
    resetForRefresh() {
        this.deps.cache.clear();
        this.depTask = undefined;
        return this.reload();
    }
}

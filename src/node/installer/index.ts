import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { RemotePackage } from "@koishijs/registry";
import { type Context, type Dict, type HTTP, Service, Time } from "koishi";
import { detect } from "package-manager-detector";
import type { DependencyResolver } from "../../core/deps/resolver.js";
import type { EnvironmentSnapshotOps } from "../../core/install/environment.js";
import { getInstallHistory, getInstallLogDetail } from "../../core/install/logs/reader.js";
import type { InstallLogRetention } from "../../core/install/logs/retention.js";
import type { InstallLogStore } from "../../core/install/logs/store.js";
import type { InstallOrchestrator } from "../../core/install/pipeline/orchestrator.js";
import type { InstallQueue } from "../../core/install/pipeline/queue.js";
import { type PackageManagerAgent, runPackageManager } from "../../core/install/pipeline/runner.js";
import {
    overrideDependencies,
    snapshotPackageManifest,
    writeManifest,
} from "../../core/install/sources/manifest-restore.js";
import type { LocalPackageUploadService } from "../../core/install/sources/upload.js";
import type { InstallLogger, InstallOptions } from "../../core/install/types.js";
import type { RequestScope } from "../../core/racing/request-scope.js";
import type { PackageCache, PackageVersions } from "../../core/registry/cache/index.js";
import type { RegistryStatsStore } from "../../core/registry/cache/stats-file.js";
import type { RegistryClient } from "../../core/registry/client/index.js";
import { resolvePluginName } from "../../core/registry/manifest.js";
import type { LocalPackageUploadStore } from "../../core/upload/session.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadPreview,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "../../core/upload/types.js";
import type { JsonStore } from "../../core/utils/json-store.js";
import type { InstallFallbackCandidate, RegistryStatus } from "../../shared/types.js";
import type { InstallerConfig, InstallerGetDepsOptions } from "./config.js";
import { createInstallerCore, createInstallLogger } from "./wire.js";

export const SELF_PACKAGE = "koishi-plugin-marketn-refactored";

/**
 * installer 服务门面：保持 ctx.installer 全部 public 方法签名不变，
 * 内部把 core 各「入口类」组装起来，并负责 koishi 通道的广播/刷新/生命周期。
 */
export class Installer extends Service {
    public http: HTTP;
    public registryStatus: Dict<RegistryStatus> = {};
    public override config: InstallerConfig;

    private readonly scope: RequestScope;
    private readonly statsFile: JsonStore<RegistryStatsStore>;
    private readonly registry: RegistryClient;
    private readonly packages: PackageCache;
    private readonly resolver: DependencyResolver;
    private readonly queue: InstallQueue;
    private readonly logs: InstallLogStore;
    private readonly orchestrator: InstallOrchestrator;
    private readonly envOps: EnvironmentSnapshotOps;
    private readonly retention: InstallLogRetention;
    private readonly uploads: LocalPackageUploadStore;
    private readonly uploadService: LocalPackageUploadService;
    private readonly log: InstallLogger;
    private readonly require: NodeRequire;
    private readonly agent: PackageManagerAgent = { name: "npm" };
    private tempRegistryStatus: Dict<RegistryStatus> = {};
    private readonly flushRegistryStatus: () => void;

    constructor(ctx: Context, config: InstallerConfig = {}) {
        super(ctx, "installer");
        this.config = config;
        this.log = createInstallLogger(ctx.logger("market"));
        this.require = createRequire(resolve(ctx.baseDir, "package.json"));
        this.http = ctx.http;

        const core = createInstallerCore(ctx, config, {
            log: this.log,
            cwd: this.cwd,
            agent: this.agent,
            setRegistryStatus: (name, status, serial) =>
                this.setRegistryStatus(name, status, serial),
            refreshData: () => this.refreshData(),
            clearRegistryStatus: () => this.clearRegistryStatus(),
            isPackageLoaded: (name) => this.isPackageLoaded(name),
            drainRegistryStatus: () => this.drainRegistryStatus(),
        });
        this.scope = core.scope;
        this.statsFile = core.statsFile;
        this.registry = core.registry;
        this.packages = core.packages;
        this.resolver = core.resolver;
        this.queue = core.queue;
        this.logs = core.logs;
        this.orchestrator = core.orchestrator;
        this.envOps = core.envOps;
        this.retention = core.retention;
        this.uploads = core.uploads;
        this.uploadService = core.uploadService;
        this.flushRegistryStatus = core.flushRegistryStatus;

        void detect().then((result) => {
            if (result) {
                this.agent.name = result.name;
                this.agent.version = result.version;
            }
        });

        ctx.setInterval(() => void this.uploads.pruneExpired(), Time.minute * 5);
        ctx.effect(() => () => {
            this.scope.dispose("installer disposed");
            void this.uploads.dispose();
        });
    }

    get cwd() {
        return this.ctx.baseDir;
    }

    get isInstalling() {
        return this.queue.isInstalling;
    }

    get fullCache(): Dict<PackageVersions> {
        return this.packages.fullCache;
    }

    get tempCache(): Dict<PackageVersions> {
        return this.packages.tempCache;
    }

    get endpoint() {
        return this.registry.endpoint;
    }

    override async start() {
        await this.registry.restoreStats(await this.statsFile.read());
        await this.registry.resetEndpoint();
        this.log.info(
            `npm registry endpoint initialized: ${this.registry.endpoint}, timeout=${this.config.timeout ?? "default"}, autoRoute=${this.config.autoRoute !== false}`,
        );
        await this.orchestrator.recordCurrentEnvironmentSnapshot("startup").catch((error) => {
            this.log.warn(
                `failed to record startup environment snapshot: ${error instanceof Error ? error.message : error}`,
            );
        });
        this.resolver.getDeps({ background: false });
        void this.resolver.refreshDependencyMetadata(false);
    }

    resolveName(name: string) {
        return resolvePluginName(name);
    }

    findVersion(names: string[]) {
        return this.packages.findVersion(names);
    }

    getInstallFallbackCandidate(failedEndpoint?: string): InstallFallbackCandidate | undefined {
        return this.registry.getInstallFallbackCandidate(failedEndpoint);
    }

    getRegistry(name: string, serial?: number) {
        return this.registry.getRegistry(name, serial);
    }

    setPackage(name: string, versions: RemotePackage[]) {
        this.packages.setPackage(name, versions);
    }

    getPackage(name: string) {
        return this.packages.getPackage(name);
    }

    refreshDependencyMetadata(wait = false) {
        return this.resolver.refreshDependencyMetadata(wait);
    }

    async probeDependenciesInBackground(reason = "background") {
        const start = Date.now();
        await this.orchestrator.refreshDependencyState();
        await this.resolver.refreshDependencyMetadata(true);
        await this.refreshData();
        this.log.info(`dependency ${reason} probe completed: elapsed=${Date.now() - start}ms`);
    }

    getDeps(options: InstallerGetDepsOptions = {}) {
        return this.resolver.getDeps(options);
    }

    async refreshData() {
        await Promise.all([
            this.ctx.get("console")?.refresh("dependencies"),
            this.ctx.get("console")?.refresh("registry"),
            this.ctx.get("console")?.refresh("registryStatus"),
            this.ctx.get("console")?.refresh("packages"),
        ]);
    }

    async refresh(refresh = false, waitMetadata = false) {
        await this.orchestrator.refreshDependencyState();
        const metadataTask = this.resolver.refreshDependencyMetadata(true);
        if (!refresh) return;
        await this.refreshData();
        if (waitMetadata) await metadataTask;
    }

    getInstallHistory(limit = 20) {
        return getInstallHistory(limit, {
            cwd: this.cwd,
            log: this.log,
            activeFile: () => this.logs.activeFile,
            waitForWrite: () => this.logs.waitForWrite(),
            cleanup: () =>
                this.retention.cleanup(this.logs.activeFile, this.logs.activeMetadataFile),
        });
    }

    getInstallLogDetail(id: string) {
        return getInstallLogDetail(id, {
            cwd: this.cwd,
            log: this.log,
            activeFile: () => this.logs.activeFile,
            waitForWrite: () => this.logs.waitForWrite(),
            cleanup: () =>
                this.retention.cleanup(this.logs.activeFile, this.logs.activeMetadataFile),
        });
    }

    getEnvironmentSnapshots() {
        return this.envOps.getEnvironmentSnapshots();
    }

    getEnvironmentSnapshotPreview(id: string) {
        return this.envOps.getEnvironmentSnapshotPreview(id);
    }

    exec(args: string[]) {
        return runPackageManager(args, {
            cwd: this.cwd,
            agent: this.agent,
            log: this.log,
            emitLog: (type, line) => this.logs.emit(type, line),
        });
    }

    async override(deps: Dict<string>) {
        const snapshot = await snapshotPackageManifest(this.cwd);
        overrideDependencies(snapshot.manifest, deps);
        await writeManifest(this.cwd, snapshot.manifest);
    }

    install(
        deps: Dict<string>,
        forced?: boolean,
        beforeReload?: () => unknown,
        options: InstallOptions = {},
    ) {
        return this.orchestrator.install(deps, forced, beforeReload, options);
    }

    startLocalPackageUpload(
        request: LocalPackageUploadStartRequest,
    ): Promise<LocalPackageUploadStartResult> {
        return this.uploadService.startLocalPackageUpload(request);
    }

    appendLocalPackageUpload(
        request: LocalPackageUploadChunkRequest,
    ): Promise<LocalPackageUploadProgress> {
        return this.uploadService.appendLocalPackageUpload(request);
    }

    finishLocalPackageUpload(
        request: LocalPackageUploadFinishRequest,
    ): Promise<LocalPackageUploadPreview> {
        return this.uploadService.finishLocalPackageUpload(request);
    }

    commitLocalPackageUpload(uploadId: string): Promise<LocalPackageUploadCommitResult> {
        return this.uploadService.commitLocalPackageUpload(uploadId);
    }

    cancelLocalPackageUpload(uploadId: string) {
        return this.uploadService.cancelLocalPackageUpload(uploadId);
    }

    prepareLocalBinding(name: string) {
        return this.uploadService.prepareLocalBinding(name);
    }

    applyEnvironmentSnapshot(id: string, options: InstallOptions = {}) {
        return this.envOps.applyEnvironmentSnapshot(id, options);
    }

    isSelfUpdate(deps: Dict<string>) {
        return Object.hasOwn(deps, SELF_PACKAGE);
    }

    private setRegistryStatus(name: string, status: Partial<RegistryStatus>, serial: number) {
        if (this.scope.isStale(serial)) return;
        const value: RegistryStatus = {
            ...this.registryStatus[name],
            ...status,
            updatedAt: Date.now(),
        };
        this.registryStatus[name] = this.tempRegistryStatus[name] = value;
        this.flushRegistryStatus();
    }

    private clearRegistryStatus() {
        this.registryStatus = {};
        this.tempRegistryStatus = {};
        void this.ctx.get("console")?.broadcast("market/registry-status/clear", {});
    }

    private drainRegistryStatus(): Dict<RegistryStatus> {
        const status = this.tempRegistryStatus;
        this.tempRegistryStatus = {};
        return status;
    }

    private isPackageLoaded(name: string) {
        try {
            return this.require.resolve(name) in this.require.cache;
        } catch {
            return true;
        }
    }
}

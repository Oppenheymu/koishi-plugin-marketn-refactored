// 宿主 @koishijs/plugin-config 提供 packages/services/config 三个 Console 服务的
// 类型声明（Services 键），setup/listeners 中多处 refresh('packages')/refresh('config') 依赖它
import type {} from "@koishijs/plugin-config";
import type { DependencyMetaKey, Registry, RemotePackage } from "@koishijs/registry";
import type { Dict } from "koishi";
import type { EnvironmentSnapshotPreview } from "../core/environment/diff.js";
import type { EnvironmentSnapshotSummary } from "../core/environment/snapshot.js";
import type {
    InstallHistoryEntry,
    InstallLogDetail,
    InstallOptions,
    LocalBindingResult,
} from "../core/install/types.js";
import type {
    LocalPackageUploadChunkRequest,
    LocalPackageUploadCommitResult,
    LocalPackageUploadFinishRequest,
    LocalPackageUploadPreview,
    LocalPackageUploadProgress,
    LocalPackageUploadStartRequest,
    LocalPackageUploadStartResult,
} from "../core/upload/types.js";
import type {
    BundleConfigRemoveRequest,
    BundleConfigRemoveResult,
    BundleInstallRequest,
    BundleInstallResult,
} from "../shared/bundle.js";
import type { InstallFallbackCandidate } from "../shared/types.js";
import type { AvatarFetchResult } from "./avatar/index.js";
import type { Config } from "./config/index.js";
import type {
    DependencyProvider,
    RegistryProvider,
    RegistryStatusProvider,
} from "./console/providers.js";
import type { Installer } from "./installer/index.js";
import type { MarketDataStore, MarketDataStorePayload } from "./market/data-store.js";

declare module "koishi" {
    interface Context {
        installer: Installer;
    }
}

declare module "@koishijs/console" {
    namespace Console {
        interface Services {
            dependencies: DependencyProvider;
            registry: RegistryProvider;
            registryStatus: RegistryStatusProvider;
            marketData: MarketDataStore;
        }
    }

    interface Events {
        "market/install"(
            deps: Dict<string>,
            forced?: boolean,
            options?: InstallOptions,
        ): Promise<number>;
        "market/install-bundle"(
            request: BundleInstallRequest,
            forced?: boolean,
            options?: InstallOptions,
        ): Promise<BundleInstallResult>;
        "market/install-fallback-candidate"(
            failedEndpoint?: string,
        ): Promise<InstallFallbackCandidate | undefined>;
        "market/install-history"(limit?: number): Promise<InstallHistoryEntry[]>;
        "market/install-history-detail"(id: string): Promise<InstallLogDetail | undefined>;
        "market/local-package-upload-start"(
            request: LocalPackageUploadStartRequest,
        ): Promise<LocalPackageUploadStartResult>;
        "market/local-package-upload-chunk"(
            request: LocalPackageUploadChunkRequest,
        ): Promise<LocalPackageUploadProgress>;
        "market/local-package-upload-finish"(
            request: LocalPackageUploadFinishRequest,
        ): Promise<LocalPackageUploadPreview>;
        "market/local-package-upload-commit"(
            uploadId: string,
        ): Promise<LocalPackageUploadCommitResult>;
        "market/local-package-upload-cancel"(uploadId: string): Promise<boolean>;
        "market/prepare-local-binding"(name: string): Promise<LocalBindingResult>;
        "market/environment-snapshots"(): Promise<EnvironmentSnapshotSummary[]>;
        "market/environment-snapshot-preview"(
            id: string,
        ): Promise<EnvironmentSnapshotPreview | undefined>;
        "market/environment-snapshot-apply"(id: string, options?: InstallOptions): Promise<number>;
        "market/remove-bundle-configs"(
            request: BundleConfigRemoveRequest,
        ): Promise<BundleConfigRemoveResult>;
        "market/update-config"(patch: Partial<Config>): Promise<boolean>;
        "market/update-data"(
            patch: Partial<MarketDataStorePayload>,
        ): Promise<MarketDataStorePayload>;
        "market/package"(name: string): Promise<Registry | undefined>;
        "market/registry"(
            names: string[],
        ): Promise<Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>>;
        "market/ensure-config"(name: string): Promise<boolean>;
        "market/avatar"(key: string, url?: string): Promise<AvatarFetchResult | undefined>;
    }
}

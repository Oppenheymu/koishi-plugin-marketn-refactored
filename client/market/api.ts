import { send } from "@koishijs/client";
import type {
    MarketLookupRequest,
    MarketLookupResult,
    MarketSnapshotRequest,
    MarketSnapshotResponse,
} from "../../src/shared/types";

// Keep Console transport details out of market state and feature modules.
export function requestMarketIndex(request: MarketSnapshotRequest) {
    return send("market/index", request) as Promise<MarketSnapshotResponse> | undefined;
}

export function requestMarketLookup(request: MarketLookupRequest) {
    return send("market/lookup", request) as Promise<MarketLookupResult> | undefined;
}

export function requestMarketPackage(name: string) {
    return send("market/package", name);
}

export function requestMarketRegistry(names: string[]) {
    return send("market/registry", names);
}

export function requestEnvironmentSnapshots() {
    return send("market/environment-snapshots");
}

export function requestEnvironmentSnapshotPreview(id: string) {
    return send("market/environment-snapshot-preview", id);
}

export function requestInstallFallbackCandidate(failedEndpoint?: string) {
    return send("market/install-fallback-candidate", failedEndpoint);
}

export function requestEnsureConfig(name: string) {
    return send("market/ensure-config", name);
}

export function requestEnvironmentSnapshotApply(
    id: string,
    options: { installEndpoint?: string },
) {
    return send("market/environment-snapshot-apply", id, options);
}

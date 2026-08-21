import { send } from "@koishijs/client";
import type {
    MarketLookupRequest,
    MarketLookupResult,
    MarketSnapshotRequest,
    MarketSnapshotResponse,
} from "../../src/shared/types";

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

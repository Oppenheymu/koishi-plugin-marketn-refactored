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

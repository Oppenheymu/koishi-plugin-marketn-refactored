import { collectServiceProviders } from "../../shared/lookup.js";
import type { MarketLookupRequest, MarketLookupResult } from "../../shared/types.js";
import type { MarketProvider } from "../market/index.js";

function normalizeMarketLookupValues(values: unknown, limit: number) {
    if (!Array.isArray(values)) return [];
    return Array.from(
        new Set(
            values
                .filter((value): value is string => typeof value === "string")
                .map((value) => value.trim())
                .filter((value) => value && value.length <= 214),
        ),
    ).slice(0, limit);
}

/** market/lookup：按名称/服务检索市场数据（provider 快照过滤）。 */
export async function lookupMarket(
    provider: MarketProvider | undefined,
    request: MarketLookupRequest = {},
): Promise<MarketLookupResult> {
    if (!request || typeof request !== "object") request = {};
    const names = normalizeMarketLookupValues(request.names, 512);
    const services = normalizeMarketLookupValues(request.services, 128);
    const result: MarketLookupResult = {
        data: {},
        services: Object.fromEntries(services.map((name) => [name, []])),
    };
    if (!provider || (!names.length && !services.length)) return result;

    const snapshot = await provider.getSnapshot();
    const data = snapshot?.data ?? {};
    result.dataVersion = snapshot?.dataVersion;
    for (const name of names) {
        if (data[name]) result.data[name] = data[name];
    }
    if (services.length) {
        result.services = collectServiceProviders(data, services);
    }
    return result;
}

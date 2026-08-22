/**
 * @file market/lookup RPC 的服务端:按名称/服务在市场快照里查插件。
 *
 * 模块职责:对 market 快照(provider.getSnapshot)做过滤式查询,返回命中的
 * 插件数据与"服务 -> 提供者列表"映射,供前端服务市场页等轻量查询使用
 * (不必拉全量快照)。
 *
 * 关键设计:请求参数先归一化(去重/trim/长度上限/条数上限),防御超大或
 * 脏输入;快照不存在时返回空结果而非报错。
 *
 * 架构位置:node 适配层 console 模块,由 listeners/market.ts 注册为
 * market/lookup listener;服务归类逻辑在 shared/lookup.ts 纯函数。
 */
import { collectServiceProviders } from "../../shared/lookup.js";
import type { MarketLookupRequest, MarketLookupResult } from "../../shared/types.js";
import type { MarketProvider } from "../market/index.js";

/**
 * 归一化请求值数组:只留非空字符串(trim)、长度 <= 214(npm 包名上限)、
 * 去重后截断到 limit(names 512 / services 128)。
 */
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
    result.revision = snapshot?.revision;
    result.dataVersion = snapshot?.dataVersion;
    for (const name of names) {
        if (data[name]) result.data[name] = data[name];
    }
    if (services.length) {
        result.services = collectServiceProviders(data, services);
    }
    return result;
}

/**
 * @file 头像抓取入口:内存 -> 磁盘 -> 网络的三级取用与 SSRF/尺寸防线。
 *
 * 模块职责:
 * - fetchAvatar:按归一化键取头像,命中内存/磁盘缓存直接返回,否则经
 *   SSRF 校验 + HEAD 预检 + 限流读取后抓取,并双写两级缓存;
 * - 转发 disk-cache 的清理/清空能力,作为 avatar 模块的对外门面。
 *
 * 关键设计:
 * - 重定向手动跟随(redirect: "manual"),每一跳都重新过 isBlockedAvatarTarget,
 *   防止"公网 URL 302 到内网地址"的绕过;跳数上限 AVATAR_MAX_REDIRECTS;
 * - HEAD 预检(1.2s 超时)先行拦截超大 Content-Length 与危险目标,GET
 *  本体再限 96KB / 3s;HEAD 失败不阻断,降级为直接 GET;
 * - 拒绝时主动 cancel 流(body 是 stream),避免连接悬挂。
 *
 * 架构位置:node 适配层 avatar 模块,由 console listener market/avatar 调用,
 * 供前端展示插件作者头像(gravatar/cravatar/npm)。
 */
import type { Context, HTTP } from "koishi";
import {
    AVATAR_CACHE_SWEEP_INTERVAL,
    type AvatarFetchResult,
    cacheAvatarMemory,
    cleanupAvatarCache,
    cleanupAvatarCaches,
    clearAvatarCacheStorage,
    clearAvatarMemoryCache,
    getAvatarMemoryCache,
    normalizeAvatarCacheKey,
    readAvatarDiskCache,
    writeAvatarDiskCache,
} from "./disk-cache.js";
import { isAvatarDefaultResponse, isBlockedAvatarTarget } from "./ssrf.js";

export {
    AVATAR_CACHE_SWEEP_INTERVAL,
    type AvatarFetchResult,
    cleanupAvatarCaches,
    clearAvatarCacheStorage,
    clearAvatarMemoryCache,
};

/** 头像体积上限:96KB,超过即取消下载(base64 后约 128KB,仍是可控负载)。 */
const AVATAR_MAX_SIZE = 96 * 1024;
/** GET 超时:头像属于锦上添花,超时直接放弃。 */
const AVATAR_FETCH_TIMEOUT = 3000;
/** HEAD 预检超时:比 GET 更短,预检慢就降级跳过。 */
const AVATAR_HEAD_TIMEOUT = 1200;
/** 重定向上限:跟随 3 跳,防重定向环。 */
const AVATAR_MAX_REDIRECTS = 3;
/** Accept 头:优先现代图片格式,svg 降权,其余任意类型兜底。 */
const AVATAR_ACCEPT =
    "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.1";

/**
 * 抓取头像:内存缓存 -> 磁盘缓存 -> 网络。返回 base64 数据与 MIME 类型,
 * 任何校验不通过(协议非 http(s)、SSRF 命中、HEAD 拦截、响应异常)都返回
 * undefined 而非抛错。网络命中后双写内存与磁盘缓存;sourceUrl 记录最终
 * 命中的重定向地址,供磁盘缓存回读时做"默认占位图"判定。
 */
export async function fetchAvatar(
    ctx: Context,
    rawKey: string,
    rawUrl?: string,
): Promise<AvatarFetchResult | undefined> {
    const cacheKey = normalizeAvatarCacheKey(rawKey);
    // 每次取用顺手清扫:过期/超限条目即时淘汰,不依赖宿主定时器
    cleanupAvatarCache();
    const cached = getAvatarMemoryCache(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return { data: cached.data, type: cached.type, cached: true };
    }
    const diskCached = await readAvatarDiskCache(ctx, cacheKey);
    // 磁盘也未命中且没有来源 URL 时无从抓取,到此为止
    if (diskCached || !rawUrl) return diskCached;

    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        return;
    }
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (await isBlockedAvatarTarget(url)) return;

    const checked = await checkAvatarHead(ctx, url);
    if (checked.blocked) return;
    const fetched = await fetchAvatarResponse(ctx, checked.url ?? url);
    if (!fetched) return;
    const { response, sourceUrl } = fetched;
    const result = await readAvatarResponse(response);
    if (!result) return;
    cacheAvatarMemory(cacheKey, result);
    // 磁盘写不阻塞返回:命中路径的收益不值得等一次 fs
    void writeAvatarDiskCache(ctx, cacheKey, sourceUrl, result);
    cleanupAvatarCache();
    return result;
}

/**
 * 校验并消费 GET 响应:状态 >= 400、非 image/* Content-Type、Content-Length
 * 超限、或响应头标识为 gravatar 默认占位图的,取消流并返回 undefined;
 * 通过则限流读完 body,转 base64 返回。
 */
async function readAvatarResponse(response: HTTP.Response<AvatarBodyStream>) {
    if (response.status >= 400) return cancelAndDiscard(response.data);
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!type.startsWith("image/")) return cancelAndDiscard(response.data);
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > AVATAR_MAX_SIZE) return cancelAndDiscard(response.data);
    if (isAvatarDefaultResponse(response.headers)) return cancelAndDiscard(response.data);
    const body = await readLimitedAvatarBody(response.data);
    if (!body?.byteLength) return;
    return { type, data: body.toString("base64") } satisfies AvatarFetchResult;
}

/** 拒绝路径统一收口:先 cancel 流再返回 undefined(不 cancel 会悬挂连接)。 */
async function cancelAndDiscard(stream: AvatarBodyStream) {
    await cancelAvatarBody(stream);
    return undefined;
}

/**
 * HEAD 预检:逐跳过 SSRF 校验后发 HEAD(手动重定向),提前拿到最终 URL、
 * 拦截超大 Content-Length 与危险目标。HEAD 抛错(如目标不支持)不阻断,
 * 返回当前 URL 降级为直接 GET。
 */
async function checkAvatarHead(ctx: Context, url: URL): Promise<{ url?: URL; blocked?: boolean }> {
    let current = url;
    for (let index = 0; index <= AVATAR_MAX_REDIRECTS; index++) {
        if (await isBlockedAvatarTarget(current)) return { blocked: true };
        try {
            const head = await ctx.http("HEAD", current.toString(), {
                timeout: AVATAR_HEAD_TIMEOUT,
                redirect: "manual",
                validateStatus: (status) => status >= 200 && status < 600,
                headers: { accept: AVATAR_ACCEPT },
            });
            if (isAvatarRedirect(head.status)) {
                const next = await resolveAvatarRedirect(current, head.headers.get("location"));
                if (!next) return { blocked: true };
                current = next;
                continue;
            }
            const headLength = Number(head.headers.get("content-length"));
            if (Number.isFinite(headLength) && headLength > AVATAR_MAX_SIZE)
                return { blocked: true };
            return { url: current };
        } catch (error) {
            ctx.logger("market").debug(
                `avatar HEAD skipped: url=${current}, error=${error instanceof Error ? error.message : error}`,
            );
            return { url: current };
        }
    }
    return { blocked: true };
}

/** GET 响应的 body 流类型(koishi HTTP responseType: "stream")。 */
type AvatarBodyStream = HTTP.ResponseTypes["stream"];

/**
 * 发起 GET(手动重定向):每一跳先过 SSRF 校验,3xx 则取消当前流、解析
 * Location 后继续下一跳;非 3xx 返回响应与最终命中的 sourceUrl。全部
 * 校验通过前的返回都交由调用方判定 body。
 */
async function fetchAvatarResponse(
    ctx: Context,
    url: URL,
): Promise<{ response: HTTP.Response<AvatarBodyStream>; sourceUrl: string } | undefined> {
    let current = url;
    for (let index = 0; index <= AVATAR_MAX_REDIRECTS; index++) {
        if (await isBlockedAvatarTarget(current)) return;
        const response = await ctx.http(current.toString(), {
            timeout: AVATAR_FETCH_TIMEOUT,
            responseType: "stream",
            redirect: "manual",
            validateStatus: (status) => status >= 200 && status < 600,
            headers: { accept: AVATAR_ACCEPT },
        });
        if (!isAvatarRedirect(response.status)) return { response, sourceUrl: current.toString() };
        await cancelAvatarBody(response.data);
        const next = await resolveAvatarRedirect(current, response.headers.get("location"));
        if (!next) return;
        current = next;
    }
    return undefined;
}

/** 是否为需要手动跟随的 3xx 重定向状态码。 */
function isAvatarRedirect(status: number) {
    return status >= 300 && status < 400;
}

/**
 * 解析重定向目标:Location 相对 base 解析,协议限定 http(s),并立即对
 * 新目标做 SSRF 校验。任一不满足返回 undefined(调用方视为终止)。
 */
async function resolveAvatarRedirect(base: URL, location: string | null) {
    if (!location) return;
    let next: URL;
    try {
        next = new URL(location, base);
    } catch {
        return;
    }
    if (!["http:", "https:"].includes(next.protocol)) return;
    if (await isBlockedAvatarTarget(next)) return;
    return next;
}

/**
 * 限流读取 body:逐 chunk 累计字节数,超过 AVATAR_MAX_SIZE 立即 cancel
 * 并放弃(Content-Length 头可伪造,必须在流上实测兜底)。
 */
async function readLimitedAvatarBody(stream: AvatarBodyStream) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            size += value.byteLength;
            if (size > AVATAR_MAX_SIZE) {
                await reader.cancel().catch(() => {});
                return;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(
        chunks.map((chunk) => Buffer.from(chunk)),
        size,
    );
}

/** 取消响应 body 流(拒绝路径统一调用,防连接悬挂;流可选/取消可选)。 */
async function cancelAvatarBody(stream?: AvatarBodyStream) {
    await stream?.cancel?.().catch(() => {});
}

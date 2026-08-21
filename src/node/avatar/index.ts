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

const AVATAR_MAX_SIZE = 96 * 1024;
const AVATAR_FETCH_TIMEOUT = 3000;
const AVATAR_HEAD_TIMEOUT = 1200;
const AVATAR_MAX_REDIRECTS = 3;
const AVATAR_ACCEPT =
    "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml;q=0.8,*/*;q=0.1";

export async function fetchAvatar(
    ctx: Context,
    rawKey: string,
    rawUrl?: string,
): Promise<AvatarFetchResult | undefined> {
    const cacheKey = normalizeAvatarCacheKey(rawKey);
    cleanupAvatarCache();
    const cached = getAvatarMemoryCache(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return { data: cached.data, type: cached.type, cached: true };
    }
    const diskCached = await readAvatarDiskCache(ctx, cacheKey);
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
    if (response.status >= 400) {
        await cancelAvatarBody(response.data);
        return;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!type.startsWith("image/")) {
        await cancelAvatarBody(response.data);
        return;
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > AVATAR_MAX_SIZE) {
        await cancelAvatarBody(response.data);
        return;
    }
    if (isAvatarDefaultResponse(response.headers)) {
        await cancelAvatarBody(response.data);
        return;
    }
    const body = await readLimitedAvatarBody(response.data);
    if (!body?.byteLength) return;

    const result: AvatarFetchResult = {
        type,
        data: body.toString("base64"),
    };
    cacheAvatarMemory(cacheKey, result);
    void writeAvatarDiskCache(ctx, cacheKey, sourceUrl, result);
    cleanupAvatarCache();
    return result;
}

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

type AvatarBodyStream = HTTP.ResponseTypes["stream"];

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

function isAvatarRedirect(status: number) {
    return status >= 300 && status < 400;
}

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

async function cancelAvatarBody(stream?: AvatarBodyStream) {
    await stream?.cancel?.().catch(() => {});
}

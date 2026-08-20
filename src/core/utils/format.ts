export function formatError(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

export function formatStack(error: unknown) {
    if (error instanceof Error) return error.stack || error.message;
    return String(error);
}

export function shortHash(hash?: string) {
    return hash?.slice(0, 12);
}

export function formatTime(value?: number) {
    if (!value) return "-";
    return new Date(value).toISOString();
}

export function formatAge(age?: number) {
    if (age == null || !Number.isFinite(age)) return "-";
    if (age < 1000) return `${Math.max(0, Math.round(age))}ms`;
    if (age < 60_000) return `${Math.round(age / 1000)}s`;
    if (age < 3_600_000) return `${Math.round(age / 60_000)}m`;
    if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h`;
    return `${Math.round(age / 86_400_000)}d`;
}

export function formatBytes(value?: number) {
    if (value == null || !Number.isFinite(value)) return "-";
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)}MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
    return `${Math.round(value)}B`;
}

export function parseContentLength(value?: string | null) {
    if (!value) return undefined;
    const size = Number(value);
    return Number.isFinite(size) && size >= 0 ? size : undefined;
}

export function normalizeWireSize(wireSize: number | undefined, decodedSize: number) {
    if (!wireSize && decodedSize > 0) return undefined;
    return wireSize;
}

export function formatTimings(timings: Record<string, number> = {}) {
    return Object.entries(timings)
        .map(([key, value]) => `${key}=${Math.round(value)}ms`)
        .join(", ");
}

export function formatEndpointHost(endpoint: string) {
    try {
        return new URL(endpoint).host;
    } catch {
        return endpoint;
    }
}

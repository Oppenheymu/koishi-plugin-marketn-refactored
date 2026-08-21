import type { Context } from "koishi";

export type ConsoleRefreshChannel =
    | "dependencies"
    | "registry"
    | "registryStatus"
    | "packages"
    | "config"
    | "market";

export function refreshConsole(ctx: Context, channels: readonly ConsoleRefreshChannel[]) {
    return Promise.all(channels.map((channel) => ctx.get("console")?.refresh(channel)));
}

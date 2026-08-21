import type { Context } from "koishi";
import { assertContract, type ContractName } from "../contracts.js";

export type ConsoleRefreshChannel = "dependencies" | "registry" | "packages" | "config";

export function refreshConsole(ctx: Context, channels: readonly ConsoleRefreshChannel[]) {
    return Promise.all(channels.map((channel) => ctx.get("console")?.refresh(channel)));
}

export function registerContractListener(
    ctx: Context,
    name: ContractName,
    handler: (...args: never[]) => unknown,
) {
    ctx.console.addListener(
        name,
        async (...args: never[]) => {
            assertContract(name, ...args);
            return handler(...args) as never;
        },
        { authority: 4 },
    );
}

import type { Context } from "koishi";
import { assertContract, type ContractName } from "../contracts.js";

export { refreshConsole } from "../refresh.js";

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

/** 批量注册无额外编排的转发 listener；复杂流程应继续使用显式注册。 */
export function registerContractListeners(
    ctx: Context,
    entries: Partial<Record<ContractName, (...args: never[]) => unknown>>,
) {
    for (const [name, handler] of Object.entries(entries)) {
        if (handler) registerContractListener(ctx, name as ContractName, handler);
    }
}

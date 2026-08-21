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

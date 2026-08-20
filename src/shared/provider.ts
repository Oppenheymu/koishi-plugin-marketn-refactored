import { DataService } from "@koishijs/console";
import type { SearchResult } from "@koishijs/registry";
import { type Context, Logger } from "koishi";
import type {
    MarketLookupRequest,
    MarketLookupResult,
    MarketPayload,
    MarketSnapshotRequest,
    MarketSnapshotResponse,
} from "./types.js";

declare module "@koishijs/console" {
    interface Events {
        "market/refresh"(): Promise<void>;
        "market/refresh-dependencies"(): Promise<void>;
        "market/index"(request?: MarketSnapshotRequest): Promise<MarketSnapshotResponse>;
        "market/lookup"(request: MarketLookupRequest): Promise<MarketLookupResult>;
    }

    namespace Console {
        interface Services {
            market: MarketProvider;
        }
    }
}

const logger = new Logger("market");

/** 市场数据服务的抽象基类：node 端（多端点竞速）与其他实现共用通道协议。 */
export abstract class MarketProvider extends DataService<MarketPayload> {
    protected _task: Promise<SearchResult | undefined> | undefined;
    protected _error: unknown;

    constructor(ctx: Context) {
        super(ctx, "market", { authority: 4 });

        ctx.console.addListener(
            "market/refresh",
            async () => {
                await this.start(true);
            },
            { authority: 4 },
        );
    }

    override async start(_refresh = false): Promise<void> {
        this._task = undefined;
        this._error = undefined;
        await this.refresh();
    }

    abstract collect(): Promise<SearchResult | undefined>;
    abstract getSnapshot(): Promise<MarketPayload>;
    probeInBackground?(reason?: string): Promise<boolean>;

    async prepare(): Promise<SearchResult | undefined> {
        this._task ??= this.collect().catch((error: unknown) => {
            if ((error as Error | undefined)?.message !== "market provider disposed")
                logger.warn(error);
            this._error = error;
            this._task = undefined;
            return undefined;
        });
        return this._task;
    }
}

export namespace MarketProvider {
    export type Payload = MarketPayload;
}

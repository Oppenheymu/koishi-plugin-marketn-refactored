import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip as gzipCallback } from "node:zlib";
import type { Context } from "koishi";
import type { MarketPayload, MarketSnapshotTransfer } from "../shared/types.js";

const gzip = promisify(gzipCallback);
const MAX_MARKET_SNAPSHOTS = 6;

interface EncodedMarketSnapshot {
    id: string;
    body: Buffer;
    decodedSize: number;
    encodedSize: number;
}

/**
 * gzip 市场快照传输：market/index 的 http-gzip transport 走 HTTP 路由下发，
 * ETag = 内容 hash，Cache-Control immutable。
 */
export class MarketSnapshotTransport {
    private tasks = new Map<string, Promise<EncodedMarketSnapshot>>();
    private entries = new Map<string, EncodedMarketSnapshot>();

    private readonly ctx: Context;
    private readonly route: string;

    constructor(ctx: Context, route: string) {
        this.ctx = ctx;
        this.route = route;
    }

    async create(snapshot: MarketPayload): Promise<MarketSnapshotTransfer> {
        const data = snapshot.data ?? {};
        const json = JSON.stringify(data);
        const id = createHash("sha256").update(json).digest("hex");
        let entry = this.entries.get(id);
        if (!entry) {
            let task = this.tasks.get(id);
            if (!task) {
                task = this.encode(id, json).finally(() => this.tasks.delete(id));
                this.tasks.set(id, task);
            }
            entry = await task;
        }
        const { data: _, ...payload } = snapshot;
        return {
            transport: "http-gzip",
            url: `${this.route}/${entry.id}`,
            payload,
            decodedSize: entry.decodedSize,
            encodedSize: entry.encodedSize,
        };
    }

    get(id: string) {
        return this.entries.get(id);
    }

    clear() {
        this.tasks.clear();
        this.entries.clear();
    }

    private async encode(id: string, json: string) {
        const start = Date.now();
        const decodedSize = Buffer.byteLength(json);
        const body = (await gzip(Buffer.from(json), { level: 6 })) as Buffer;
        const entry = { id, body, decodedSize, encodedSize: body.length };
        this.entries.set(id, entry);
        while (this.entries.size > MAX_MARKET_SNAPSHOTS) {
            const oldest = this.entries.keys().next().value;
            if (!oldest) break;
            this.entries.delete(oldest);
        }
        this.ctx
            .logger("market")
            .debug(
                `prepared console market snapshot: id=${id}, decoded=${decodedSize}, gzip=${body.length}, elapsed=${Date.now() - start}ms`,
            );
        return entry;
    }
}

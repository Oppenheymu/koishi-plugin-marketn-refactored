import type { RequestScope } from "../../racing/request-scope.js";
import { formatError } from "../../utils/format.js";
import { formatSnapshot } from "../format.js";
import type { EndpointResult } from "../types.js";
import { performanceFrom } from "./host.js";

/** 后台刷新/探测编排所需的源视图（MarketIndexSource 结构性子集）。 */
export interface MarketBackgroundSource {
    readonly scope: RequestScope;
    readonly scanner: { total: number };
    readonly log: {
        debug(message: string): void;
        info(message: string): void;
        warn(message: string): void;
    };
    backgroundTask: Promise<void> | undefined;
    backgroundSerial: number | undefined;
    collectError: unknown;
    hasCurrentData(): boolean;
    fetchAndApply(
        serial: number,
        phase: "initial" | "refresh",
    ): Promise<EndpointResult | undefined>;
    notifyRefresh(): unknown;
    resetProbeState(): void;
}

/**
 * 市场索引后台刷新/探测编排。
 * 成块移植自旧 MarketProvider 的 refreshInBackground/probeInBackground 系列方法。
 */
export class MarketBackgroundRefresher {
    private readonly source: MarketBackgroundSource;

    constructor(source: MarketBackgroundSource) {
        this.source = source;
    }

    refreshInBackground(serial: number, reason = "background") {
        const source = this.source;
        if (source.backgroundTask && source.backgroundSerial === serial) return false;
        const task = this.refreshIndexInBackground(serial).finally(() => {
            if (source.backgroundTask !== task) return;
            source.backgroundTask = undefined;
            source.backgroundSerial = undefined;
            void source.notifyRefresh();
        });
        source.backgroundTask = task;
        source.backgroundSerial = serial;
        void reason;
        return true;
    }

    async probeInBackground(reason = "idle probe"): Promise<boolean> {
        const source = this.source;
        if (source.scope.isDisposed) return false;
        if (source.backgroundTask) {
            await source.backgroundTask;
            return true;
        }
        if (!source.hasCurrentData()) {
            const serial = source.scope.current + 1;
            source.scope.advance(`${reason} market probe superseded`);
            return this.probeIndexInBackground(serial, reason);
        }
        const serial = source.scope.current;
        if (this.refreshInBackground(serial, reason)) {
            void source.notifyRefresh();
            await source.backgroundTask;
            return true;
        }
        return false;
    }

    private async refreshIndexInBackground(serial: number) {
        const source = this.source;
        const start = Date.now();
        try {
            const result = await source.fetchAndApply(serial, "refresh");
            if (source.scope.isStale(serial) || !result) return;
            await source.notifyRefresh();
            source.log.info(
                `background market refresh completed: ${formatSnapshot(performanceFrom(result, source.scanner.total))}, elapsed=${Date.now() - start}ms`,
            );
        } catch (error) {
            if (source.scope.isStale(serial)) return;
            source.collectError = error;
            await source.notifyRefresh();
            source.log.warn(
                `background market refresh failed in ${Date.now() - start}ms: ${formatError(error)}`,
            );
        }
    }

    private async probeIndexInBackground(serial: number, reason: string): Promise<boolean> {
        const source = this.source;
        const start = Date.now();
        source.resetProbeState();
        try {
            const result = await source.fetchAndApply(serial, "refresh");
            if (source.scope.isStale(serial)) return false;
            if (!result) return false;
            await source.notifyRefresh();
            source.log.info(`${reason} market probe completed, elapsed=${Date.now() - start}ms`);
            return true;
        } catch (error) {
            if (source.scope.isStale(serial)) return false;
            source.collectError = error;
            await source.notifyRefresh();
            source.log.warn(
                `${reason} market probe failed in ${Date.now() - start}ms: ${formatError(error)}`,
            );
            return false;
        }
    }
}

import { type Context, Time } from "koishi";
import type { Config } from "../config/index.js";

/** 空闲后台探测：Console 无连接且满足 boot/delay/interval 门控时刷新依赖与市场数据。 */
export function setupIdleProbe(ctx: Context, config: Config) {
    if (config.idleProbe === false) return;

    const logger = ctx.logger("market");
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let lastProbe = 0;
    let lastFailure = 0;

    const getClientCount = () => {
        const clients = ctx.console.clients as unknown;
        if (!clients) return 0;
        return Object.keys(clients).length;
    };
    const clearIdleTimer = () => {
        clearTimeout(timer);
        timer = undefined;
    };
    const getDelay = () => Math.max(0, config.idleProbeDelay ?? Time.minute * 5);
    const getBootDelay = () => Math.max(0, config.idleProbeBootDelay ?? Time.minute);
    const getInterval = () => Math.max(0, config.idleProbeInterval ?? Time.hour * 6);

    const schedule = (delay = getDelay()) => {
        clearIdleTimer();
        if (!ctx.scope.isActive || config.idleProbe === false) return;
        if (getClientCount()) return;
        timer = setTimeout(() => void runProbe(), Math.max(0, delay));
        logger.debug(`idle background probe scheduled: delay=${Math.max(0, delay)}ms`);
    };

    /** 计算需要延后调度的时间：boot 延迟 / 失败重试间隔 / 成功间隔，无需延后时返回 undefined。 */
    const getProbeWait = (): number | undefined => {
        const bootWait = getBootDelay() - (Date.now() - startedAt);
        if (bootWait > 0) return bootWait;
        const retryWait = lastFailure
            ? Math.min(Time.minute * 5, getInterval()) - (Date.now() - lastFailure)
            : 0;
        if (!lastProbe && retryWait > 0) return retryWait;
        const intervalWait = lastProbe ? getInterval() - (Date.now() - lastProbe) : 0;
        if (intervalWait > 0) return intervalWait;
        return undefined;
    };

    const runProbeTasks = async (): Promise<{ succeeded: boolean; reason?: unknown }> => {
        const [depsResult, marketResult] = await Promise.allSettled([
            ctx.installer.probeDependenciesInBackground("idle").then(() => true),
            ctx.console.services.market?.probeInBackground?.("idle probe") ??
                Promise.resolve(false),
        ]);
        const succeeded =
            (depsResult.status === "fulfilled" && depsResult.value === true) ||
            (marketResult.status === "fulfilled" && marketResult.value !== false);
        if (succeeded) return { succeeded };
        const reason =
            depsResult.status === "rejected"
                ? depsResult.reason
                : marketResult.status === "rejected"
                  ? marketResult.reason
                  : "no probe result";
        return { succeeded, reason };
    };

    const handleProbeOutcome = (
        outcome: { succeeded: boolean; reason?: unknown },
        probeStartedAt: number,
    ) => {
        if (outcome.succeeded) {
            lastProbe = Date.now();
            lastFailure = 0;
            logger.info(
                `idle background probe completed: elapsed=${Date.now() - probeStartedAt}ms`,
            );
        } else {
            lastFailure = Date.now();
            logger.warn(
                `idle background probe failed: ${outcome.reason instanceof Error ? outcome.reason.message : outcome.reason}`,
            );
        }
    };

    const runProbe = async () => {
        clearIdleTimer();
        if (!ctx.scope.isActive) return;
        if (getClientCount()) return;
        if (ctx.installer.isInstalling) {
            logger.debug("skip idle background probe because dependency install is active");
            schedule(getDelay());
            return;
        }
        const wait = getProbeWait();
        if (wait !== undefined) {
            schedule(wait);
            return;
        }
        if (running) return;

        running = true;
        const probeStartedAt = Date.now();
        try {
            handleProbeOutcome(await runProbeTasks(), probeStartedAt);
        } catch (error) {
            lastFailure = Date.now();
            logger.warn(
                `idle background probe failed: ${error instanceof Error ? error.message : error}`,
            );
        } finally {
            running = false;
            if (!getClientCount())
                schedule(lastProbe ? getInterval() : Math.min(Time.minute * 5, getInterval()));
        }
    };

    ctx.on("console/connection", () => {
        if (getClientCount()) {
            clearIdleTimer();
            logger.debug(`idle background probe cancelled: clients=${getClientCount()}`);
        } else {
            schedule();
        }
    });

    ctx.on("ready", () => {
        if (!getClientCount()) schedule(Math.max(getDelay(), getBootDelay()));
    });

    ctx.effect(() => () => clearIdleTimer());
}

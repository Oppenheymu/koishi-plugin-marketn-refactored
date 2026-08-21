import type { InstallLogger } from "../types.js";

/** 安装串行锁：保证同一时刻只有一个安装/环境恢复在跑，其余排队。 */
export class InstallQueue {
    private installTask = Promise.resolve();
    private installActive = false;
    private readonly log: InstallLogger;

    constructor(log: InstallLogger) {
        this.log = log;
    }

    get isInstalling() {
        return this.installActive;
    }

    async withLock<T>(description: string, callback: () => Promise<T>): Promise<T> {
        const previous = this.installTask;
        let release: () => void = () => {};
        this.installTask = new Promise<void>((resolve) => {
            release = resolve;
        });
        if (this.installActive) this.log.info(`dependency install queued: ${description}`);
        await previous;
        this.installActive = true;
        try {
            return await callback();
        } finally {
            this.installActive = false;
            release();
        }
    }
}

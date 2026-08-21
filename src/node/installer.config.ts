import { Schema, Time } from "koishi";

export interface InstallerGetDepsOptions {
    metadata?: boolean;
    background?: boolean;
}

export interface InstallerConfig {
    endpoint?: string;
    timeout?: number;
    autoRoute?: boolean;
    retry?: number;
    concurrency?: number;
    installLogRetentionHours?: number;
    /** @deprecated use installLogRetentionHours */
    installLogRetention?: number;
}

export const InstallerConfig: Schema<InstallerConfig> = Schema.object({
    endpoint: Schema.string().role("link"),
    timeout: Schema.number()
        .role("time")
        .default(Time.second * 5),
    autoRoute: Schema.boolean().default(true),
    retry: Schema.number().min(0).max(5).step(1).default(1),
    concurrency: Schema.number().min(1).max(16).step(1).default(4),
    installLogRetentionHours: Schema.number()
        .min(1)
        .max(24 * 365)
        .step(1)
        .default(72),
});

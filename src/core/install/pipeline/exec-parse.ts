export interface YarnLog {
    type: "warning" | "info" | "error" | string;
    name: number | null;
    displayName: string;
    indent?: string | undefined;
    data: string;
}

const levelMap: Record<string, "info" | "debug" | "warn"> = {
    info: "info",
    warning: "debug",
    error: "warn",
};

/** yarn berry --json 日志类型 → logger 级别。 */
export function yarnLogLevel(type: string): "info" | "debug" | "warn" {
    return levelMap[type] ?? "info";
}

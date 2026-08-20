import { execa } from "execa";
import { type YarnLog, yarnLogLevel } from "./exec-parse.js";
import type { InstallLogger } from "./types.js";

export interface PackageManagerAgent {
    name: string;
    version?: string | undefined;
}

export interface RunPackageManagerDeps {
    cwd: string;
    agent: PackageManagerAgent | undefined;
    log: InstallLogger;
    emitLog: (type: "stdout" | "stderr", line: string) => void;
}

/** 运行包管理器并逐行转发 stdout/stderr（yarn berry 走 --json 解析）。 */
export async function runPackageManager(
    args: string[],
    deps: RunPackageManagerDeps,
): Promise<number> {
    const { log, emitLog } = deps;
    const agent = deps.agent;
    const name = agent?.name ?? "npm";
    const useJson = name === "yarn" && (agent?.version ?? "") >= "2";
    if (name !== "yarn") args.unshift("install");
    const start = Date.now();
    const agentLabel = agent ? `${name}@${agent.version ?? ""}` : name;
    log.info(
        `run package manager: agent=${agentLabel}, args=${args.join(" ") || "(none)"}, cwd=${deps.cwd}, json=${useJson}`,
    );
    if (useJson) args.push("--json");

    let stderr = "";
    let stdout = "";
    let settled = false;

    return new Promise<number>((resolve) => {
        const subprocess = execa(name, args, { cwd: deps.cwd, reject: false });
        emitLog("stdout", `package manager started: agent=${agentLabel}`);

        const emitStdoutLine = (line: string) => {
            if (!line) return;
            if (!useJson || line[0] !== "{") {
                log.info(line);
                emitLog("stdout", line);
                return;
            }
            try {
                const parsed = JSON.parse(line) as YarnLog;
                const level = yarnLogLevel(parsed.type);
                if (level === "debug") log.debug(parsed.data);
                else if (level === "warn") log.warn(parsed.data);
                else log.info(parsed.data);
                emitLog("stdout", parsed.data);
            } catch (error) {
                log.warn(line);
                log.warn(error);
                emitLog("stderr", line);
            }
        };

        const flushBuffers = () => {
            if (stderr) {
                log.warn(stderr);
                emitLog("stderr", stderr);
                stderr = "";
            }
            if (stdout) {
                emitStdoutLine(stdout);
                stdout = "";
            }
        };

        const settle = (code: number) => {
            if (settled) return;
            settled = true;
            flushBuffers();
            resolve(code);
        };

        subprocess.stderr.on("data", (data) => {
            stderr += data.toString();
            const lines = stderr.split("\n");
            stderr = lines.pop()!;
            for (const line of lines) {
                log.warn(line);
                emitLog("stderr", line);
            }
        });

        subprocess.stdout.on("data", (data) => {
            stdout += data.toString();
            const lines = stdout.split("\n");
            stdout = lines.pop()!;
            for (const line of lines) emitStdoutLine(line);
        });

        subprocess.then(
            (result) => {
                const code = result.exitCode;
                const signal = result.signal;
                log.info(
                    `package manager exited: code=${code}, signal=${signal ?? "-"}, elapsed=${Date.now() - start}ms`,
                );
                if (code == null) {
                    const message = signal
                        ? `package manager terminated by signal ${signal}`
                        : "package manager exited without an exit code";
                    emitLog("stderr", message);
                    settle(-1);
                    return;
                }
                emitLog(
                    code ? "stderr" : "stdout",
                    code
                        ? `package manager exited with code ${code}`
                        : "package manager finished successfully",
                );
                settle(code);
            },
            (error) => {
                log.warn(
                    `package manager failed to start: ${error instanceof Error ? error.message : String(error)}`,
                );
                emitLog(
                    "stderr",
                    `package manager failed to start: ${error instanceof Error ? error.message : String(error)}`,
                );
                settle(-1);
            },
        );
    });
}

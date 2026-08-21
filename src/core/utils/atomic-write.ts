import { promises as fsp } from "node:fs";
import { dirname } from "node:path";

export interface AtomicJsonOptions {
    indent?: number;
    newline?: boolean;
}

/** 写入同目录临时文件后替换目标，避免进程中断留下半份 JSON。 */
export async function writeJsonAtomic<T>(file: string, value: T, options: AtomicJsonOptions = {}) {
    await fsp.mkdir(dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    const serialized = JSON.stringify(value, null, options.indent);
    await fsp.writeFile(temporary, options.newline === false ? serialized : `${serialized}\n`);
    try {
        await fsp.rename(temporary, file);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== "EEXIST" && code !== "EPERM") throw error;
        await fsp.rm(file, { force: true });
        await fsp.rename(temporary, file);
    }
}

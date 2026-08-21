// 从 src/node/locales/{zh-CN,en-US}/{message,schema}.yml 生成 src/node/locales/generated.ts
// （node 端类型化文案）。挂在 build / test / check 前运行。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { load } from "js-yaml";

const root = resolve(import.meta.dirname, "..");
const entries = [
    ["messageZh", "src/node/locales/zh-CN/message.yml"],
    ["messageEn", "src/node/locales/en-US/message.yml"],
    ["schemaZh", "src/node/locales/zh-CN/schema.yml"],
    ["schemaEn", "src/node/locales/en-US/schema.yml"],
] as const;

const generated = entries.map(async ([name, relativePath]) => {
    const source = await readFile(resolve(root, relativePath), "utf8");
    return `export const ${name} = ${JSON.stringify(load(source), null, 4)} as const\n`;
});

const output = resolve(root, "src/node/locales/generated.ts");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${(await Promise.all(generated)).join("\n")}\n`);

// i18n 一致性检查：zh-CN / en-US 文案文件的 key 集合与 {placeholder} 必须对齐，
// client 侧还要求 namespace 在 client/i18n.ts 注册。挂在 check 脚本里。
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { load } from "js-yaml";

const root = resolve(import.meta.dirname, "..");
const errors: string[] = [];

function report(message: string): void {
    errors.push(message);
}

function flatten(value: unknown, prefix = ""): Map<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return new Map([[prefix, value]]);
    }
    const result = new Map<string, unknown>();
    for (const [key, child] of Object.entries(value)) {
        const path = prefix ? `${prefix}.${key}` : key;
        for (const [childPath, childValue] of flatten(child, path)) {
            result.set(childPath, childValue);
        }
    }
    return result;
}

function placeholders(value: unknown): string[] {
    if (typeof value !== "string") return [];
    return [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!).sort();
}

async function readYaml(relativePath: string): Promise<unknown> {
    const path = resolve(root, relativePath);
    try {
        return load(await readFile(path, "utf8")) ?? {};
    } catch (error) {
        report(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
        return {};
    }
}

async function checkLocalePair(relativePath: string, otherPath: string): Promise<void> {
    const [left, right] = await Promise.all([readYaml(relativePath), readYaml(otherPath)]);
    const leftLeaves = flatten(left);
    const rightLeaves = flatten(right);
    const leftKeys = [...leftLeaves.keys()].sort();
    const rightKeys = [...rightLeaves.keys()].sort();
    if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
        const missingRight = leftKeys.filter((key) => !rightLeaves.has(key));
        const missingLeft = rightKeys.filter((key) => !leftLeaves.has(key));
        if (missingRight.length) report(`${otherPath} missing: ${missingRight.join(", ")}`);
        if (missingLeft.length) report(`${relativePath} missing: ${missingLeft.join(", ")}`);
    }
    for (const key of leftKeys) {
        if (!rightLeaves.has(key)) continue;
        const leftPlaceholders = placeholders(leftLeaves.get(key));
        const rightPlaceholders = placeholders(rightLeaves.get(key));
        if (JSON.stringify(leftPlaceholders) !== JSON.stringify(rightPlaceholders)) {
            report(`${relativePath} and ${otherPath} placeholder mismatch at ${key}`);
        }
    }
}

// 旧 client 底册的 locale 布局：client/shared/locales/{zh-CN,en-US}/*.yml（8 个 namespace）
// + client/market/locales/{zh-CN,en-US}.yml（market namespace），注册于 client/shared/i18n.ts。
const namespaceByFile: Record<string, string> = {
    "common.yml": "common",
    "dependencies.yml": "dependencies",
    "market-page.yml": "marketPage",
    "operations.yml": "operations",
    "dependency-card.yml": "dependencyCard",
    "extensions.yml": "extensions",
    "bundle.yml": "bundle",
    "environment.yml": "environment",
};

async function checkClientLocales(): Promise<void> {
    const zhDir = resolve(root, "client/shared/locales/zh-CN");
    const enDir = resolve(root, "client/shared/locales/en-US");
    const [zhFiles, enFiles] = await Promise.all([readdir(zhDir), readdir(enDir)]);
    const files = [...new Set([...zhFiles, ...enFiles])].filter((file) => file.endsWith(".yml")).sort();
    const index = await readFile(resolve(root, "client/shared/i18n.ts"), "utf8");
    for (const file of files) {
        const namespace = namespaceByFile[file];
        if (!namespace) {
            report(`client/shared/locales/${file}: missing namespace mapping`);
            continue;
        }
        const zhPath = `client/shared/locales/zh-CN/${file}`;
        const enPath = `client/shared/locales/en-US/${file}`;
        if (!zhFiles.includes(file)) report(`${zhPath} is missing`);
        if (!enFiles.includes(file)) report(`${enPath} is missing`);
        if (!index.includes(`./locales/zh-CN/${file}`) || !index.includes(`./locales/en-US/${file}`)) {
            report(`${file}: both locale imports must be registered in client/i18n.ts`);
        }
        if (!index.includes(`    ${namespace}:`)) {
            report(`${file}: namespace ${namespace} must be registered in client/i18n.ts`);
        }
        if (zhFiles.includes(file) && enFiles.includes(file)) await checkLocalePair(zhPath, enPath);
    }

    // market namespace 单独放在 client/market/locales/{zh-CN,en-US}.yml
    const marketZh = "client/market/locales/zh-CN.yml";
    const marketEn = "client/market/locales/en-US.yml";
    if (!index.includes("../market/locales/zh-CN.yml") || !index.includes("../market/locales/en-US.yml")) {
        report("market: both locale imports must be registered in client/i18n.ts");
    }
    if (!index.includes("    market:")) {
        report("market: namespace market must be registered in client/i18n.ts");
    }
    await checkLocalePair(marketZh, marketEn);
}

async function checkNodeLocales(): Promise<void> {
    for (const name of ["message.yml", "schema.yml"]) {
        await checkLocalePair(`src/node/locales/zh-CN/${name}`, `src/node/locales/en-US/${name}`);
    }
}

await Promise.all([checkClientLocales(), checkNodeLocales()]);

if (errors.length) {
    console.error(`i18n check failed with ${errors.length} error(s):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log("i18n check passed");
}

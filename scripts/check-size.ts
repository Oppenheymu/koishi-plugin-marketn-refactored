// 行数预算与依赖方向守卫（重构质量门禁的一部分，挂在 `check` 脚本里）。
//
// 注：client 已于前端恢复为旧版参考实现（单文件大组件是参考底册的本来形态），
// 不再参与本门禁的行数预算；门禁只对重构后的 src/ 生效。
//
// 预算口径：
// - .ts/.mjs：总行数
// - .vue：<template> + <script> 合并行数（<style> 出仓到 .scss，不计入）
// - >250 警告，>=350 直接失败
//
// 依赖方向：
// - src/core/** 禁止运行时依赖 koishi（`import type` 纯类型除外），禁止依赖 @koishijs/*
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WARN = 250;
const FAIL = 350;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) {
            if (name === "node_modules" || name === "__tests__") continue;
            walk(full, out);
        } else if (/\.(ts|vue|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) {
            out.push(full);
        }
    }
    return out;
}

function countVueLines(content: string): number {
    const withoutStyle = content.replace(/<style[\s\S]*?<\/style>/g, "");
    return withoutStyle.split("\n").length;
}

function checkCoreImports(file: string, content: string, problems: string[]): void {
    const rel = relative(ROOT, file);
    if (!rel.includes(join("src", "core"))) return;
    // 允许 @koishijs/registry（框架无关的领域类型与扫描器）；禁止 koishi 运行时与其余 @koishijs/* 框架面
    for (const [index, line] of content.split("\n").entries()) {
        const banned = /from ['"]koishi['"]|from ['"]@koishijs\/(?!registry)['"]/.test(line);
        if (!banned) continue;
        if (/^\s*import\s+type\b/.test(line)) continue;
        if (/^\s*export\s+type\s*\{/.test(line)) continue;
        problems.push(`${rel}:${index + 1} core 层禁止运行时依赖 koishi: ${line.trim()}`);
    }
}

const dirs = [join(ROOT, "src")].filter((d) => existsSync(d));
const files = dirs.flatMap((d) => walk(d));
const warnings: string[] = [];
const errors: string[] = [];
const importProblems: string[] = [];

for (const file of files) {
    const rel = relative(ROOT, file);
    const content = readFileSync(file, "utf8");
    const lines = file.endsWith(".vue") ? countVueLines(content) : content.split("\n").length;
    if (lines >= FAIL) errors.push(`${rel}: ${lines} 行（上限 ${FAIL}，必须拆分）`);
    else if (lines > WARN) warnings.push(`${rel}: ${lines} 行（> ${WARN}，需拆分或说明理由）`);
    checkCoreImports(file, content, importProblems);
}

for (const w of warnings) console.warn(`[size] 警告 ${w}`);
for (const e of errors) console.error(`[size] 错误 ${e}`);
for (const p of importProblems) console.error(`[arch] ${p}`);

if (warnings.length) console.warn(`[size] ${warnings.length} 个文件超过 ${WARN} 行`);
if (errors.length || importProblems.length) {
    console.error(`[gate] 失败：${errors.length} 个超限文件，${importProblems.length} 处违规依赖`);
    process.exit(1);
}
console.log(`[gate] 通过：${files.length} 个文件受检`);

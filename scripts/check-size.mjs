// 行数预算与依赖方向守卫（重构质量门禁的一部分，挂在 `check` 脚本里）。
//
// 预算口径：
// - .ts/.mjs：总行数
// - .vue：<template> + <script> 合并行数（<style> 出仓到 .scss，不计入）
// - >300 警告，>=400 直接失败
//
// 依赖方向：
// - src/core/** 禁止运行时依赖 koishi（`import type` 纯类型除外），禁止依赖 @koishijs/*
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const WARN = 250
const FAIL = 350

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      walk(full, out)
    } else if (/\.(ts|vue|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function countVueLines(content) {
  const withoutStyle = content.replace(/<style[\s\S]*?<\/style>/g, '')
  return withoutStyle.split('\n').length
}

function checkCoreImports(file, content, problems) {
  const rel = relative(ROOT, file)
  if (!rel.includes(join('src', 'core'))) return
  // 允许 @koishijs/registry（框架无关的领域类型与扫描器）；禁止 koishi 运行时与其余 @koishijs/* 框架面
  for (const [index, line] of content.split('\n').entries()) {
    const banned = /from ['"]koishi['"]|from ['"]@koishijs\/(?!registry)['"]/.test(line)
    if (!banned) continue
    if (/^\s*import\s+type\b/.test(line)) continue
    if (/^\s*export\s+type\s*\{/.test(line)) continue
    problems.push(`${rel}:${index + 1} core 层禁止运行时依赖 koishi: ${line.trim()}`)
  }
}

const dirs = [join(ROOT, 'src'), join(ROOT, 'client')].filter((d) => existsSync(d))
const files = dirs.flatMap((d) => walk(d))
const warnings = []
const errors = []
const importProblems = []

for (const file of files) {
  const rel = relative(ROOT, file)
  const content = readFileSync(file, 'utf8')
  const lines = file.endsWith('.vue') ? countVueLines(content) : content.split('\n').length
  if (lines >= FAIL) errors.push(`${rel}: ${lines} 行（上限 ${FAIL}，必须拆分）`)
  else if (lines > WARN) warnings.push(`${rel}: ${lines} 行（> ${WARN}，需拆分或说明理由）`)
  checkCoreImports(file, content, importProblems)
}

for (const w of warnings) console.warn(`[size] 警告 ${w}`)
for (const e of errors) console.error(`[size] 错误 ${e}`)
for (const p of importProblems) console.error(`[arch] ${p}`)

if (warnings.length) console.warn(`[size] ${warnings.length} 个文件超过 ${WARN} 行`)
if (errors.length || importProblems.length) {
  console.error(`[gate] 失败：${errors.length} 个超限文件，${importProblems.length} 处违规依赖`)
  process.exit(1)
}
console.log(`[gate] 通过：${files.length} 个文件受检`)

# 项目常驻指令

> 本文件是本仓库（`koishi-plugin-marketn-refactored`，下一代 Koishi 插件市场与依赖管理中心，对 `koishi-plugin-market-next` 的大爆炸重构，AGPL-3.0）的常驻开发约定，适用于本仓库内所有会话与任务。

## 基本约束

- **全程使用简体中文**：所有回复、代码注释、提交说明、生成的文档均使用简体中文。
- **`参考/` 与 `原版参考/` 是旧代码参考**（重构过程参照与原版快照）：**可以放心阅读、对照实现逻辑**，但**只读勿改**；契约验收基线是 `docs/reference/` 考据文档（如 `docs/reference/前后端调用契约.md`）。
- **不要在 Biome 的 JSON 行尾不可见字符上浪费 Token**：这是已知的、正常的、无害的现象。看到即跳过，不要调查成因、不要试图修复、不要反复报告。
- 除以上约束外，不要过度解读本指令——其余行为遵循默认 Agent 规则。

## 关于 docs/ 文档

- **多数已过时，勿依赖**：`docs/overview/`、`docs/design/`、`docs/handover/` 里的阶段性文档多为历史记录，可能与实际代码不一致——不要把它们当开发依据，以 `src/` 与 `client/` 实际代码为准。
- **契约基线仍有效**：`docs/reference/` 考据文档（如 `docs/reference/前后端调用契约.md`）是验收基线，需要核对外部契约时查阅。

## 分层架构（依赖方向不可逆）

- `src/shared/`：纯类型与纯函数，禁止任何 I/O
- `src/core/`：业务核心，禁 koishi 运行时（`import type { Dict }` 允许；`@koishijs/registry` 例外），I/O 走构造注入的 `deps` 对象
- `src/node/`：Koishi 适配层，组装 core、注入 deps，不写业务逻辑
- `client/`：前端按功能组织（feature-first），`<script setup lang="ts">`，样式出仓同目录 `.scss`

## 门禁与工作流

- **门禁命令**：`yarn check`（全量门禁，提交前必跑）→ `yarn build`（tsdown + build-client）→ `yarn test`（vitest）；分步验证用 `yarn build:client` / `yarn lint:client` / `yarn check:size`。
- **设计先行**：动手前先明确设计要点（可在会话中说明并请用户确认），设计变更先更新设计记录再改代码；逻辑成块移植不发明；逐模块实现，每完成一个模块跑一次门禁；门禁全绿才合入。
- **门禁硬线**：任何文件 ≥350 行直接 fail（目标 ≤200 行）；core 层运行时 `from 'koishi'` / `from '@koishijs/*'` 一律 error。

## 代码风格（tsconfig 强制级）

- 4 空格缩进、行宽 100、双引号、尾逗号；严格模式（strict）全家桶。
- 类型导入一律 `import type` / 重导出 `export type {`。
- 无默认导出（default export，Koishi `apply` 入口除外）；`satisfies` 优先；biome 自动整理导入。

## 已知坑（历史经验，别再踩）

- execa v10 无默认导出，用 `execa(name, args, { cwd, reject: false })`
- `package-manager-detector` 的 `detect()` 返回 Promise，必须 await
- ESM 无 `__dirname`，用 `import.meta.url` + `fileURLToPath`
- 宿主 `exports.development` 不生效，宿主验证以先 `yarn build` 产出 `lib/` 为前提
- client prod 构建只探测 `style.css`，改动构建配置必须保住产物名
- `install/logs/store.ts` 的 ANSI 清洗正则带 `biome-ignore` 注释，别删注释

## git 提交流程

1. 先跑 `yarn check`（必要时先自动修复），确保全部通过再提交。
2. `git add -A` 后提交，提交信息用简体中文，格式参考现有历史（`feat:` / `fix:` / `docs:` / `chore:`）。
3. 提交到主分支；若当前不在主分支，先切回主分支再提交。
4. 提交完成后向用户简要说明改了什么与提交哈希。

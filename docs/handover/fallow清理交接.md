# Fallow 体检与清理 · 交接文档

> 交接时间：2026-08-21。接手者请先读本文件再动手。
> 背景任务：用户要求「使用 fallow 检查本项目，重构屎山」。计划已获批准并执行到批次 3c 收尾，
> 因额度中断，剩余收尾工作见 §4。

## 0. 一分钟状态

- **基线**：HEAD = `8929f91`（P4 交接 P5），工作区有大量**未提交改动**（本任务的产出，勿丢弃勿回滚）。
- **当前验证状态**：`npx tsc --noEmit` ✅ 0 错误；`tsc -p client/tsconfig.json` ✅；`yarn test` ✅ 30/30；
  `yarn check:size` ✅ 通过（>300 行警告从 11 → 9 个）。
- **尚未跑**：`yarn check` 全量最后一遍、`yarn build`、`yarn build:client`、fallow 复扫对比（见 §4）。
- 改动**全部未 commit**，留给用户审阅。

## 1. fallow 是什么、怎么用（本项目约定）

- Rust 版 TS 代码分析工具，**不是** npm 依赖（项目挂在宿主 koishi-app yarn4 workspace 下，
  不能本地 npm install，否则破坏宿主 yarn.lock）。用 **`npx --yes fallow`** 运行（当前 3.17.0）。
- 常用命令：`npx --yes fallow dead-code`（死代码+循环依赖）、`dupes`（重复）、`health --score`（复杂度）、
  `dead-code --format compact`（简洁清单）、`--format json` 留底。
- 退出码 1 = 有发现（正常），2 = 真错误。
- 配置 `.fallowrc.jsonc`（已提交）：ignorePatterns 忽略 `Waiting_refactored/`、`原版参考/`、`lib/`、`dist/`。
  原注释里被注释掉的 `dynamicallyLoaded: ["client/**"]` **已验证不需要**（fallow 能识别 koishi 插件入口，
  client/ 只误报了 1 个死文件，已删）。基线报告缓存在 `.fallow/*.json`（该目录自忽略）。

## 2. 基线扫描结果（2026-08-21，改动前）

- dead-code：78 个发现（unused_exports 42、unused_class_members 22、unused_types 5、循环依赖 1、
  重复命名导出 3、未声明依赖 1、未使用 devDep 1、死文件 1）
- dupes：0 个重复代码块；health：70 分（B），最大扣分 unit_size（347 个超阈值函数、96 critical）
- 最热点：`client/market/utils/filters.ts validate`（圈复杂度 46 / CRAP 2162）、
  `src/core/install/orchestrator.ts run`（圈复杂度 31）

## 3. 已完成的工作（按批次）

### 批次 1：死代码清理（已验证）
- **package.json**：删未使用的 `js-yaml` devDep；补 `@vueuse/core ^11.1.0` devDep
  （client 两处运行时导入但未声明，vite external 由 console 提供，对齐官方插件惯例放 devDeps）。
- **删除**：`client/styles/dialogs.scss`（零导入）、`getUserAvatar`、`getSorted`、`getSortedFiltered`、
  `marketRouteCooldown`（racing/stats.ts）、market/format.ts 的 `formatRouteScores`+`formatCacheEntries`、
  registry/errors.ts 的 `formatRouteScores`、resolver 的 `dependencies`/`cache` getter、
  cache-store 的 `dispose`/`scheduleStatsWrite`/`routeStatsWriteTimer`（写盘已有 isAlive 守卫，确认冗余）、
  source.ts 的 `get debugInfo`（被 `exportedDebug` 取代）、market 桶文件里无人用的 `MarketPackage` 转发。
- **去导出**（保留实现仅删 `export`，内部仍在用）：contracts.ts 的 13 个 zod schema、
  `sweepRegistryStatus`、`identityMap`、`hasCompleteLocaleMessage`、`manualDeps`、
  `createBundleRecordFromManifest`、`isBundleGroupPath`、`pushInstallLog`、`normalizeFrontendMode`、
  `rulesToSilentFilters`/`ruleToSilentFilter`、`marketLookupData`/`marketLookupServices`、`getCachedAvatar`、
  `normalizeEnvironmentDependencies`/`getEnvironmentSnapshotId`、`INSTALL_LOG_DIR`、`FALLBACK_ENDPOINTS`、
  `isRouteCoolingDown`、`hasCacheResultReference`、`registryEndpointCandidates`、`hasPluginConfig`、
  `LocalPackage`（registry/manifest.ts）、`MemberAction`、update-policy 的 `IgnoredUpdates` 转发。

### 批次 2：重复定义统一（已验证）
- `InstallFallbackCandidate` 原先在 3 处重复定义（core/install/types.ts、registry/client.ts、
  client/lib/install-flow.ts）→ 统一进 **`src/shared/types.ts`**，三处改为 import。
- client 的 `isUpdateCheckDisabled` 纯转发包装 → 改为 `export { isUpdateCheckDisabled } from '../../src/shared/update'` 再导出（调用方不动）。

### 批次 3a：循环依赖与类型收敛（已验证）
- 打断 `registry/client.ts ↔ registry/endpoints.ts` 循环：`REGISTRY_FALLBACK_ENDPOINTS`、
  `RegistryClientConfig` 移到 endpoints.ts，client.ts 单向引用。
- `RegistryClient implements RegistryFetchHost`（fetch.ts）、`MarketIndexSource implements MarketBackgroundSource`
  （background.ts）——结构性接口补声明，tsc 静态校验 + 消除 fallow 接口分发误报。

### 批次 3b：filters.validate 表驱动重构 + 首批单测（已验证）
- `client/market/utils/filters.ts` 的 validate（CRAP 2162）重构：日期过滤前缀表（顺序保持旧 else-if 链，
  `<=` 先于 `<`）+ is:/not: 谓词表，语义 1:1（含无 manifest 分支、未知键回退 is→false/not→true）。
- **新增测试**（项目原来 0 个测试文件！）：
  - `client/market/utils/filters.test.ts`（21 例，vi.mock 桩掉 avatars/search-index 重依赖）
  - `src/shared/update.test.ts`（9 例；注意 `isUpdateVersionIgnored` 的移植语义：
    `targetIndex > ignoredIndex` 恒忽略、count 用严格小于比较——测试按实际行为断言并注释）

### 批次 3c：三个 >300 行核心文件拆分（P6 预留项，已完成）
| 文件 | 之前 | 之后 | 拆出 |
|---|---|---|---|
| src/core/market/cache-store.ts | 334 | 241 | `cache-io.ts`（原子写盘/条目文件/清理，91 行） |
| src/core/market/source.ts | 385 | 289 | `source-types.ts`（接口+路由统计工厂）、`warmup.ts`（磁盘缓存预热）、fetchDeps 移入 fetch-index.ts 的 `buildMarketFetchDeps` |
| src/core/install/orchestrator.ts | 372 | 297 | `local-sources.ts`（来源校验，91 行）、finalizeInstall/detectFullReload 抽方法、装配接口移入 install/types.ts |

全部为行为保持型提取；run 闭包的收尾/重载判定已抽成私有方法降低复杂度。

## 4. 剩余待办（按优先级）

1. **最终复验（必做）**：
   - `yarn check`（应只剩 5 个改动前就有的 `any` 警告，位于 src/node/index.ts 的 koa handler）
   - `yarn build`（tsdown）+ `yarn build:client`（vite）——**这是改动后首次完整构建**，重点看 lib/node、dist 产物正常。
2. **vite CSS 产物名修复（P5 关键坑，已确诊未修）**：`vite.config.ts` 注释声称 lib 模式产出 `style.css`
   （prod console 只探测 style.css），但实际产出 `dist/index.css`。修法：`build.lib` 加 `cssFileName: 'style'`
   （Vite 8 支持），然后 `yarn build:client` 验证产物名。交接来源：`docs/handover/P4交接P5.md`。
3. **fallow 复扫对比（收尾证据）**：`npx --yes fallow dead-code --format compact`，
   预期：循环依赖 0、未声明依赖 0、unused_exports 大幅下降。剩余已知误报见 §5，可留。
4. **收尾文档**：`docs/overview/FALLOW.md` 简记 fallow 用法与误报豁免清单；`.fallowrc.jsonc` 注释里
   "待验证"字样已随本次验证更新（确认过的话改成已验证说明）。README 状态表仍停在 P3（P6 再管）。
5. （可选）`npx fallow health` 复查 filters.validate / orchestrator run 的复杂度下降幅度，写进文档。

## 5. 已知误报与豁免决策（勿当死代码删）

- **DataService 框架回调**：`src/node/providers.ts` ×3、`market.service.ts`、`data-store.ts` 的
  `override async get()`——Koishi Console 框架在 refresh 时反射调用。fallow 不认识 koishi。
- **多态可选方法**：`market.service.ts probeInBackground`——`idle-probe.ts:69` 经
  `ctx.console.services.market?.probeInBackground?.()` 可选链调用。
- **命名遮蔽**：node 层 `MarketProvider`（market.service.ts）继承并遮蔽 shared/provider.ts 同名基类——
  有意的插件模式（`ctx.plugin(MarketProvider)`），不改名。
- 若想让 fallow 报告归零：用行内 `fallow-ignore-next-line` 注释或 JSDoc `@public` 标注上述位置，
  **不要删除**。`dev_dependencies_in_production`（vue/@koishijs/client 放 devDeps）也是 koishi 生态惯例，忽略。

## 6. 坑与注意事项

- 本项目是宿主 `koishi-app`（yarn4 workspace）成员，**没有自己的锁文件**；不要在项目内 npm/yarn install。
- 修改后**必须双通道 tsc**：`npx tsc --noEmit` 和 `npx tsc --noEmit -p client/tsconfig.json`
  （.vue 不进 tsc 编译单元，import 路径只有 vite build 能验证）。
- 格式化用 `npx biome check --write .`；行数预算 `yarn check:size`（>300 警告、≥400 直接 fail，
  .vue 计 template+script、style 出仓 .scss）。
- **typescript 已升级为官方 side-by-side 布局**（2026-08-21，见 §9）：包名 typescript = `npm:@typescript/typescript6@6.0.2`
  （TS6 API 兼容包，供 eslint parser / vue compiler-sfc 解析），TS7 走 `@typescript/native`（npm alias 到 typescript@7.0.2），
  `yarn check` 的 tsc 双通道用 `yarn ts7`（node 直调，不依赖 .bin 链接——yarn 的 builtin patch 会弄坏 typescript6 的 bin/tsc，
  @typescript/native 的 bin 会被提升挤掉）。vue 锁宿主 3.5.41（compiler-sfc 依赖 ts.sys，TS6 API 下正常）。
- `Waiting_refactored/`（旧代码快照）与 `原版参考/` 是 P5 冒烟的移植参照，**P6 才删除**，已在 fallow 忽略。
- 测试基线：`yarn test` 30 例全绿（filters 21 + shared/update 9），重构后再动这些区域请保持测试通过。

## 7. 改动文件清单（git status 快照）

修改 39 个文件 + 删除 1 个（client/styles/dialogs.scss）+ 新增 6 个：
`src/core/install/local-sources.ts`、`src/core/market/cache-io.ts`、`src/core/market/warmup.ts`、
`src/core/market/source-types.ts`、`client/market/utils/filters.test.ts`、`src/shared/update.test.ts`。
完整清单：`git status --short`。

## 8. 批次 4 收尾（2026-08-21 追加，§4 待办全部完成）

- **最终复验**：`yarn check` ✅ exit 0（biome 仅剩 5 个预存在 any 警告、tsc 双通道/eslint/size 全绿）；
  `yarn test` ✅ 30/30；`yarn build`（tsdown）✅ lib/node + lib/shared；`yarn build:client`（vite 8.2.2）✅。
- **vite CSS 产物名**：`build.lib.cssFileName: 'style'` 已生效，产物 `dist/style.css`（161.36 kB）+ `dist/index.js`（436.57 kB）。
  顺手修掉全局 scss 里无效的 `:deep()` 包装（install/index.scss），lightningcss 警告归零。
- **fallow 复扫**：dead-code 78 → **10 条全豁免（真实发现 0）**；循环依赖/未声明依赖/死文件/unused_exports/unused_types 全部归零。
- **批次 4 清理**：删真死成员 `RegistryClient.stats`（RegistryFetchHost 接口不含，无调用）、`JsonStore.dispose`（无调用点）；
  `REGISTRY_FALLBACK_ENDPOINTS`、client 端 `LogLine` 去导出；`conditionalHeaders` 用 JSDoc `@public` 豁免 Pick 分发误报
  （注意：fallow 的 `fallow-ignore-next-line` 需附 issue kind，不带 kind 会报 stale-suppression）。
- **health 复查**：70 B → **88 A**（+18），unit_size 超阈值函数 347 → 336。
- **收尾文档**：新建 `docs/overview/FALLOW.md`（用法/基线/豁免清单/复扫数据）；`.fallowrc.jsonc` 注释更新为已验证表述。
- 本批改动已提交（`git log --oneline -3` 可查），工作区干净。

## 9. TypeScript 7 side-by-side 升级（2026-08-21 追加）

- **背景**：P4 因 `@typescript-eslint/parser` 8.67 require 时 throw 将 typescript 降级 ~6.0.3。
  实测 TS7（tsgo）+ parser 8.67 确实互不兼容（parser peer 上限 <6.1.0，运行时版本门禁直接报错）；
  vue 3.5.41 的 `@vue/compiler-sfc` 依赖 `ts.sys`（TS7 无此 API）→ vite build 报 "No fs option provided"。
  模范案例 koishi-plugin-adapter（TS 7.0.2 + parser 8.67）实测 eslint 同样失败——**当时没有任何已发布版本支持 TS7**，
  官方唯一路径是 side-by-side（微软发布指南 + loke.dev 2026-08 验证）。
- **方案**：
  - `"typescript": "npm:@typescript/typescript6@6.0.2"` —— 占住 typescript 包名，API 消费者
    （@typescript-eslint/parser、@vue/compiler-sfc）解析到 TS6（有 ts.sys、peer <6.1.0 通过）。
  - `"@typescript/native": "npm:typescript@7.0.2"` —— TS7 原生 Go 编译器（tsgo），提供 tsc CLI。
  - `yarn check` 的 tsc 双通道改走 `yarn ts7`（脚本：`node ../../node_modules/@typescript/native/bin/tsc`）；
    保留 `typecheck:legacy`（tsc6）与 `ts7:typecheck` 供对照。
- **坑**：yarn4 的 builtin compat patch 会给名为 typescript 的包补一个指向 `lib/_tsc.js` 的坏 `bin/tsc`
  （typescript6 兼容包无此文件）；@typescript/native 的 bin 会被提升到宿主根且被挤掉——
  **不要依赖 `.bin/tsc` 指向 TS7**，脚本直调 node 执行物理路径最稳。
- **验证**：`yarn check` ✅ exit 0（TS7 tsc 双通道 + TS6 eslint，仅剩 5 个预存 any 警告）；
  `yarn build` ✅（tsdown + vite 272 modules 无警告，dist/style.css 正常）；`yarn test` ✅ 30/30。
- **移除条件**：typescript-eslint 官方声明支持 TS ≥7.1 后可移除 typescript6 兼容层，恢复正常 typescript 依赖。
## 10. 批次 5 补充（2026-08-21，P6 期间 dupes 大清理）

- 背景：P5/P6 新增代码引入重复，fallow dupes 0 → 24 组 / 982 行（3.6%）。本轮消解为 **5 组 / 210 行（0.8%）**。
- 详情见 docs/overview/FALLOW.md §7-8；dead-code 10 条全为已知豁免（真实 0）；health 86 A。
- 本轮改动未 commit，yarn check / yarn test（242）/ yarn build 全绿。
- 注意：JSDoc @public 对类成员豁免在 cache/index.ts 不生效，conditionalHeaders 改用行内 fallow-ignore-next-line；
  @typescript/native 已加入 .fallowrc ignoreDependencies。


# fallow 使用与豁免清单

> Rust 版 TS 静态分析工具，用于死代码/重复/复杂度体检。本文档记录用法、基线数据与**误报豁免决策**
> （fallow 不认识 koishi 生态，部分报告必须人工豁免，**不要当死代码删**）。

## 1. 为什么用 npx 跑

fallow 为 devDependency（P5 起），挂在宿主 koishi-app（yarn4 workspace）下由 workspace 解析。
P5 起 fallow 已加入 devDependencies（^3.14.0，实际解析到 3.17.0），可直接 `yarn fallow` 运行；配置 `.fallowrc.jsonc` 已提交，
ignorePatterns 忽略 `Waiting_refactored/`、`原版参考/`、`lib/`、`dist/`。

## 2. 常用命令

| 命令 | 用途 | 退出码 |
|---|---|---|
| `npx --yes fallow dead-code` | 死代码 + 循环依赖 + 未声明依赖 | 1=有发现（正常），2=真错误 |
| `npx --yes fallow dead-code --format compact` | 简洁清单（对比用） | 同上 |
| `npx --yes fallow dead-code --format json` | JSON 留底 | 同上 |
| `npx --yes fallow dupes` | 重复代码块 | 同上 |
| `npx --yes fallow health --score` | 复杂度评分 | 同上 |

基线报告缓存在 `.fallow/*.json`（该目录自忽略，不提交）。

## 3. 基线数据（2026-08-21，批次 1-3c 清理前）

- dead-code：**78 个发现** = unused_exports 42 + unused_class_members 22 + unused_types 5 +
  循环依赖 1 + 重复命名导出 3 + 未声明依赖 1 + 未使用 devDep 1 + 死文件 1
- dupes：0；health：70 分（B），最大扣分 unit_size（347 个超阈值函数、96 critical）
- 最热点：`client/market/utils/filters.ts validate`（圈复杂度 46 / CRAP 2162）、
  `src/core/install/orchestrator.ts run`（圈复杂度 31）

## 4. 清理后复扫（2026-08-21 批次 4 收尾）

`fallow dead-code --format compact` 从 78 条收敛到 **10 条，全部为已知豁免项，真实发现 0**：

| 类别 | 基线 | 现在 |
|---|---|---|
| 循环依赖 | 1 | 0 |
| 未声明依赖 | 1 | 0 |
| 未使用 devDep | 1 | 0 |
| 死文件 | 1 | 0 |
| unused_exports | 42 | 0 |
| unused_types | 5 | 0 |
| 重复命名导出 | 3 | 1（已知遮蔽） |
| unused_class_members | 22 | 7（框架回调/可选链） |
| dev_dependencies_in_production | — | 3（生态惯例） |

> 批次 4 清理（本交接收尾）：删真死成员 `RegistryClient.stats`、`JsonStore.dispose`；
> `REGISTRY_FALLBACK_ENDPOINTS`/client 端 `LogLine` 去导出；
> `MarketDiskCache.conditionalHeaders` 的 Pick 分发误报豁免见 §7 dead-code 收尾（本轮改用行内注释）。

## 5. 误报豁免清单（勿当死代码删）

- **DataService 框架回调**：`src/node/providers.ts` ×3（DependencyProvider/RegistryProvider/RegistryStatusProvider
  的 `get`）、`market.service.ts`、`data-store.ts` 的 `override async get()`——Koishi Console 框架
  在 refresh 时反射调用，fallow 不认识 koishi。
- **多态可选方法**：`market.service.ts probeInBackground`——`idle-probe.ts` 经
  `ctx.console.services.market?.probeInBackground?.()` 可选链调用。
- **命名遮蔽**：node 层 `MarketProvider`（market.service.ts）继承并遮蔽 shared/provider.ts 同名基类——
  有意的插件模式（`ctx.plugin(MarketProvider)`），不改名。
- **Pick 接口分发**：`MarketDiskCache.conditionalHeaders`（cache/index.ts）——经 fetch-index 的
  `Pick<MarketDiskCache, ...>` 分发后被 fetch-endpoint 消费，fallow 穿透不了 Pick，已用行内
  `// fallow-ignore-next-line unused-class-member` 豁免（实测 JSDoc `@public` 对类成员不生效）。
- **dev_dependencies_in_production**（vue/@koishijs/client/@vueuse/core 放 devDeps）——koishi 生态惯例：
  运行时由宿主 console 提供，vite external，对齐官方插件放 devDeps，忽略。

若想让报告彻底归零：用行内 `fallow-ignore-next-line <issue-kind>` 注释或 JSDoc `@public` 标注上述位置即可。

## 6. 复杂度复查（health，2026-08-21）

- 总分：**70 B → 88 A**（+18）；扣分项：unit size -10.0、coupling -2.3
- unit_size 超阈值函数：347 → 336
- filters.validate 表驱动重构后圈复杂度从 46 大幅下降（语义 1:1，见 client/market/utils/filters.test.ts）；
  orchestrator run 的收尾/重载判定抽为私有方法后主闭包复杂度显著下降。
- hotspots 报告需另行开启对应分析 flag，本仓库不强制。


## 7. 批次 5：dupes 大清理（2026-08-21，P6 期间）

> P5/P6 新增代码（racing/registry/avatar/新弹窗等）引入了新的重复：dupes 从 0 → **24 组 / 982 行（3.6%）**。
> 本轮按 fallow 报告全部消解为 **5 组 / 210 行（0.8%）**，剩余均为结构性/有意重复（见 §8）。

### 消解的重复（24 → 5 组）

| 组 | 内容 | 处理 |
|---|---|---|
| #7 | client market-config.ts 与 node config/index.ts 的 5 个 MarketSilent*Rule 接口（72 行） | 统一进 src/shared/types.ts，两侧 import + re-export |
| #8 | formatShortname（bundle 安装）与 formatPackageDisplayName（依赖卡片）逐字重复（24 行） | 抽 client/market/utils/format.ts，identity.ts 与 helpers.ts 引用/再导出 |
| #10 | install-flow 的 runInstall/runRestore 断线 watch 前置（14 行） | 抽 createSocketDisconnectTracker() |
| #13 | MarketSnapshotInput 与 shared/types 的 MarketPayload 结构完全一致（25 行） | 改为 type MarketSnapshotInput = MarketPayload 别名 |
| #16 | formatInstallError 在 helpers.ts 与 install-flow.ts 重复 | 抽 client/shared/error.ts 的 extractErrorMessage |
| #19 | client/node 两侧 market/lookup 的服务收集循环（6 行） | 抽 src/shared/lookup.ts 的 collectServiceProviders |
| #20 | market-mode-*/version-popper computed 三元组 ×4 处 | 抽 client/shared/ui/market-mode.ts 的 useMarketModeClass() |
| #3/#5 | install-history 的 index/detail 视图 4 个格式化函数重复（~33 行） | 抽 client/dialogs/install-history/format.ts（statusText/title/date/duration/endpoint/size/beforeVersion/afterVersion） |
| #12 | commands.ts install/uninstall 的 resolveName+getDeps 前缀（8 行） | 抽 findInstalledName() |
| #24 | orchestrator 安装前后环境快照的 catch-warn（7 行） | 抽私有 recordSnapshotSafely() |
| #22 | manage.ts 与 bundle.ts 的插件配置键查找循环（5 行） | 抽 src/node/config/plugins-map.ts（findPluginConfigKey/hasPluginConfigInTree） |
| #1/#2/#9 | SCSS：danger 移除按钮 ×3、.dep-status-mark ×2、polished .layout-main ×2、polished-bg-drift keyframes ×2、.cat-* 色板 ×2、toolbar 切换按钮 ×2 | 抽 client/styles/mixins.scss（6 个 mixin）；keyframes 移入 client/styles/polished.scss 全局单次导入，避免被 @use 消费者重复编译（构建产物实测 keyframes 仅 1 份） |

### 验证

- yarn check ✅ exit 0（tsc 双通道 / biome / eslint / size 全绿，仍只有改动前就有的 koa any 警告）
- yarn test ✅ 242/242（25 个测试文件）
- yarn build ✅（tsdown + vite 279 modules，dist/style.css 161.14 kB 不增反降）
- fallow 复扫：dupes 24 组 / 982 行（3.6%）→ **5 组 / 210 行（0.8%）**；dead-code 10 条全豁免（真实 0）；health 86 A 无回归

### dead-code 收尾（本轮）

- MarketDiskCache.conditionalHeaders：JSDoc @public 对类成员不生效（移文件后失效），改用行内
  // fallow-ignore-next-line unused-class-member 豁免 Pick 分发误报。
- @typescript/native：yarn ts7 脚本经 node 直调（路径越出项目根），加入 .fallowrc 的 ignoreDependencies。

## 8. 剩余重复组与豁免（2026-08-21，勿强行拆）

| 组 | 行数 | 说明 |
|---|---|---|
| bundle-install/index.vue ↔ use-bundle-install.ts return | 40 | composable 返回对象与 <script setup> 解构清单，结构上必须一一对应，属框架惯例 |
| install/index.vue ↔ use-install.ts return | 34 | 同上 |
| card/index.vue ↔ row/index.vue 版本选择 el-select | 11 | 两处 v-if 条件与 class 不同，抽组件得不偿失 |
| bundle-install/index.scss ↔ bundle-uninstall/index.scss bulk-row 片段 | 14 | 两弹窗用不同 CSS 变量体系（--bundle-color vs --bundle-uninstall-primary），抽 mixin 需参数化 |
| commands.ts install/uninstall 的 installed 守卫 | 6 | 语义相反（.already-installed vs .not-installed），已是共享 helper 的两个不同分支 |


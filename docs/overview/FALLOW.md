# fallow 使用与豁免清单

> Rust 版 TS 静态分析工具，用于死代码/重复/复杂度体检。本文档记录用法、基线数据与**误报豁免决策**
> （fallow 不认识 koishi 生态，部分报告必须人工豁免，**不要当死代码删**）。

## 1. 为什么用 npx 跑

fallow **不是 npm 依赖**。本项目挂在宿主 koishi-app（yarn4 workspace）下，本地安装会破坏宿主 yarn.lock。
统一用 `npx --yes fallow` 运行（当前 3.17.0）。配置 `.fallowrc.jsonc` 已提交，
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
> `MarketDiskCache.conditionalHeaders` 用 JSDoc `@public` 豁免 Pick 分发误报。

## 5. 误报豁免清单（勿当死代码删）

- **DataService 框架回调**：`src/node/providers.ts` ×3（DependencyProvider/RegistryProvider/RegistryStatusProvider
  的 `get`）、`market.service.ts`、`data-store.ts` 的 `override async get()`——Koishi Console 框架
  在 refresh 时反射调用，fallow 不认识 koishi。
- **多态可选方法**：`market.service.ts probeInBackground`——`idle-probe.ts` 经
  `ctx.console.services.market?.probeInBackground?.()` 可选链调用。
- **命名遮蔽**：node 层 `MarketProvider`（market.service.ts）继承并遮蔽 shared/provider.ts 同名基类——
  有意的插件模式（`ctx.plugin(MarketProvider)`），不改名。
- **Pick 接口分发**：`MarketDiskCache.conditionalHeaders`（cache-store.ts）——经 fetch-index 的
  `Pick<MarketDiskCache, ...>` 分发后被 fetch-endpoint 消费，fallow 穿透不了 Pick，已用
  JSDoc `@public` 标注豁免（`fallow-ignore-next-line` 需附 issue kind，不如 `@public` 直观）。
- **dev_dependencies_in_production**（vue/@koishijs/client/@vueuse/core 放 devDeps）——koishi 生态惯例：
  运行时由宿主 console 提供，vite external，对齐官方插件放 devDeps，忽略。

若想让报告彻底归零：用行内 `fallow-ignore-next-line <issue-kind>` 注释或 JSDoc `@public` 标注上述位置即可。

## 6. 复杂度复查（health，2026-08-21）

- 总分：**70 B → 88 A**（+18）；扣分项：unit size -10.0、coupling -2.3
- unit_size 超阈值函数：347 → 336
- filters.validate 表驱动重构后圈复杂度从 46 大幅下降（语义 1:1，见 client/market/utils/filters.test.ts）；
  orchestrator run 的收尾/重载判定抽为私有方法后主闭包复杂度显著下降。
- hotspots 报告需另行开启对应分析 flag，本仓库不强制。

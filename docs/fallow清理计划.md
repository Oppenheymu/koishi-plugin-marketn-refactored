# fallow unused/duplicates 清理计划

> 状态：**已完成**（2026-08-23 执行，提交 `feat: 清理 fallow unused 导出并解除 lookup/state 循环依赖`）。
> 依据：2026-08-23 fallow 3.17 报告（19 issues：7 exports + 9 types + 2 unresolved + 1 circular + 3 dupes）。**只处理 unused/duplicates，不动 health/hotspot/complexity**（那些是重构建议，不是死代码）。

## 0. 前置

- 门禁：`yarn check`（提交前必跑）
- 全程简体中文提交信息
- **不要跑 `fallow fix --dry-run` 自动删**（会误删契约面 re-export 和测试 helpers）
- 每项先 grep 确认再动手

## 1. 甄别原则（先分类，别照单全删）

| 类别 | 处理 |
|---|---|
| `__tests__/helpers.ts` 导出（MIRROR_NPM/makeRegistryStatsPolicy/isHttpStatusError/createLoggerMock） | **假阳性**——被测试文件引用，fallow 没把测试算进 entry。grep 确认有引用则不动 |
| `index.ts` re-export 类型（MarketNextConfig/MarketNextConfigPatch/MarketNextDataStore/UpdateIgnoreOptions/UpdateIgnoreRule/AvatarCandidate/MarketConfig/LogLine） | **契约面**——被外部按名消费，保留。若删除 frontendMode 后确无消费者可去 export，逐项 grep 确认 |
| 组件内未使用导出（versionMeta/identityMap re-export/findBundleOrigin） | **需 grep 确认**——可能被 .vue 模板用（fallow 盲区） |
| 循环依赖（lookup.ts ↔ state.ts） | **真问题**，修（见 §3） |
| unresolved imports（config 测试 2 处） | **真问题**，修（见 §4） |
| 3 组 dupes | 见 §5 |

## 2. 逐项核对清单（执行时逐条 grep）

1. `src/core/registry/client/__tests__/helpers.ts`：`MIRROR_NPM`/`makeRegistryStatsPolicy`/`isHttpStatusError` —— grep 测试内引用，有则留
2. `src/node/market/__tests__/helpers.ts`：`createLoggerMock` —— 同上
3. `client/dialogs/bundle-install/bundle-format.ts`：`versionMeta` —— grep .vue 模板，无引用才去 export
4. `client/pages/dependencies/use-package-card-meta.ts`：`identityMap` —— 同上
5. `client/pages/dependencies/use-package-card-state.ts`：`findBundleOrigin` —— 同上
6. `client/shared/plugin-config/index.ts` 5 个 re-export type —— 契约面，**默认保留**；若 grep 确认无消费者才去
7. `client/market/avatar/index.ts` `AvatarCandidate`、`client/market/utils.ts` `MarketConfig`、`client/shared/operations/index.ts` `LogLine`、`use-dependency-groups.ts` `DependencyGroup` —— 同上

## 3. 循环依赖（唯一真结构问题）

- `client/market/lookup.ts ↔ state.ts`：把 state 里被 lookup 用的纯函数（如 `getCurrentSnapshotData`）下沉到 `snapshot-utils.ts`（已存在），lookup 从那里导入，切断 state→lookup 环
- 低风险，动 2-3 个文件

## 4. unresolved imports（2 处，config 测试）

- `src/node/config/__tests__/index.test.ts:39-40`：`../market/index.js`、`../locales/generated.js` 路径失效
- 先跑 `yarn test src/node/config` 确认是否真挂；挂则改正确相对路径，不挂（有 fallback）也修正路径

## 5. dupes（3 组，全为视觉对称，**建议不处理**）

| 组 | 内容 | 判断 |
|---|---|---|
| `extensions/version/index.scss` ↔ `package-scoped.scss:370-394` | 25 行样式 | 视觉有意重复，不处理 |
| `bundle-install/index.vue:97-120` ↔ `206-229` | 24 行模板（必装/可选成员对称） | 模板对称，之前已论证不做 |
| `bundle-install/index.scss:312-370` ↔ `package.scss:20-34` | 59 行样式 | 视觉有意重复，不处理 |

## 6. 验证与提交

1. 按 §3→§4→§2 顺序处理；每步 `yarn check`
2. 全局 grep 确认无残留引用
3. 提交（简体中文）：
   - `chore: 清理 fallow unused 导出与循环依赖（lookup/state 解环）`
   - dupes 不提交（明确不处理）
4. 若删除 frontendMode 的改动还没提交，先提交那个，再提交本清理

## 7. 新对话速查

- 仓库：`c:\Dev\Bot-Dev\koishi-app\external\marketn-refactored`（主分支）
- fallow 命令：`yarn.CMD fallow`
- 关键 grep：`MIRROR_NPM|makeRegistryStatsPolicy|isHttpStatusError|createLoggerMock|versionMeta|identityMap|findBundleOrigin`

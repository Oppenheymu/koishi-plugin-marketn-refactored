# P4 设计：client 移植与拆分

> 状态：**设计定稿，待实现**。移植底册：[client端全量结构.md](../reference/client端全量结构.md)（旧 client 全量结构，逐文件职责）；构建链路：[构建与宿主接线.md](../reference/构建与宿主接线.md)。原则：组件结构重组、逻辑成块移植不发明、`<script setup lang="ts">` 全维持、样式出仓、逻辑下沉 composable/lib。

## 1. 目标与范围

- 把 `Waiting_refactored/client/`（26 个 vue，9 个超行数预算）移植重组为 feature-first 的 `client/`（~38 文件，全部达标）。
- 对 Console 的挂载点保持不变：/market 与 /dependencies 页面、global slots ×6、welcome-choice/status-right/plugin-dependency/plugin-details/plugin-missing/plugin-select slots、actions/menus、config.tree.remove patch。
- 消费的后端通道/RPC/广播不变（契约文档 §1.4/§2）。

**砍除**（连带依赖删除）：

- 三处彩蛋：April Fools/Koishi Day 图标逻辑（Alt+G→Alt+B 炸弹图标）、恋恋秘密档案（market-secret-archive + koishi-eye-splash + lottie JSON）、market-list 列表尾彩蛋；
- `lottie-web` 依赖与 `client/icons` 的 bomb/koishi 图标；
- market/locales 中无人加载的 5 种语言不引入（zh-CN/en-US 保留）。

## 2. 目标结构

```
client/
├── index.ts                 入口（页面/slots/actions/menus 注册，~150）
├── bootstrap/               store 同步（receive 处理器 ×5、markRaw、sweep 定时器）
│   └── store-sync.ts
├── slots.ts                 global/welcome-choice/status-right slot 注册
├── actions.ts               ctx.action / ctx.menu
├── lib/                     原 client/utils.ts(429) + components/utils.ts(531) 拆为 ~10 文件各 ≤150：
│   ├── market-config.ts     getMarketNextConfig / patchMarketNextConfig / 模式判定
│   ├── data-store.ts        getPendingOverrides / getBundleRecords / patchMarketNextData
│   ├── update-policy.ts     更新忽略规则（createUpdateIgnoreRule/isUpdateIgnored/…）
│   ├── silent-rules.ts      marketSilentRules ↔ 过滤 token 互转
│   ├── install-flow.ts      install() 主流程 + installProgressState 进度单例
│   ├── config-writer.ts     getConfigWriter / ensureInstalledConfig(s)
│   ├── bundle-records.ts    bundle 记录读写与解析
│   ├── registry-status.ts   getRegistryStatus(Text) + sweep 逻辑
│   ├── dialogs.ts           全局对话框 refs（active/activeBundle/showConfirm/…）
│   └── analyze-versions.ts  peer 依赖兼容性分析 + manualDeps/addManual
├── pages/
│   ├── market/              index.vue(~280) debug-panel.vue use-route-sync.ts
│   └── dependencies/        index.vue toolbar.vue group-section.vue
│                           useClassify.ts use-groups.ts
├── dialogs/
│   ├── install/             index.vue peer-table.vue use-install.ts
│   ├── bundle-install/      index.vue member-row.vue diff-panel.vue use-bundle-install.ts
│   ├── confirm.vue  install-progress.vue  manual.vue  local-package-upload.vue
│   ├── install-history/     index.vue detail.vue
│   ├── environment-versions/ index.vue diff-list.vue
│   └── bundle-uninstall/    index.vue use-uninstall.ts
├── components/
│   └── dependency-card/     card.vue row.vue ignore-dialog.vue binding-dialog.vue
│                           use-card.ts use-ignore-update.ts
├── market/                  已拆好的结构保留，继续细化：
│   ├── utils/               avatars.ts search-index.ts filters.ts sort.ts badges.ts categories.ts
│   ├── state/               snapshot.ts lookup.ts
│   └── components/          filter.vue 拆 filter-panel + date-filter + use-filter
│                           package.vue 拆 card.vue + use-avatar；list.vue 抽 use-virtual-scroll
├── extensions/              多数达标原样移植；config-remove patch / dependency / dep-link /
│                           missing / select / version 保留
├── styles/                  各 SFC 抽出的 .scss 按目录集中（~12 文件）
├── i18n/                    zh-CN + en-US（8 文件 ×2）+ i18n-runtime guard
└── icons/                   activity:deps / activity:market / refresh / rocket / upload（去彩蛋图标）
```

## 3. 关键设计决策

### 3.1 lib 单向依赖

`pages → dialogs → lib`、`extensions → lib`、`market → lib`（仅 market-config/dialogs 等少数）。禁止 lib 反向 import 组件；禁止 pages 互相 import。check-size 已预留方向校验能力，P4 收尾时把禁 import 方向加进去（计划第 6 节）。

### 3.2 全局单例的处置（旧耦合点，结构化保留）

旧代码用模块级 ref/ reactive 充当全局 store，P4 **保留模式但收拢到 lib**：

- `lib/dialogs.ts`：`active`（安装面板目标）、`activeBundle`、`showConfirm`、`showManual`、`showInstallHistory`、`showEnvironmentVersions`、`expandedDependency`、`pendingBundleUninstalls`——集中一处，禁止散落；
- `lib/install-flow.ts`：`installProgressState`（跨组件可变单例，dialogs 写、install-progress 读）+ `receive('market/install-log')` 注册。

### 3.3 store 同步（bootstrap/store-sync.ts）

旧 index.ts 顶层的三个 receive + watch 全部收拢：`market/registry` 合并、`market/registry-status` 合并 + sweep（120s 超时/15s 轮询）、`market/registry-status/clear`；`store.market.data` 的 `markRaw(toRaw())`（防市场索引被深度代理）与 `restoreMarketSnapshot()` 回填。

### 3.4 market 模块

现有 `market/`（state/utils/components 分离）已是好结构，原样移植后继续细化（见目标结构）。`market/state.ts` 的快照链保持：`market/index` RPC 优先 `http-gzip` transport → fetch(url, force-cache) → 失败降级 inline；superseded 竞态检测（dataVersion 比对，最多重试 3 次）。

### 3.5 i18n

namespace `marketNext`；静态 import zh-CN/en-US（构建期打包）；**i18n-runtime guard 保留**（monkey-patch `setLocaleMessage`，老版本 bundle 恢复 locale 快照时自动重新合并本插件 namespace，`Symbol.for` 全局注册表防多实例）——这是与官方 Console 共存的兼容机制，勿简化。

### 3.6 样式出仓

每个 SFC：`<style scoped src="./x.scss" lang="scss">`，.scss 放同目录或就近 `styles/`。全局样式（scrollbars/version-select 主题覆盖/对话框全局样式）保持顶层 import。行数预算只计 template+script（check-size 口径），样式不占预算但仍需可维护。

## 4. 移植对照速查

| 旧（client端全量结构.md） | 新 |
|---|---|
| index.ts 420 行入口 | index.ts + bootstrap/store-sync.ts + slots.ts + actions.ts |
| client/utils.ts 429 | lib/ ×5（market-config/data-store/update-policy/silent-rules + dialogs） |
| components/utils.ts 531 | lib/ ×5（install-flow/config-writer/bundle-records/registry-status/analyze-versions） |
| components/package.vue 1698 | components/dependency-card/（card+row+ignore-dialog+binding-dialog+use-card+use-ignore-update，样式出仓） |
| components/bundle-install.vue 1386 | dialogs/bundle-install/ |
| components/dependencies.vue 1193 | pages/dependencies/ |
| components/market.vue 1060 | pages/market/（debug 卡独立 debug-panel.vue） |
| components/install.vue 733 等对话框 | dialogs/* |
| market/ 已分离结构 | market/ 继续细化（filter/package 拆分、虚拟滚动抽出） |
| extensions/ | 原样移植（version.vue 232 行达标保留） |
| 彩蛋 ×3 + lottie + 5 语言 | **砍除** |

## 5. 门禁与验收

**每步收尾**：

```bash
tsc --noEmit -p client/tsconfig.json   # client 独立类型检查
eslint "client/**/*.vue"
node scripts/check-size.mjs
```

**阶段完成**：`yarn check` 全量恢复可用（biome + tsc×2 + eslint + check-size）；`yarn build:client` 产出 `dist/index.js` + `dist/style.css`（CSS 产物名必须是 style.css，prod console 只探测它）。

**完成后**：生成 `docs/handover/P4交接P5.md`，更新 [路线图.md](../overview/路线图.md) 状态。

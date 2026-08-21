# client 端结构规范（现状）

> 状态：现状文档。对象是重构后的新 `client/`（feature-first 重组，2026-08 完成）。旧 client 的考据见 [reference/client端全量结构.md](../reference/client端全量结构.md)。改动 client 目录结构前先读本文。

## 1. 设计原则

1. **Feature-first**：按功能（而非按类型）组织；一个功能 = 一个目录，入口统一 `index.*`。
2. **同层不摊平**：同级目录只允许出现入口（`index.*`）与工程文件（`env.d.ts`、`tsconfig.json` 等）；其余组件 / composable / 样式 / 逻辑一律按角色进子目录（`components/` `composables/` `state/` `utils/`…）。
3. **共享才上提**：跨多个 feature 消费的才进 `shared/`；单消费者放消费者所在 feature。
4. **就近原则**：样式（`index.scss`）、测试（`*.test.ts`）、composable（`use-*.ts`）与所属组件同目录。
5. **逻辑分层**：纯函数（不 import vue）放 `utils/`；Vue 状态 / 副作用放 `composables/` 或组件内 `use-*.ts`。
6. **命名**：目录与文件名一律 kebab-case（`use-classify.ts`，不是 `useClassify.ts`）；组件内部导出名 PascalCase；composable 函数名 `useXxx`。
7. **i18n 单树**：所有命名空间集中在 `i18n/<locale>/<namespace>.yml`，统一由 `i18n/index.ts` 引入合并。
8. **依赖方向**：`shared/` 不得引用 pages/dialogs/extensions/market；feature 之间通过 `shared/` 通信。

## 2. 目录总览

```
client/
├── index.ts                  # 入口：注册 i18n / 页面 / 扩展 / actions / slots
├── slots.ts                  # 全局 slot 挂载（welcome-choice、global×6、status-right）
├── actions.ts                # ctx.action / ctx.menu
├── env.d.ts / vue-compat.d.ts / tsconfig.json
│
├── i18n/                     # 单一 locale 树（zh-CN / en-US 各 9 个命名空间）
│   ├── index.ts              # marketNext 命名空间注册 + guard
│   ├── runtime.ts            # ensureLocaleNamespace / installLocaleNamespaceGuard
│   └── {en-US,zh-CN}/        # common market market-page dependencies operations dependency-card extensions bundle environment
│
├── icons/                    # 全局 Koishi 图标注册（activity:*、refresh、rocket、market-next:upload）
│   └── index.ts + activity/ + market/
│
├── styles/                   # 全局样式（scrollbars.scss、version-select.scss）
│
├── shared/                   # 跨功能共享层（禁止引用下层 feature）
│   ├── ui/                   # dialogs.ts（全局对话框 ref 状态）、page-boundary.ts、progress.vue
│   ├── config/               # market-config.ts、data-store.ts、silent-rules.ts、update-policy.ts
│   ├── install/              # install-flow.ts、config-writer.ts、analyze-versions.ts、registry-status.ts、bundle-records.ts
│   └── sync/                 # store-sync.ts（store ↔ 快照双向同步、registry 广播监听）
│
├── market/                   # 市场 feature（自包含领域）
│   ├── index.ts              # 对外门面：MarketIcon / MarketFilter / MarketList / MarketSearch / utils
│   ├── state/                # snapshot.ts（市场索引快照）、lookup.ts（按需查找）
│   ├── utils/                # 纯函数：filters(.test) search-index sort badges categories（不 import vue）
│   ├── avatar/               # 头像域：avatars.ts（候选链/缓存/抓取）+ use-avatar.ts（composable）
│   ├── components/           # filter/ list/ package/ search/（各含 index.vue + index.scss + 就近 use-*.ts）
│   └── icons/                # MarketIcon 分类图标（misc / outline / solid）
│
├── pages/
│   ├── market/               # index.vue+scss、components/debug-panel/、composables/use-route-sync.ts
│   └── dependencies/         # index.vue+scss、toolbar/、group-section/、dependency-card/、composables/use-classify.ts + use-groups.ts
│
├── dialogs/                  # 全局浮层层（被多个页面/扩展消费，保持独立）
│   ├── install/  bundle-install/  bundle-uninstall/  confirm/  install-progress/
│   ├── install-history/  environment-versions/  manual/  local-package-upload/
│   └── （每个目录 = index.vue + index.scss + use-*.ts + 局部组件）
│
└── extensions/               # 控制台其他页面的扩展注入（全部目录化）
    ├── index.ts              # 注册入口（config.tree patch + 各 slot）
    └── bundle-group-uninstall/  config-remove/  version/  dep-link/  dependency/  missing/  select/
```

## 3. 新文件放哪（决策表）

| 要加的东西 | 放哪 |
|---|---|
| 新页面 | `pages/<page>/`，含 index.vue + index.scss |
| 页面内子组件 | `pages/<page>/components/<name>/{index.vue,index.scss}` |
| 页面级 composable | `pages/<page>/composables/use-*.ts` |
| 全局浮层（多页面复用） | `dialogs/<name>/`（index.vue + index.scss + use-*.ts） |
| 控制台其他页面扩展 | `extensions/<name>/`（index.vue；有逻辑加 index.ts，有样式加 index.scss） |
| 市场领域纯函数 | `market/utils/<kebab>.ts`（不得 import vue） |
| 市场领域 Vue 状态/副作用 | 所属组件目录 `use-*.ts`，或 `market/<domain>/`（如 avatar/） |
| 跨 feature 共享状态/逻辑 | `shared/<域>/{ui,config,install,sync}/` |
| 新 i18n 文案 | `i18n/{en-US,zh-CN}/<namespace>.yml`，并在 `i18n/index.ts` 引入 |
| 全局 Koishi 图标 | `icons/`（index.ts 注册） |
| feature 内部图标 | `market/icons/`（MarketIcon 映射） |
| 单消费者逻辑 | 直接放消费者目录，不要放 shared/ |

## 4. 命名与结构约定

- 目录名 / 文件名：kebab-case；入口统一 `index.*`；样式与组件同目录同名（`index.scss`）。
- composable：`use-<kebab>.ts`，导出 `useXxx`。
- 测试：`*.test.ts` 与源文件同目录（如 `market/utils/filters.test.ts`）。
- 一个目录只放一件事：禁止「目录式 + 平铺式」混在同一层。
- 工程文件（env.d.ts、tsconfig.json）允许在 client 根平铺；其余一律进子目录。

## 5. 变更纪律

- 改 `client/` 内 import 路径后必须跑 `yarn build:client`：**tsc 不编译 .vue，.vue 的 import 错误只有 vite build 能抓**（历史踩坑，见 handover/P4交接P5.md §3）。
- 门禁：`yarn ts7 --noEmit`、`yarn ts7 --noEmit -p client/tsconfig.json`、`yarn eslint "client/**/*.vue"`、`node scripts/check-size.ts`、`yarn build:client`、`yarn test`。
- biome 只查 `src/**`（见 biome.json files.includes），client 归 eslint 管。
- 对外契约（页面 id/路径、action/menu id、slot 类型、`marketNext` i18n key、图标注册名、dist 产物 `style.css`）变更需先改 reference/前后端调用契约.md。

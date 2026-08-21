# P4 client 移植 · 子任务执行指南

> 本指南给负责 P4 各子任务的子 agent 使用。目标：把 Waiting_refactored/client/ 的旧代码「逻辑成块移植不发明」，重组为 feature-first 的 client/。旧代码只读，绝不修改。

## 1. 必读文档
- docs/design/P4-client移植设计.md —— 目标结构、拆分方案、砍除清单（权威）。
- docs/reference/client端全量结构.md —— 旧 client 逐文件职责底册。
- docs/reference/前后端调用契约.md §1.4/§2 —— client 实际 import 的符号与 RPC/广播清单。

## 2. 核心原则
1. 逻辑成块移植不发明：函数体、computed、watch、模板结构逐字保留。只改目录、文件拆分、import 路径、砍除彩蛋。
2. <script setup lang="ts"> 全维持，不改普通 script。
3. 样式出仓：每个 .vue 的 style 抽到同目录同名 .scss，.vue 里写 <style scoped src="./x.scss" lang="scss"></style>。全局样式保持顶层 import。
4. 行数预算：.ts/.vue（vue 只算 template+script）<=400 必须，目标 <=200，>300 警告可接受但应拆分。超过 400 直接 fail。

## 3. 目录拆分（按设计文档 §2）
- lib/ 10 个文件（见 §4 精确导出面）。
- pages/market/（index.vue + debug-panel.vue + use-route-sync.ts）、pages/dependencies/（index.vue + toolbar.vue + group-section.vue + useClassify.ts + use-groups.ts）。
- dialogs/install/（index.vue + peer-table.vue + use-install.ts）、dialogs/bundle-install/（index.vue + member-row.vue + diff-panel.vue + use-bundle-install.ts）、dialogs/install-history/（index.vue + detail.vue）、dialogs/environment-versions/（index.vue + diff-list.vue）、dialogs/bundle-uninstall/（index.vue + use-uninstall.ts）、平级 confirm.vue / install-progress.vue / manual.vue / local-package-upload.vue。
- components/dependency-card/（card.vue + row.vue + ignore-dialog.vue + binding-dialog.vue + use-card.ts + use-ignore-update.ts）——由旧 package.vue 拆出。
- market/ 已复制 icons/ 与 locales/；utils.ts(863) 拆 utils/{avatars,search-index,filters,sort,badges,categories}.ts；state.ts(306) 拆 state/{snapshot,lookup}.ts；components/filter.vue 拆 filter-panel + date-filter + use-filter；components/package.vue 拆 card.vue + use-avatar；components/list.vue 抽 use-virtual-scroll。
- extensions/、icons/、composables/ 原样移植（去彩蛋）。

## 4. import 路径约定（必须遵守）
- node 端类型（InstallHistory*、Environment*、LocalPackageUpload*、LocalBindingResult、InstallFallbackCandidate、InstallOptions、RegistryStatus、PluginBundleRecord、PluginBundleManifest、MarketProvider.Payload 等）：import type { X } from "koishi-plugin-marketn-refactored"（type-only，会被擦除）。
- shared 类型/函数（bundle/dependency-source/update 三模块）：相对路径 import { X } from "../../src/shared/bundle" 等。相对深度：client/lib/、client/pages/x/、client/dialogs/x/、client/market/、client/extensions/、client/components/x/ 都是 ../../src/shared/<mod>；client/index.ts 是 ../src/shared/<mod>。
  - 运行时只 import 纯模块 src/shared/bundle、dependency-source、update。
  - 不要运行时 import src/shared（index）——它含 provider.ts 会拉入 @koishijs/console/koishi。market/state.ts 对 index 的 import 必须是 import type。
- lib 内部互相 import { X } from "./data-store"。
- i18n：import { translate } from "../i18n"；import { useMarketNextI18n, registerMarketNextI18n } from "../i18n"。
- @koishijs/client 可用：Context, Dict, global, message, loading, receive, router, send, socket, store, useConfig, useContext, useRpc, useMenu, useRouter, Awaitable, valueMap, remove, omit, Intersect, Pick, Schema, useI18nText, SchemaBase, icons, messageBox 等（re-export 了 cosmokit + @koishijs/components + vue-i18n）。
- @koishijs/registry：SearchObject, Registry, RemotePackage, User, Manifest, DependencyMetaKey（类型）。
- vue：ref, reactive, computed, watch, shallowRef, markRaw, toRaw, isReactive, h, defineComponent, resolveComponent, inject, provide, onMounted, onUnmounted, onErrorCaptured, nextTick, watchEffect 等。
- semver：gt, compare, satisfies, valid, prerelease（依赖，可打包）。

## 5. lib/ 精确导出面（其他模块依赖，务必一致）
- dialogs.ts：active(ref)、showManual、showConfirm、showInstallHistory、showEnvironmentVersions、expandedDependency、activeBundle(ref)、pendingBundleUninstalls、type BundleMemberCleanupTarget。
- data-store.ts：type MarketNextDataStore、getPendingOverrides、getCollapsedGroups、getBundleRecords、getWritableBundleRecords、patchMarketNextData。
- market-config.ts：types FrontendMode/LayoutMode/UpdatePolicy/UpdateIgnoreOptions/MarketNextConfigPatch/SilentConfig + MarketSilent* 五个；函数 getMarketNextConfig、getFrontendMode、getDepsLayout、getBulkMode、getRemoveConfig、normalizeFrontendMode、patchMarketNextConfig、getMarketNextPolicy、getWritableMarketNextPolicy。
- silent-rules.ts：getMarketSilentFilters、getMarketSilentRules、rulesToSilentFilters、ruleToSilentFilter。
- update-policy.ts：createUpdateIgnoreRule、getLatestVersion、getIgnoredUpdateVersion、getUpdateIgnoreText、isUpdateIgnored、hasUpdate、isUpdateCheckDisabled；export type { IgnoredUpdates, UpdateIgnoreRule }。
- install-flow.ts：MARKET_NEXT_PACKAGE、installProgressState、install、applyEnvironmentSnapshot、pushInstallLog、resetInstallFallbackState、prepareInstallFallbackRetry、types LogLine/InstallFallbackCandidate/InstallOptions/InstallMessages；在此注册 receive("market/install-log")。
- config-writer.ts：type ClientConfigWriter、getConfigWriter、ensureInstalledConfig、ensureInstalledConfigs。
- bundle-records.ts：type BundleRecordView、createBundleRecordFromManifest、createLocalBundleRecord、resolveBundlePackageFromGroup、resolveBundleRecordFromGroup、isBundleGroupPath、getBundleMemberConfigState、fetchBundleRecord。
- registry-status.ts：getRegistryStatus、getRegistryStatusText、formatEndpoint。
- analyze-versions.ts：type ResultType/PeerInfo/AnalyzeResult、analyzeVersions、manualDeps、addManual。
> 逻辑来源：Waiting_refactored/client/utils.ts 与 components/utils.ts。函数体逐字搬，只改 import 与归属文件。

## 6. 严格 TS（硬约束）
1. verbatimModuleSyntax：类型导入必须 import type；重导出类型 export type { }。
2. noUncheckedIndexedAccess：Dict<string>[k] 返回 string|undefined；hasOwn 后加 !。
3. exactOptionalPropertyTypes：可选属性不能赋 undefined（用 ?? undefined 或类型加 | undefined）。
4. erasableSyntaxOnly：禁参数属性、禁带运行时成员的 enum/namespace。
5. noUnusedLocals/noUnusedParameters：未用参数改名 _x 或删除（旧代码很多 config? 未用参数）。
6. noImplicitOverride：重写基类方法加 override。
7. noPropertyAccessFromIndexSignature：Record<string,unknown> 用 obj[key]。
8. 无 default export（Vue 组件除外，<script setup> 无需 export；.ts 用命名导出）。

## 7. 砍除清单（必须执行）
- 彩蛋 1：market-secret-archive.vue + koishi-eye-splash.vue + koishi-eye-splash.json（恋恋秘密档案）删除；market.vue 里 secretSearchMatched/recordedAt 相关删除。
- 彩蛋 2：April Fools / Koishi Day 图标（isAprilFoolsDay/isKoishiDay/forcedAprilFoolsIcon、Alt+G 到 Alt+B、bomb/koishi 图标切换）删除；menu dependencies 的 .upgrade 图标固定 rocket；icons/market/bomb.vue 已不复制。
- 彩蛋 3：market-list 列表尾 "market end" koishi 图标小彩蛋删除。
- lottie-web 依赖、bomb/koishi 图标注册。
- market/locales 5 种语言不引入（已只复制 zh-CN/en-US）。

## 8. 自检
每完成一个子目录，在仓库根跑：npx tsc --noEmit -p client/tsconfig.json（只看自己目录报错，其他目录未完成属正常）和 node scripts/check-size.mjs（看自己产出是否超限）。

## 9. 常见坑
- 旧 components/package.vue 里「全局对话框样式(913-1068)」要随拆分归到对应对话框文件，不要丢。
- store.market 是 DataService payload，data 字段 markRaw 防深度代理（market/state.ts publishSnapshot）。
- installProgressState 是跨组件可变单例（install-flow.ts 定义、dialogs 写、install-progress 读）。
- active/activeBundle/showConfirm 等 6 个 ref 是模块级 ref 充当全局对话框 store，收拢在 lib/dialogs.ts。
# P3 设计：src/node Koishi 适配层

> 状态：**实现进行中**（并行会话）。实际落地采用扁平文件结构（`contracts.ts` 单文件、`config.ts`/`config-manage.ts`、`avatar.ts`、`bundle.ts`、`locales-schema.ts`/`locales-message.ts` 等，不设 config/、contracts/、avatar/、bundle/ 子目录）——本文的目标结构与命名是设计意图，**文件组织以实现为准**，职责边界与接线约定仍然有效。P3 收尾时回填差异。各 core 入口类的构造 deps 精确签名见 [handover/P2交接P3.md](../handover/P2交接P3.md) §4，本文不重复罗列，只讲组装方式。

## 1. 目标与范围

- 实现 `src/node/`（当前是 2 行占位），替换为真实 node 入口。
- 保持对外契约面不变：DataService ×5、RPC listener ×23、广播 ×5、HTTP ×1、命令 ×4、`ctx.installer` public 签名、导出面。验收基线：[前后端调用契约.md](../reference/前后端调用契约.md)。
- `apply(ctx, config)` 变薄接线（<120 行），编排顺序与旧代码一致。

**不做**：业务逻辑修改（除非发现 core bug）、client、宿主联调（P5）、browser 入口（已砍，同时删 package.json exports 相关分支与 tsdown browser entry 的残留——P0 已删）。

## 2. 目标结构

```
src/node/
├── index.ts              薄接线（<120 行）
├── config/
│   ├── schema.ts         Config Schema 完整结构
│   ├── patch.ts          configPatchKeys 白名单 + 写回 loader 配置
│   └── plugin-config.ts  ensurePluginConfigs / 插件配置修复
├── installer.service.ts  Installer 服务门面（ctx.installer，public 签名不变）
├── market.service.ts     MarketProvider 的 node 实现（DataService 'market'）
├── providers.ts          Dependency/Registry/RegistryStatus 三个 DataService
├── data-store.ts         MarketDataStore（channel 'marketData' + migrateFromConfig）
├── contracts/            zod schema ×23（可按 install/market/data 拆三文件）
├── listeners/            install.ts market.ts data.ts（注册 + 校验 + 转发）
├── commands.ts           4 个命令
├── avatar/               fetch.ts（内存+磁盘缓存） ssrf.ts disk-cache.ts
├── route.ts              GET {uiPath}/market-next/snapshot/:id
├── snapshot-transport.ts inline / http-gzip 双传输
├── bundle/               groups.ts install.ts remove.ts
└── idle-probe.ts         空闲探测调度
```

## 3. 关键设计

### 3.1 契约层（contracts/）

23 个 RPC 事件的入参全部用 zod schema 定义，listener 边界统一 `schema.parse()` 校验后再转发给服务方法。契约即代码、即文档。分组：

- `install.ts`：install、install-bundle、install-fallback-candidate、install-history、install-history-detail、local-package-upload-×5、prepare-local-binding、environment-×3
- `market.ts`：package、index、lookup、registry、avatar、refresh
- `data.ts`：remove-bundle-configs、update-config、update-data、refresh-dependencies、ensure-config

### 3.2 Installer 服务门面（installer.service.ts，~250 行）

`ctx.installer` 的全部 public 方法签名保持不变（清单见契约文档 §5）。门面自身**只做三件事**：

1. **构造 core 组件并注入 deps**——按 handover §4 的签名组装 InstallOrchestrator / EnvironmentSnapshotOps / LocalPackageUploadService / InstallLogStore / RegistryClient / PackageCache / DependencyResolver / InstallQueue。
2. **方法转发**——public 方法一行委托对应 core 入口（如 `getInstallHistory` → `getInstallHistory(limit, readerDeps)`）。
3. **Koishi 生命周期接线**：
   - `start()`：载入路由统计、清理日志、重置 endpoint、记录启动环境快照、调度元数据探测；
   - `RequestScope.isActive` ← `ctx.scope.isActive`；
   - `await detect()` 后注入 `agent`（**勿忘 await**，旧 bug 已修，别回退）；
   - 广播节流：`market/registry` 500ms、`market/registry-status` 200ms、`market/patch` 500ms；
   - `fullReload` ← `ctx.loader.fullReload`；`isPackageLoaded` ← `require.resolve` in `require.cache`。

### 3.3 market.service.ts

`MarketProvider extends DataService`（shared 基类）的 node 实现，直接构造 `MarketIndexSource`（deps 映射见 handover §4.7）：

- `collect()` → `source.collect()`；`getSnapshot()` → `source.getSnapshot()`；`probeInBackground(reason)` → `source.probeInBackground(reason)`。
- 磁盘路径：`resolve(ctx.baseDir, 'cache', 'market-next-index.json')` 与 `.../market-next-index/`。

### 3.4 providers.ts + data-store.ts

三个薄 DataService：`DependencyProvider`（channel `dependencies`，值来自 `resolver.getDeps()`）、`RegistryProvider`（`registry`，来自 `PackageCache.flush` 节流广播）、`RegistryStatusProvider`（`registryStatus`，来自 statusSink）。`MarketDataStore`（channel `marketData`，immediate）承载 override/updateIgnored/bundleRecords/collapsedGroups 的持久化（`data/market-next.json`）+ `migrateFromConfig`。

### 3.5 listeners/ 与 commands.ts

23 个 listener 全部 `{ authority: 4 }`，模式统一：`ctx.console.addListener(name, async (…args) => { const input = schema.parse(…) ; return service(input) })`。参数/返回签名逐一对照契约文档 §2.2 表格，不得增减。

4 个命令（契约文档 §3.1）：`plugin.install(.i)`、`plugin.uninstall(.r)`、`plugin.upgrade(.update/.up，-s/-f)`、`plugin.clear-avatar-cache`。前三个走 installer 门面，升级命令含 prompt 确认交互。

### 3.6 avatar/

头像代理：内存 LRU（上限 256）+ 磁盘缓存（`cache/market-next-avatars/`，TTL 24h/10min 失败缓存）+ **SSRF 防护**（私有网段/协议白名单，`ssrf.ts` 独立文件）。

### 3.7 snapshot-transport + route.ts

`market/index` RPC 支持 `transport: 'inline' | 'http-gzip'`：http-gzip 时写 gzip 临时文件，经 `MarketSnapshotTransport` 返回 `{ transport, url, payload, decodedSize, encodedSize }`；`route.ts` 注册 `GET {uiPath}/market-next/snapshot/:id`——gzip 响应、ETag=内容 hash、`Cache-Control: immutable`。

### 3.8 bundle/ 与 idle-probe.ts

- `groups.ts`：bundle 分组的配置树操作（ensurePluginConfigs / removeBundleConfigs / 组内外判定）；
- `install.ts`：`installBundle()`（成员解析 + 冲突检测 + 组装 install 请求）；`remove.ts`：`removeBundleConfigs()`；
- `idle-probe.ts`：空闲探测调度（`idleProbe*` 配置驱动：bootDelay 1min / interval 6h / delay 5min，变更触发插件 reload）。

### 3.9 index.ts 接线顺序（对齐旧 apply）

```
apply(ctx, config)
  ├─ ctx.loader.writable 检查（否则仅告警退出）
  ├─ ctx.plugin(Installer, config.registry)
  ├─ inject(installer) → 注册 4 命令
  └─ inject(console, installer, server)
       ├─ 3 个 Provider + MarketDataStore
       ├─ ctx.plugin(MarketProvider, config.search)
       ├─ ctx.console.addEntry({ dev: client/index.ts, prod: dist })
       ├─ 快照 HTTP 路由
       ├─ 23 个 listener
       └─ ready 钩子（migrateFromConfig / 插件配置修复 / 头像缓存清扫）
```

砍除项在 P3 的体现：**无** chatluna 接线、**无** browser 分支、Config Schema 删除 `chatlunaTool`、legacy `marketSilentFilters` 文本迁移与 deprecated `installLogRetention`（新字段 `installLogRetentionHours` only）。

## 4. Config Schema（config/schema.ts）

完整结构对照契约文档 §3.2（frontendMode/depsLayout/idleProbe*/bulkMode/removeConfig/updateIgnore*/collapsedGroups/registry/search/marketSilentRules 及隐藏字段）。要点：

- `registry` 子配置：endpoint/timeout/autoRoute/retry/concurrency/installLogRetentionHours；
- `search` 子配置：endpoint（默认 `https://registry.koishi.t4wefan.pub/index.json`）/timeout/proxyAgent/autoRoute/logLevel；
- `configPatchKeys` 白名单 + `configReloadKeys`（idleProbe* 变更触发 reload）。

## 5. 执行顺序与门禁

**顺序**：contracts → installer.service → market.service → providers → listeners → commands → avatar → snapshot-transport → bundle → idle-probe → index 接线。

**门禁**（每步收尾跑）：

```bash
tsc --noEmit          # exit 0
yarn build            # tsdown 产出 lib/（宿主加载前提）
# 宿主侧启动加载无报错（P3 阶段 client 未建，console 前端 404 属预期）
```

P4 前禁止跑全量 `yarn check`（client/ 不存在，见开发指南 §2.1）。

## 6. 完成后

生成 `docs/handover/P3交接P4.md`（记录：实际偏差、lib 加载验证结果、留给 P4 的接口注意点），更新 [路线图.md](../overview/路线图.md) 状态。

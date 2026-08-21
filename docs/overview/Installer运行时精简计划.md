# Installer 运行时精简计划

## 目标

当前重构版把旧 Installer 拆成 core 模块后，又保留了一层 Node facade 和一层 wire 组装：

```text
ctx.installer public facade
        ↓
Installer wire / owner callbacks
        ↓
DependencyResolver / RegistryClient / PackageCache
InstallOrchestrator / EnvironmentSnapshotOps / UploadService
```

这不是有效精简。专项目标是删除旧 facade 的兼容职责，让 Node 入口直接依赖一个新 Installer runtime，生产源码净减少 **500～900 行**。

不以保留旧版 `ctx.installer` public 方法为约束。新契约只服务当前仓库的 listener、command、market provider 和插件自身入口。

## 基线

统计范围：`src/core`、`src/node`、`src/shared` 和 `client` 的生产源码；不计测试、文档、`lib`、`dist` 和生成产物。

重点文件当前规模：

| 文件 | 作用 | 问题 |
|---|---|---|
| `src/node/installer/index.ts` | Service、旧 public facade、状态转发 | 324 行，混合生命周期、适配和业务入口 |
| `src/node/installer/wire.ts` | core 对象组装和 owner callback | 约 230 行，与 facade 双重表达依赖关系 |
| `src/node/declarations.ts` | 给 `ctx.installer` 注入完整旧类型 | 放大旧契约传播范围 |
| `src/node/console/listeners/*.ts` | 通过 `ctx.installer` 间接访问 core | 每个入口重复依赖转发方法 |
| `src/node/console/commands.ts` | 通过旧 facade 调用安装能力 | 命令层无法表达真实依赖 |
| `src/node/market/index.ts` | 通过旧 facade 写 registry cache | Market 与 Installer 产生反向适配 |

## 新契约

### InstallerRuntime

新增一个明确的 runtime 类型，但不再同时保留旧 facade 方法。runtime 只组合当前入口确实使用的能力：

```ts
interface InstallerRuntime {
    config: InstallerConfig;
    log: InstallLogger;
    scope: RequestScope;
    registry: RegistryClient;
    packages: PackageCache;
    resolver: DependencyResolver;
    orchestrator: InstallOrchestrator;
    environment: EnvironmentSnapshotOps;
    uploads: LocalPackageUploadService;
    logs: InstallLogStore;
    registryStatus: Dict<RegistryStatus>;
}
```

不允许新增 `InstallerRuntime` 后继续把同一批方法逐个转发到 `Installer`。Node Service 只负责：

- 创建 runtime。
- 注册和清理生命周期。
- 向当前 listener/command/provider 注入 runtime。
- 暴露新版本明确规定的最小 service 入口。

禁止使用 `any`。跨模块类型使用已有接口、`unknown` 和显式 type guard。

### 入口依赖

当前所有入口改为接收 runtime 或其最小能力接口：

```text
registerInstallListeners(ctx, runtime)
registerMarketListeners(ctx, runtime, dataStore, snapshotTransport)
registerUploadListeners(ctx, runtime.uploads)
registerCommands(ctx, runtime)
MarketProvider(ctx, runtime.market dependencies)
```

禁止在新代码中读取 `ctx.installer`。

## 删除清单

### 第一批：删除 facade 转发

从 `src/node/installer/index.ts` 删除这些只转发到 core 的方法和 getter：

- `resolveName`
- `findVersion`
- `getInstallFallbackCandidate`
- `getRegistry`
- `setPackage`
- `getPackage`
- `refreshDependencyMetadata`
- `getDeps`
- `getInstallHistory`
- `getInstallLogDetail`
- `getEnvironmentSnapshots`
- `getEnvironmentSnapshotPreview`
- `exec`
- `override`
- `install`
- 全部 local upload 转发方法
- `applyEnvironmentSnapshot`

这些能力保留在 core runtime 或由 listener 直接使用，不删除实际功能。

### 第二批：删除 owner callback 层

将 `InstallerWireOwner` 改为具体的 runtime dependencies：

- 删除 `refreshData`、`isPackageLoaded`、`drainRegistryStatus` 等 facade 回调。
- registry status 使用单一 `RegistryStatusStore`。
- refresh 使用 `refreshConsole` 或入口自己的明确 callback。
- `createInstallerCore()` 不再接收一个包含大量 owner 方法的门面对象。

如果某个 callback 仍然需要跨生命周期访问，必须保留明确的接口并写出原因，不用通用 facade 恢复旧耦合。

### 第三批：删除旧类型传播

- 删除 `ctx.installer` 的完整旧类型声明。
- 更新 `src/node/declarations.ts`，只声明新 service/runtime 入口。
- 更新所有 listener、command、provider、market provider 调用点。
- 删除只为旧 public API 存在的类型别名和 import。

## 执行顺序

1. 统计专项基线，列出每个旧 facade 方法的调用点。
2. 为新 runtime 写最小类型测试和装配测试。
3. 先迁移 listeners 和 commands，保持行为不变。
4. 迁移 MarketProvider、idle probe 和 providers。
5. 删除 facade 方法、owner callback 和旧 declarations。
6. 删除无调用的 wire helper、兼容类型和旧导出。
7. 逐批运行 TypeScript、相关测试、Biome、client build。
8. 每一批确认生产源码净减少后单独提交。

## 不做的事

- 不删除安装、上传、日志、环境快照、registry 或 market 功能。
- 不为了减少行数把所有 core 类合成一个超大文件。
- 不保留 `InstallerFacade + InstallerRuntime` 两套同名 public 方法。
- 不新增 `any`、动态事件字典或无类型 RPC 代理。
- 不把测试和文档减少计入生产源码收益。

## 验收

功能验收：

- 安装成功/失败、self-update 和 fallback 行为不变。
- 环境快照读取、预览、恢复行为不变。
- 本地上传完整生命周期通过。
- Market registry、market snapshot、registry status 正常。
- 旧版 `ctx.installer` 方法不再作为兼容契约测试目标。

工程验收：

- `yarn ts7 --noEmit`
- `yarn ts7 --noEmit -p client/tsconfig.json`
- `yarn test`
- `yarn check`
- `yarn build`

收益验收只看生产源码总行数、最大文件行数和实际删除内容。专项目标是净减少 500～900 行；如果迁移后净增，则撤销该批次，不以“目录更清晰”算收益。

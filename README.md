# Market Next Refactored

下一代 Koishi 插件市场与依赖管理中心——对 [koishi-plugin-market-next](https://github.com/qinfeng365/koishi-plugin-market-next) 的大爆炸重构。

感谢原作者 *qinfeng365* 提供的初始想法与代码基础。原作者已同意将基于其 AGPL-3.0 许可证开源代码的重构产物使用 MIT 许可证开源。

## 项目状态

重构按 P0–P6 分阶段推进，**当前进度：P3 进行中**。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 工具链基线（tsdown / vite / vitest / biome / check-size 门禁） | ✅ |
| P1 | `src/shared` 平移（bundle / dependency-source / provider / types / update） | ✅ |
| P2 | `src/core` 建设（utils → racing → registry → market → deps → install → upload → environment） | ✅ |
| P3 | `src/node` Koishi 适配层（契约 zod / 服务门面 / listeners / commands） | 🚧 进行中 |
| P4 | `client/` 移植与拆分（feature-first 重组） | ⏳ |
| P5 | 宿主联调（dev + prod 双模式冒烟） | ⏳ |
| P6 | 收尾（契约核对 / 删旧码 / 文档定稿） | ⏳ |

详见 [docs/overview/路线图.md](docs/overview/路线图.md)。

## 快速上手

```bash
yarn install          # 安装依赖
yarn check            # 全量门禁（biome + tsc×2 + eslint + check-size；P4 前 client/ 不存在，用下面三条代替）
yarn build            # tsdown 产出 lib/ + vite 产出 dist/
yarn test             # vitest
```

P3/P4 阶段（client/ 尚未建成）的门禁命令：

```bash
tsc --noEmit
yarn biome check src
node scripts/check-size.mjs
```

宿主联调方式见 [docs/reference/构建与宿主接线.md](docs/reference/构建与宿主接线.md)。

## 文档导航

- [docs/README.md](docs/README.md) — 文档索引
- [docs/overview/架构总览.md](docs/overview/架构总览.md) — 分层架构与依赖规则
- [docs/overview/core层模块参考.md](docs/overview/core层模块参考.md) — core 层 8 个模块的职责与 API
- [docs/overview/开发指南.md](docs/overview/开发指南.md) — 环境、门禁、编码约定、行数预算
- [docs/overview/路线图.md](docs/overview/路线图.md) — P0–P6 阶段计划与状态
- [docs/design/](docs/design/) — P3–P6 设计文档（设计先行）
- [docs/handover/P2交接P3.md](docs/handover/P2交接P3.md) — P2→P3 交接
- [docs/reference/前后端调用契约.md](docs/reference/前后端调用契约.md) — 旧代码对外契约面清单（冻结基线）
- [docs/reference/client端全量结构.md](docs/reference/client端全量结构.md) — 旧 client 全量结构（P4 移植底册）
- [docs/reference/构建与宿主接线.md](docs/reference/构建与宿主接线.md) — 构建链路与宿主集成考据

## 核心原则

1. **结构推倒重来，逻辑移植不发明**——业务逻辑从 `Waiting_refactored/` 成块移植并适配，不重新发明。
2. **设计先行**——未建成的层（P3 node / P4 client）先有设计文档（`docs/design/`），实现按设计落地。
3. **core 层禁 koishi**——`src/core` 不 import koishi 运行时（仅 `import type`），I/O 一律构造注入。
4. **行数预算硬约束**——每文件目标 ≤200 行，>300 警告，≥400 直接 fail（`scripts/check-size.mjs` 强制）。
5. **契约冻结**——对外行为（DataService ×5 / RPC ×23 / 广播 ×5 / HTTP ×1 / 命令 ×4 / 磁盘路径）重构前后保持不变。

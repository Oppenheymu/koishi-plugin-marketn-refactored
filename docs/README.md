# 文档索引

本目录是 `koishi-plugin-marketn-refactored` 的完整文档集。项目遵循**设计先行**原则：已建成的层写"现状文档"（`overview/`），未建成的层写"设计文档"（`design/`），实现按设计落地、落地后回填状态。

按文档类型分四个子目录：

- `overview/` — 现状：ROADMAP、ARCHITECTURE、DEVELOPMENT、CORE-MODULES（随实现更新）
- `design/` — 设计：各阶段开工前写定的目标结构与方案
- `handover/` — 交接：每阶段完成时生成，命名 `P{n}交接P{n+1}.md`
- `reference/` — 考据：旧代码 `Waiting_refactored/` 的探索记录（验收基线，P6 删旧码后唯一参照）

## 阅读路线

**新接手本项目**（按顺序）：

1. [overview/ROADMAP.md](overview/ROADMAP.md) — P0–P6 阶段划分与当前状态（5 分钟了解全局）
2. [overview/ARCHITECTURE.md](overview/ARCHITECTURE.md) — 分层架构、依赖方向规则、各层职责
3. [overview/DEVELOPMENT.md](overview/DEVELOPMENT.md) — 环境搭建、门禁命令、编码约定
4. 按接下来要做的阶段，读对应的 `design/` 文档或 `handover/` 交接文档

**接手 P3（node 适配层）**：

1. [handover/P2交接P3.md](handover/P2交接P3.md) — P2 成果、架构约定、各服务构造 deps 精确签名
2. [design/P3-node适配层设计.md](design/P3-node适配层设计.md) — 目标结构、执行顺序、门禁
3. [reference/前后端调用契约.md](reference/前后端调用契约.md) — 必须保持不变的对外契约面（验收基线）

**接手 P5（宿主联调）**：

1. [handover/P4交接P5.md](handover/P4交接P5.md) — P4 门禁状态、剩余收尾清单、类型接线与 .vue 盲区等关键坑
2. [design/P5-P6-联调验收与收尾.md](design/P5-P6-联调验收与收尾.md) — 冒烟全清单、契约冻结核对表
3. [reference/前后端调用契约.md](reference/前后端调用契约.md) — 必须保持不变的对外契约面（验收基线）

## 文档清单

| 文档 | 类型 | 内容 |
|---|---|---|
| [overview/ROADMAP.md](overview/ROADMAP.md) | 现状 | P0–P6 阶段计划、门禁、当前进度 |
| [overview/ARCHITECTURE.md](overview/ARCHITECTURE.md) | 现状 | 分层架构、依赖方向、core 禁 koishi 规则、各层职责 |
| [overview/CORE-MODULES.md](overview/CORE-MODULES.md) | 现状 | `src/shared` + `src/core` 全部模块的职责、关键导出、注入依赖 |
| [overview/DEVELOPMENT.md](overview/DEVELOPMENT.md) | 现状 | 环境要求、门禁命令、编码约定、行数预算、已知坑 |
| [overview/CLIENT-STRUCTURE.md](overview/CLIENT-STRUCTURE.md) | 现状 | 重构后 client 端目录结构规范：分层、约定、"新文件放哪"决策表、变更纪律 |
| [overview/Installer运行时精简计划.md](overview/Installer运行时精简计划.md) | 计划 | 删除旧 Installer facade、收敛 runtime 依赖与验收规则 |
| [design/P3-node适配层设计.md](design/P3-node适配层设计.md) | 设计 | Koishi 适配层的目标结构、contracts/installer.service/listeners/commands 设计 |
| [design/P4-client移植设计.md](design/P4-client移植设计.md) | 设计 | client feature-first 重组方案、lib 拆分、砍除清单 |
| [design/P5-P6-联调验收与收尾.md](design/P5-P6-联调验收与收尾.md) | 设计 | 宿主联调冒烟清单、契约冻结核对表、收尾事项 |
| [handover/P2交接P3.md](handover/P2交接P3.md) | 交接 | P2 完成时的门禁状态、core 构造 deps 签名、P3 注意事项 |
| [handover/P3进行中交接.md](handover/P3进行中交接.md) | 交接 | P3 实现过程中的架构决策与 tsc 修复记录 |
| [handover/P4交接P5.md](handover/P4交接P5.md) | 交接 | P4 门禁修复全记录、剩余收尾清单、P5 必读坑 |
| [P4-PORTING-GUIDE.md](P4-PORTING-GUIDE.md) | 指南 | P4 子任务执行规范：移植原则、import 约定、严格 TS、砍除清单 |
| [reference/前后端调用契约.md](reference/前后端调用契约.md) | 考据 | 旧代码（`Waiting_refactored/`）对外契约面全量清单 |
| [reference/client端全量结构.md](reference/client端全量结构.md) | 考据 | 旧 client 全量结构（组件/模块/i18n/彩蛋）逐文件说明 |
| [reference/构建与宿主接线.md](reference/构建与宿主接线.md) | 考据 | client 构建加载链路、宿主 workspace 集成、dev/prod 解析机制 |

## 约定

- **考据类文档**（契约面 / client 结构 / 构建接线）是对旧代码 `Waiting_refactored/` 的探索记录，P6 会删除旧码，这些文档是删除后的唯一参照，不随重构更新。
- **设计文档**（`design/`）在对应阶段开工前写定，实现过程中若设计变更，先改文档再改代码。
- **交接文档**（`handover/`）在每个阶段完成时生成，命名 `P{n}交接P{n+1}.md`。

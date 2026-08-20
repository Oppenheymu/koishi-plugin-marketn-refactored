# 架构导读

本仓库（`koishi-plugin-marketn-refactored`）对 [koishi-plugin-market-next](https://github.com/qinfeng365/koishi-plugin-market-next) 做大爆炸重构：结构推倒重来，逻辑从旧代码成块移植不发明。

- **完整架构文档**：[docs/overview/ARCHITECTURE.md](docs/overview/ARCHITECTURE.md)
- **分层一图流**：宿主 Koishi 应用 → `src/node`（适配层）→ `src/core`（领域层，禁 koishi）→ `src/shared`（共享语言层）
- **核心原则**：core 禁 koishi 运行时、I/O 构造注入、契约冻结（DataService ×5 / RPC ×23 / 广播 ×5 / HTTP ×1 / 命令 ×4）
- **更多文档**：[docs/README.md](docs/README.md)（索引）

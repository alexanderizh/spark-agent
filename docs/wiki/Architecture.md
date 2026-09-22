# 运行架构

> 状态: 已落地 | 最后核对: 2026-09-22

## 主链路

```text
React Renderer
  → preload / contextBridge
  → Electron Main / typed IPC
  → @spark/agent-runtime
  → Claude SDK / Codex / spark-engine
  → tools / MCP / Provider / workspace
  → SQLite events + UI timeline
```

### 主要目录

| 目录 | 责任 |
| --- | --- |
| `apps/desktop` | Electron 主进程、preload 和 React renderer |
| `packages/agent-runtime` | 会话、执行器、Provider、MCP、Skills、权限、工作流和团队 |
| `packages/storage` | SQLite/WAL、迁移和 Repository |
| `packages/protocol` / `packages/shared` | IPC、事件、schema、日志和共享辅助 |
| `spark-engine` | turn machine、tool runner、权限、事件、CLI/TUI、serve |
| `apps/website` | 自有官网、下载和面向用户的文档 |

## 安全不变量

- Renderer 不启用 Node integration。
- preload 只暴露最小的 `contextBridge` API。
- 文件、命令、网络、桌面控制和外部工具都经过权限/策略层。
- API key 不写入 SQLite、日志、Issue、Wiki 或 Pages。
- 长任务要有取消、关闭、失败、重试和恢复路径。

完整的启动顺序、数据边界和新功能落位规则见[仓库架构文档](https://github.com/alexanderizh/spark-agent/blob/master/docs/architecture/overview.md)。

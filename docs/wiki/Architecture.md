# 运行架构

> 状态: 已落地 | 最后核对: 2026-09-30

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

| 目录                                    | 责任                                                    |
| --------------------------------------- | ------------------------------------------------------- |
| `apps/desktop`                          | Electron 主进程、preload 和 React renderer              |
| `packages/agent-runtime`                | 会话、执行器、Provider、MCP、Skills、权限、工作流和团队 |
| `packages/storage`                      | SQLite/WAL、迁移和 Repository                           |
| `packages/protocol` / `packages/shared` | IPC、事件、schema、日志和共享辅助                       |
| `spark-engine`                          | turn machine、tool runner、权限、事件、CLI/TUI、serve   |
| `apps/website`                          | 旧官网归档（已停更；新官网为独立仓库 `edu-web`）        |

## 核心能力线

四条能力线不改变主链路，但各自有独立的存储边界与上下文预算。图解取自[工程手册 · 能力架构](https://alexanderizh.github.io/spark-agent/capabilities.html)。

### 长期记忆

![长期记忆一轮对话的写入与读取闭环](https://alexanderizh.github.io/spark-agent/assets/img/long-term-memory-pipeline.svg)

每轮对话结束后台抽取写入、每轮对话开始混合检索注入。写入过五道闸门（瞬时数据 / 置信度 / 去重合并 / 配额 / 敏感内容），读取走 FTS5 与向量双路、RRF 融合后按 token 预算裁剪。Agent 侧只有 `search_memory` 与 `recall_memory` 两个只读工具。

### 知识库（Wiki）

![知识库上下文预算分层](https://alexanderizh.github.io/spark-agent/assets/img/knowledge-base-budget.svg)

**零预注入**：知识库内容不进常驻上下文。读取要过四层预算（常驻约 800 token、检索 top 8、正文 3000 token 每页、单轮总闸 8000，均带服务端硬上限），写入收敛到统一写入原语（`expectedVersion` CAS + 正文原子落盘 + FTS 同事务 + 失败回滚）。

### 自动路由

![自动路由一轮分流与降级阶梯](https://alexanderizh.github.io/spark-agent/assets/img/auto-router-flow.svg)

一个 router = 1 个分流器 + N 个按强度（`high` / `balanced` / `low`）分档的执行模型。分流是**轮次级替换**：宿主在跑这一轮之前把 provider 与 model 换掉；分流失败一律降级，不抛错也不中断本轮。

### 性能保护

![性能监控：采样、定级与四档滞回](https://alexanderizh.github.io/spark-agent/assets/img/performance-pressure-levels.svg)

2 秒采样六类指标，逐项与自己的三档阈值比对后取最高档（max-of-levels）；升级连续 2 轮（危急 1 轮立即）、降级连续 6 轮 + 最短驻留 30 秒且一次只降一级。阈值只存百分比，GB 是按宿主机基线换算的展示值。warning / critical 完全静默，只有危急档弹一条右上角消息 + 一条系统通知。

![派发闸门：主池与嵌套防死锁池](https://alexanderizh.github.io/spark-agent/assets/img/performance-dispatch-gate.svg)

真正把并发收敛住的是 `DispatchGovernor` 的双池闸门：主池（`depth = 0` 且非同步 peer call）严格 FIFO、超时 120 秒拒绝；嵌套池（`depth > 0` 或 peer call）独立配额、15 秒兜底放行防死锁。全局并发预算（默认 8）是唯一权威上限，容量收缩只影响新准入、不撤销在飞许可。

> 如实标注：压力级别已由装配层灌进闸门（`ResourceMonitorService` 级别变更回调 → `governor.setPressureLevel`，并含监控晚于闸门创建时的补灌），但闸门内目前只记录档位、不参与准入判定。所以界面上的「限流中 / 已暂停派发 / 已熔断」是状态呈现，真正生效的是与压力级别无关的固定并发上限。

| 能力     | 服务与协议                                                                   | 存储                                                                                                                       |
| -------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 长期记忆 | `packages/agent-runtime`（记忆服务与工具）                                   | markdown 事实源 + `memory_entry` / `memory_fts` / `memory_vec` / `memory_entity`（迁移 107–110）                           |
| 知识库   | `packages/agent-runtime/src/services/wiki`、`packages/protocol/src/wiki*.ts` | markdown 正文 + `wiki_space` / `wiki_page` / `wiki_link` / `wiki_revision` / `wiki_fts` / `wiki_candidate`（迁移 112–114） |
| 自动路由 | `packages/protocol/src/auto-router-config.ts` 与会话执行路径的分流编排       | `provider_profiles`（`provider_type = auto-router`）+ `auto_router_decision` 事件                                          |
| 性能保护 | `packages/agent-runtime` 的 `resource-monitor` 与 `dispatch-governor`        | `resource_pressure_events`（迁移 103，保留 7 天）+ 分钟级指标的内存环形缓冲（默认不落库）                                  |

## 安全不变量

- Renderer 不启用 Node integration。
- preload 只暴露最小的 `contextBridge` API。
- 文件、命令、网络、桌面控制和外部工具都经过权限/策略层。
- API key 不写入 SQLite、日志、Issue、Wiki 或 Pages。
- 长任务要有取消、关闭、失败、重试和恢复路径。

## 远程连接审批

- 远程消息在 `apps/desktop/src/main/ipc/index.ts` 建立 turn 到原始连接/聊天的映射；权限审批按 `turnId` 回到同一聊天。
- 远程连接需启用 `approvePermissions` 才能操作审批。远程 `/approve <审批码>` 只批准一次，`/deny <审批码>` 拒绝；审批码不能跨连接或聊天使用。
- 超时、会话取消和远程决定都会关闭桌面审批卡。飞书卡片按钮依赖 `card.action.trigger` 事件订阅；原生机器人菜单由飞书应用后台管理。

完整的启动顺序、数据边界和新功能落位规则见[工程手册 · 运行架构](https://alexanderizh.github.io/spark-agent/architecture.html)。

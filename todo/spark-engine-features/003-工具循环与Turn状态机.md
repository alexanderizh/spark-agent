# 003 - 工具循环与 Turn 状态机

> 状态: 实施中 | 最后核对: 2026-08-26

## 1. 目标与非目标

目标是让一次用户输入稳定地经历“投影上下文 → 请求模型 → 执行零到多个工具 → 再请求模型 → 唯一终态”，并在重试、取消、崩溃和观察者失败时仍满足 M1 的八项内核不变量。

本文不重复 004 的工具内部执行细节，也不定义 005 的权限规则语法。模型协议翻译见 008。

## 2. 当前状态机

```text
queued? → turn.started
       → step.started
       → llm.stream
       → assistant.completed
       → [无工具] turn.completed(final)
       → [有工具] tool.call → permission → tool.intent → execute → tool.result
                    └──────────────────────────────────────────────→ 下一 step

任意静止点取消 → turn.cancelled
任意非取消异常 → turn.failed
预算到达硬上限 → turn.completed(budget)
```

- `TurnGate` 是唯一终态提交门；完成、取消、失败竞争时只允许一个终态落账。
- 每个 step 在模型请求前写入 `step.started`，模型完整收束后写 `assistant.completed`。
- `assistant.delta` 只用于实时 UI，不进事实账本；进程崩溃后以最后一个完整事件恢复。
- 一次模型响应中的所有工具调用先完成 schema 与权限准备，再按并发属性分组执行。

## 3. 模型流与续传状态

`consumeLlmStream` 只接受以下中立增量：`text`、`thinking`、`tool_call`、`usage`、`continuation`、`heartbeat`、`done`。

`continuation` 是协议适配器提供的受控 opaque 状态：

- Anthropic 保存含签名的完整 content blocks；
- OpenAI 保存完整 response output items（含 reasoning items）；
- 事实事件存储该状态，投影器在同协议下一步逐字节结构化复用；
- 跨协议 failover 时不透传另一协议的 opaque 状态，改用中立 text/tool-call IR 重建。

没有 continuation 的普通文本响应仍保持向后兼容。一个流重复发 continuation、缺少 `done`、返回空响应或重复 call id 都会 fail-closed。

## 4. 重试与故障转移边界

自动重试只允许发生在**尚未产生可见/可执行增量**之前：

- 连接失败、429、5xx 等 retryable 错误按有界指数退避重试；
- 遵守服务端 `retry-after`，退避与随机数均有测试 seam；
- 主路由用尽重试后才进入备用路由；
- 一旦已产生 text/thinking/tool/usage/continuation，后续失败转为 `llm.partial_stream_failed`，禁止自动整流重放，避免重复 UI 文本和未来副作用；
- `heartbeat` 不算可见输出，可以安全重试；
- 用户取消永远优先，不重试、不 failover。

后续增量：对官方支持续传的协议单独定义恢复 token；在没有协议级 exactly-once 证据前，不实现“猜测式续传”。

## 5. 调度、取消与观察者

- 同一 session 的 turn 为 FIFO；排队 turn 可在启动前取消并获得终态。
- `AbortSignal` 沿 Turn → LLM → ToolRunner → ToolExecutor 传播。
- shell 使用独立进程组；取消先 SIGTERM，1.5 秒后仍存活才 SIGKILL。
- `onEvent` / `onDelta` 是非权威观察者；观察者异常只记 telemetry，不得反向破坏事实提交。

## 6. 已验证用例

- 一个 turn 恰好一个终态；终态落盘失败可恢复。
- 多 Ledger 并发 seq 连续且不重复。
- 排队取消、运行中取消、孤儿 intent 恢复。
- 模型流缺 `done`、空响应、重复 call id/continuation 均失败。
- retry-before-output、failover-before-output、partial-stream-no-replay。
- Anthropic/OpenAI 工具循环的 continuation 可进入下一请求。

## 7. 下一阶段

- 把 capability negotiation 接入请求投影，按模型能力显式启停 thinking、并行工具和缓存。
- 引入上下文窗口计量与 compaction 静止点（002/001）。
- 为成本表与 route health 增加事件/遥测，不把易变健康度写入事实账本。

# 协作 Agent 卡片生命周期

> 状态: 已落地 | 最后核对: 2026-07-22

## 目标

协作 Agent 卡片必须把任务说明、实时进度、结果摘要和完整输出作为四个独立语义字段处理。Provider 只返回短摘要时，不得把摘要伪装成完整输出；迟到或重复的事件不得更新其他 turn、其他 task 的卡片，也不得让终态回退为运行态。

## 事件与字段

| 生命周期阶段 | `AgentEvent`                               | 卡片字段                                                     | 持久化                                         |
| ------------ | ------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------- |
| 启动         | `subagent_started`                         | `task`、`role`、`name`、`taskId`、`toolCallId`               | 完整事件写入 `agent_events`                    |
| 进度         | `subagent_progress`                        | `progressSummary`、工具名、token、工具调用数、耗时、运行状态 | 完整事件写入 `agent_events`                    |
| 嵌套正文     | `subagent_message`                         | 有界 transcript                                              | delta 仅实时发布，complete 写入 `agent_events` |
| 完成         | `subagent_completed`                       | `resultSummary`、`output`、终态与最终统计                    | 完整事件写入 `agent_events`                    |
| 子任务错误   | 带 `origin.kind=subagent` 的 `agent_error` | 匹配卡片的错误终态与结果摘要                                 | 完整事件写入 `agent_events`                    |

Claude SDK 的 `task_notification.summary` 只是完成摘要，因此映射为 `resultSummary`，`output` 保持空字符串。Agent 工具的最终可读报告优先从 `SDKUserMessage.tool_use_result.content[]` 提取，并携带结构化 token、工具调用次数和耗时；只有旧 SDK 没有结构化结果时才回退到字符串 `tool_result`。

## 卡片关联规则

`MessageBuilder` 只在事件所属 `turnId` 内查找卡片：

1. 事件带 `taskId` 时，优先匹配 `(turnId, taskId)`；这允许 SDK 先发 `claude-task:{taskId}` 占位 ID、后补真实 `toolCallId`，仍只维护一张卡片。
2. `taskId` 缺失时，兼容匹配 `(turnId, toolCallId)`；旧历史事件和同步 Agent 工具结果继续可回放。
3. 同一个 `toolCallId` 在不同 turn 被复用时，启动、进度、完成、错误和运行时信号都只能更新本 turn 的卡片。

协议增加的 `SubagentCompletedEvent.taskId` 是可选字段，因此数据库无需 migration，旧事件仍按 `turnId + toolCallId` 回放。

## 状态单调性

卡片状态允许以下非终态变化：

- `pending` 映射为 `running`；
- `running ↔ paused`；
- `running/paused → done | error | stopped`。

`done`、`error`、`stopped` 是终态。终态之后迟到的 started、running、paused 或错误归属事件不得改变状态、任务说明或已有结果；同一终态的后到完成事件可以补齐空缺的完整输出，并只按累计最大值更新 token、耗时和工具统计。与已有终态矛盾的完成事件不得覆盖状态或结果。

实时进度不会覆盖启动时的任务说明，完成摘要不会覆盖最后一条实时进度。Renderer 展示时还会去除与任务、进度或完整输出完全相同的重复摘要；Provider 确实未给可读结果时显示明确提示，而不是生成一段假输出。

## 回放与兼容

会话实时流和历史加载都使用同一个 `MessageBuilder`。所有非 delta 生命周期事件以原始 JSON 写入 SQLite，重新打开会话时按 session 内 `seq` 顺序回放，因此实时状态和历史状态必须一致。

兼容规则：

- 旧 `subagent_completed` 没有 `taskId` 时继续按 turn 内 `toolCallId` 匹配；
- 旧事件把任务短描述同时写入 `output` 时，Renderer 会过滤与任务/进度完全相同的伪输出；新事件不再产生这种重复数据；
- 完整输出到达前的 summary-only 完成事件可以先关闭卡片，后续结构化结果只补齐同一卡片，不创建第二张卡片。

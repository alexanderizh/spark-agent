# 结构化提问可靠性设计

> 状态: 已落地 | 最后核对: 2026-07-13

## 问题

Claude Agent SDK 的权限请求、Hooks、`canUseTool` 和运行中模式控制只在流式输入模式下保持控制通道。Spark 原先向 `query()` 传入单个字符串；长 turn 末尾触发 `AskUserQuestion` 时，SDK 可能已关闭输入控制通道，最终产生 `Tool permission request failed: Stream closed`。由于没有进入 Spark 的 `questionCallback`，主进程不会推送结构化提问弹窗。

旧链路还有三个放大问题：

- 主进程用时间戳生成弹窗 ID，而画布内联卡片用 SDK `toolCallId` 回答，二者无法稳定关联。
- 待处理问题只存在一次性推送中，渲染进程重载或监听建立较晚时无法恢复。
- 任意 `tool_result` 都会把问题标为“已回答”，错误结果因此显示成“已回答 / 未填写”。

## 实施方案

1. 每个 Claude turn 使用只包含一条用户消息的 `AsyncIterable` 输入；输入迭代器保持打开，收到 SDK `result` 或 abort 时关闭。这只修复 SDK 控制通道生命周期，不改变工具授权结果。
2. `AskUserQuestion` 使用 SDK `toolUseID` 作为稳定 `questionId`；MCP elicitation 使用 `elicitationId`，无原生 ID 时才生成 UUID。
3. 主进程按 `(sessionId, questionId)` 保存待处理问题，重复请求复用同一 Promise，并提供列表 IPC 供渲染进程重放。
4. 回答 IPC 同时校验 `sessionId` 和 `questionId`。问题不存在时返回 `NOT_FOUND`，不再静默成功。
5. 渲染进程按会话维护问题队列，合并实时推送和启动重放；回答、取消或 abort 后通过关闭事件精确移除。
6. `tool_result.status === 'success'` 才标记已回答；错误结果展示失败原因并禁用无效表单。

## 权限与模式边界

| 场景 | `AskUserQuestion` 行为 |
| --- | --- |
| `claude-ask` | 进入 Spark 结构化提问回调 |
| `claude-auto-edits` | 进入 Spark 结构化提问回调；编辑工具的自动许可策略不变 |
| `claude-plan` | 进入 Spark 结构化提问回调；计划模式写入限制不变 |
| `claude-auto` | 进入 Spark 结构化提问回调；其他工具仍由 SDK 自动权限策略处理 |
| `claude-bypass` | 进入 Spark 结构化提问回调；其他工具仍保持 bypass 策略 |
| `unattended` | 明确拒绝提问，避免无人值守任务永久等待 |
| Codex adapters | 不新增 Claude 专属工具或回调，保持现状 |

## 回归覆盖

- 晚到的 `AskUserQuestion` 在 result 前仍能调用控制回调，result 后输入流关闭。
- 稳定 ID 去重、待处理列表重放、严格会话关联、abort 清理。
- 实时事件与重放事件合并时不重复，多个问题按创建时间排队。
- 提问成功与 `Stream closed` 失败分别映射为已回答和失败状态。

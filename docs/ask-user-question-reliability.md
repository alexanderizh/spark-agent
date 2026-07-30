# 结构化提问可靠性设计

> 状态: 已落地 | 最后核对: 2026-07-30

## 目标

`AskUserQuestion` 是会话控制面，不是普通工具结果。用户回答或明确关闭之前，当前 session 不应继续消费后续 turn；问答面板也不能因为 Claude/Codex 的传输流提前结束而被当成用户取消。

## 生命周期

1. Claude SDK 调用 `canUseTool('AskUserQuestion', ...)` 后，SessionService 进入引用计数的问答闸门，并向主进程登记稳定的 `questionId`。
2. 主进程 `PendingUserQuestionStore` 把 UI 请求与 SDK 等待解耦。SDK 的 `AbortSignal` 只标记传输为 detached，不发 `user-question-closed`，因此面板可以通过 pending 列表重放。
3. 用户回答前，`dispatchTurn` 与 `startNextQueuedTurn` 都检查该 session 的问答闸门；Claude、Codex、远程消息和自动任务都只能排队。
4. 如果原 SDK 控制流仍存活，回答直接返回给 SDK；如果流已经 detached，主进程把原问题和回答组装成一个新的持久化 `submitTurn` 消息，再释放闸门。用户取消只关闭问答，不生成续接消息。
5. Claude 输入 AsyncIterable 在收到 result 后保留 5 秒宽限；进行中的问答通过 hold 计数保持输入打开，回答后才关闭。这样同时覆盖“结果先到”和“权限请求晚到”的竞态。

## 失败边界

- `Stream closed` 表示 SDK 控制流/传输生命周期结束，不等同于用户拒绝权限。
- 续接 turn 提交失败时，pending question 不会关闭，用户可以重试；只有续接被接收或用户明确取消才发送关闭事件。
- 应用重启后，内存中的进行中问答不会伪造为已回答；新的 SDK turn 需要重新发起结构化提问。

## 依赖基线

- `@anthropic-ai/claude-agent-sdk`: `0.3.220`，包括所有平台内置包。
- `@anthropic-ai/sdk`: `0.115.0`。
- `@openai/codex-sdk`: `0.146.0`。

版本升级只解决 SDK 自身缺陷，不能替代宿主层的问答闸门和 detached recovery；两层必须同时保留。

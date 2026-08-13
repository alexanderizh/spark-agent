# 团队派发额度自动续跑改造计划

> 状态: 已落地 | 最后核对: 2026-08-14

## 1. 背景与目标

团队 Host 的派发预算按单个 Host turn 计数，默认每轮最多 10 个 dispatch。旧行为在第 11 次派发时只返回 `Dispatch budget exceeded`，Host turn 随即结束，长任务会被截断。改造目标是把“单轮派发上限”变成执行窗口，而不是用户任务的终止条件。

本次改造不取消派发预算，也不改变持久化讨论轮次 `maxDiscussionRounds`；只在派发预算耗尽后，自动开启同一会话上下文中的隐藏 Host continuation turn。

## 2. 执行方案

1. `TeamDispatchService` 在 Host 派发预算超限时触发回调，同时保留原有失败结果，确保模型能看到本次派发被拒绝的原因。
2. `SessionService` 记录“哪个 Host turn 耗尽预算”，等当前 executor、派发计数、文件变更键和 MCP bridge 全部清理后，再创建新的隐藏 turn。
3. 隐藏 turn 复用原会话、工作区、provider/model 和团队讨论状态，提示词要求从上次停止的位置继续，不重复已完成工作。
4. 自动链每个 session 最多续跑 20 次；达到安全阀后回到普通队列流程，避免异常模型或任务无限循环。

## 3. 状态与边界

```text
Host turn
  └─ dispatch budget exhausted
       └─ mark exhausted Host turn
            └─ current turn cleanup
                 ├─ approval/question pending → stop and wait for user
                 ├─ visible user turn queued → discard continuation
                 ├─ safety valve reached → ordinary queue flow
                 └─ otherwise → hidden continuation turn
```

- 自动续跑只从 Host 团队工具触发，成员的嵌套派发和 peer call 不会创建顶层 continuation。
- 计划审批、结构化用户问题优先级高于自动续跑；续跑不得绕过用户确认。
- 因全局并发或成员 dispatch 尚未释放而进入队列的隐藏续跑带有内部标记；用户新消息、立即执行队列任务或停止操作会移除它。
- 用户新消息、显式取消、会话清空/删除和应用退出都会清理自动续跑状态。
- 隐藏续跑只隐藏内部 user message，模型上下文和必要的持久化事件仍然保留。

## 4. 验证计划与结果

- 调度服务：验证预算超限仍返回失败结果，并触发 Host 回调。
- 续跑策略：验证 session 隔离、20 次安全阀和隐藏消息展示策略。
- SessionService：验证续跑启动、审批闸门阻断和用户消息移除排队续跑。
- 提交前运行 agent-runtime 相关测试、ESLint、格式检查、类型检查和 `git diff --check`。

类型检查若仍失败，需区分本次改造错误与工作区已有的跨包 `rootDir`/路径别名配置问题，不得用放宽类型检查的方式掩盖错误。

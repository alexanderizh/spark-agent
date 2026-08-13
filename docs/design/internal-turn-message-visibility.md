# 内部 Turn 消息展示策略

> 状态: 已落地 | 最后核对: 2026-08-13

## 目标

Goal 契约起草、Goal 自动迭代与定时任务都会把平台内置提示作为真实 `user_message` 送入执行链。模型需要继续接收这些原始提示，事件也需要保留用于回放、上下文和审计，但聊天时间线不应把整段平台提示显示成用户气泡。

## 协议

内部 Turn 使用两个彼此独立的可选字段：

- `turnSource`：区分 `scheduled_task`、`goal_contract_draft`、`goal_iteration` 与普通用户 Turn。
- `userMessageVisibility`：只控制用户消息气泡是否显示；当前内部 Turn 固定为 `hidden`。

字段是可选的。缺少字段的旧事件和普通用户消息继续按可见消息处理，不需要数据库迁移，也不通过提示词文本猜测来源。

## 数据流

`SendTurnParams`、持久化 `PendingTurn`、重启后的 `turn_requests` 恢复、`startTurn`、SDK 事件、启动失败事件、队列快照和运行时提示快照都会透传呈现元数据。提示词正文、附件、模型参数、上下文拼装和执行调度不做改变。

Renderer 保留完整逻辑消息流，用于：

- 事件回放、状态派生与流式聚合；
- 删除时的 Turn 完整性；
- 父级消息缓存与乐观消息确认；
- 模型上下文和审计。

主聊天、侧聊、画布 ChatPanel 和 ProjectView 通过独立投影只移除 `userMessageVisibility=hidden` 的用户气泡，对应 Assistant 的执行过程、结果、错误和 Turn 导航仍然可见。会话复制、Composer、计划面板和检查器等用户可见消费者复用同一投影，避免从旁路重新暴露隐藏正文。投影会把内部 Turn 的呈现元数据复制到同 Turn 的 Assistant 消息，避免错误重试回退到更早的真实用户输入。

内部 Turn 进入等待队列时，Composer 仍保留“立即执行/移除”控制，但只显示“定时任务自动执行”或“目标模式自动执行”等安全标签，且不提供会把正文填回输入框的编辑入口。白盒 Prompt Inspector 保留 Turn 快照和系统段落审计，hidden Turn 的用户消息改为固定占位文案。hidden Turn 也不会用内置提示生成或精炼会话标题。

## 搜索与历史兼容

会话全文搜索的实时索引、存量回填和 LIKE fallback 都排除 hidden 用户正文。LIKE fallback 必须同时查询 `event_type`，否则无法在解析 JSON 时识别 hidden `user_message`。Assistant 结果仍可被搜索。

旧历史没有可靠元数据，默认继续显示。当前实现不使用标题、英文前缀或正则表达式识别旧内部消息，避免误隐藏用户自己输入的相同文本。若未来需要隐藏旧历史，应设计显式、可审计的数据迁移。

## 验证边界

聚焦测试覆盖：

- 两种定时任务入口使用统一隐藏策略；
- Goal 自动迭代携带内部来源；
- 元数据进入持久化队列并在异常路径保留；
- MessageBuilder 保留完整逻辑消息；
- 可见投影只隐藏用户气泡并保留 Assistant Turn；
- 内部 Turn 错误不生成错误的用户重试载荷；
- FTS、回填正文解析与 LIKE fallback 不暴露隐藏提示。
- 内部排队 Turn 使用安全标签且不可编辑正文；
- 白盒 Prompt Inspector 隐藏内部用户正文；
- hidden 首轮不会把内置提示派生为会话标题。

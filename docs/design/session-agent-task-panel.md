# 会话内 Agent 任务面板

> 状态: 已落地 | 最后核对: 2026-08-27

## 目标

Agent 创建或更新计划任务时，除了右上角悬浮检查器，还要在会话消息流中展示同一份任务进度。会话内面板是独立组件，不占用固定槽位，也不改变右上角面板。

## 数据与时间线

- 两处界面都以 `extractSessionProgressTasks(messages)` 为任务快照的唯一解析入口。
- 会话时间线识别宿主 Agent 的 `todo_write`、成功的 `todo_read`、`task_create` 和 `task_update`；团队成员内部任务不进入宿主面板。
- 每条 Assistant 消息的首个有效任务事件作为面板锚点，锚点前后的思考、正文和工具活动继续保持原事件顺序。
- 同一消息内的后续任务事件更新锚点处的快照，不再渲染重复的任务工具卡。
- 后续 Assistant 消息再次产生任务事件时，在新事件所在消息中展示新的快照，因此历史回放仍能看到任务进度的时间变化。
- 空任务快照不生成面板，避免会话中出现没有内容的任务区域。

## 组件边界

- `SessionTaskTimeline.ts` 负责从 `UIMessage[]` 生成按消息索引的任务快照与锚点。
- `SessionTaskPanel.tsx` 只负责渲染 `InspectorTask[]`，不读取会话状态或重新解析工具输入。
- `ChatView.tsx` 只负责构建时间线映射、把快照传入对应 Assistant 消息，并在锚点位置替换原任务工具卡。扁平渲染（`renderBlocks`）与分组渲染（`renderActivityBlocks`）共用 `shouldReplaceSessionTaskBlock` 判定替换；`task_create` / `task_update` / `todo_read` 会被 `classifyToolLog` 兜底归入通用工具桶，因此替换判定必须先于 `ToolLogGroup` 分桶执行。
- 外壳复用 HTML 渲染面板的 `BlockTrafficHeader` 与边框、圆角、背景配方；列表内部继续以状态图标和文字明暗表达层级，不增加阴影或额外装饰。

## 状态语义

- `pending`：空心圆，展示任务标题。
- `in_progress`：旋转状态图标，优先展示 `activeForm`。
- `completed`：成功图标，计入完成数量。
- `interrupted`：中断图标，只表示原本正在执行的任务随消息 `error` 或 `cancelled` 被中断。
- 正常 `completed` 消息不改写任务状态；从未开始的 `pending` 在任何终态下都保持中性待处理样式。

## 验证范围

- 任务事件锚点和跨消息时间顺序。
- 同一消息内多次任务更新合并为一个快照。
- 团队成员任务与空快照过滤。
- 全部任务协议工具的替换判定，以及任务工具被通用工具桶收纳时分组渲染的旁路事实。
- 四类状态、描述文本、完成计数和空列表渲染。
- Desktop renderer TypeScript strict 检查。

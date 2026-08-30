# Workflow Conditional Routing Runtime

> 状态: 已落地 | 最后核对: 2026-07-21

本文记录应用内 Agent Workflow 的条件边、分支合流和运行进度语义。Workflow 仍使用 `WorkflowGraph.nodes + edges` 作为唯一持久化模型，条件挂在 `WorkflowEdge.condition` 上。

## 条件边

条件边支持以下安全谓词：

- `exists`: state 中存在指定 key。
- `truthy` / `falsy`: state 中指定 key 转布尔后为真或假。
- `equals` / `not_equals`: state 中指定 key 与配置值做严格等值比较。

条件读取的是工作流 state。节点完成后，只有配置了非空 `outputKey` 的输出会写入 state；因此条件 key 应优先引用上游节点的 `outputKey`。桌面端工作流编辑器在选中新连线或右键连线时提供条件配置，并在上游存在 `outputKey` 时提供一键填入。

## 路由节点

`route` 是专门的条件/路由原子节点，用来替代“用 plan/review 提示词伪装判断节点”的旧做法。

- 配置项：`config.outputKey` 指定写入 state 的键，默认 `route`；`config.routeOptions` 定义允许分支值，每项包含 `value / label / description`。
- 执行：`route` 会生成只读临时 worker，结合工作流目标和上游输入选择一个 `routeOptions.value`。
- 输出约束：运行时会解析纯文本、JSON 字符串或 `{ route | decision | value }` 对象，但最终只接受一个合法 `value`；输出为空或不在 `routeOptions` 内会让该节点失败，避免误走错误分支。
- 条件边：从 `route` 节点连出的边通常配置为 `equals(outputKey, value)`。桌面端连线检查器会展示源路由节点的分支 chip，点击即可生成对应条件。

## 分支与合流

执行器采用活跃入边语义：

- 无入边节点直接可运行。
- 有多条入边的节点会等待所有活跃上游分支完成。
- 条件为 false 的边会让对应分支进入 `skipped`。
- 合流节点不会因为某个已跳过分支而死锁；只要至少一条活跃入边完成，且其它未完成入边都已被判定为 skipped，该节点即可继续。

这使常见的 `if/else -> merge` 图可以稳定执行，同时保留无条件并行 join 的“等待全部分支完成”语义。

## 运行快照

`workflow_runs` 现在持久化：

- `completed_node_ids_json`: 已完成节点。
- `skipped_node_ids_json`: 因条件未命中或上游 skipped 而跳过的节点。
- `state_json`: 当前工作流 state。
- `executions_json` / `atomic_executions_json`: Agent 节点与原子节点执行记录。

恢复同一会话同一 workflow 的未完成 run 时，执行器会同时恢复 completed 和 skipped 节点，避免条件分支续跑后重新进入死锁。

## UI 反馈

`workflow_progress` 事件中的节点状态包含 `pending / running / completed / failed / skipped`。聊天流进度卡会把 skipped 节点计入已决节点，并以淡化样式展示，方便用户区分“条件跳过”和“尚未执行”。

## Guided Runtime

Claude SDK 路径优先通过 `workflow_run` 执行真实图。Codex 或 guided 路径没有 `workflow_run` 时，系统提示会同时注入节点列表和边条件列表，要求模型按 outputKey state 评估条件并跳过 inactive 分支。

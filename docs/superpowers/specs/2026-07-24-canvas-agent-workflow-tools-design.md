# 画布 Agent 工作流工具设计

> 状态: 实施中 | 最后核对: 2026-07-24

## 定位

画布 Agent 面板不增加第二套工作流 UI。它通过现有 `spark_canvas` MCP 工具直接使用无限画布工作流能力；应用工作台的 Agent Workflow 仍保持独立。工具执行上下文始终绑定当前画布项目，所有持久化和运行记录继续使用 `CanvasWorkflow*` 与 `canvas_workflow_*`。

## 工具边界

| 能力 | 工具 | 是否确认 |
| --- | --- | --- |
| 查询 | `canvas_workflow_list`、`canvas_workflow_get`、`canvas_workflow_run_list`、`canvas_workflow_run_get` | 否 |
| 新建/修改 | `canvas_workflow_create`、`canvas_workflow_update` | Agent 明确收到用户指令后直接执行 |
| 从选区提取 | `canvas_workflow_extract_selection` | 保存草案前由 Agent 告知用户结果；写入由工具完成 |
| 删除 | `canvas_workflow_delete` | 是 |
| 展开到当前画布 | `canvas_workflow_apply` | 是 |
| 按流程运行 | `canvas_workflow_run` | 是 |
| 运行控制 | `canvas_workflow_cancel`、`canvas_workflow_retry`、`canvas_workflow_resume` | 取消/重试/恢复需要明确指令 |

需要确认的工具第一次调用只返回 `requiresConfirmation`、操作摘要和可读对象信息，不执行副作用。用户在对话中确认后，Agent 使用相同参数并设置 `confirmed: true`。默认列表只返回当前项目级工作流、个人库和内置模板；项目级读取、修改、删除、应用和运行记录控制都必须绑定当前画布项目，不能调用应用工作台 Workflow。

## 应用语义

- `canvas_workflow_apply` 使用已有的工作流物化服务，在当前画布生成全新的普通节点、连线和配置；不保存 workflow id、version 或 provenance。
- `canvas_workflow_extract_selection` 使用当前选中节点和连线生成工作流包，默认保存为当前项目草稿；AI 只负责命名、描述、标签和契约语义，图结构仍由规则提取器保证。
- `canvas_workflow_run` 创建 `canvas_workflow_run` 后复用现有执行循环、真实画布任务等待、输出契约和步骤记录，返回运行状态、运行 id、输出和失败信息。
- 所有写操作进入已有的项目级串行工具队列，避免 Agent 与手工画布操作并发覆盖。
- Agent 消息上下文中，用户显式引用节点优先；没有显式引用时自动带入当前画布选区，保证“框选节点后直接对话提取工作流”可用。

## 交互约定

对话中的工具结果保持紧凑，优先返回 id、名称、作用域、版本、节点/步骤数量和状态，不把完整画布快照塞回模型。Agent 应先查询，再执行；应用和运行都要说明位置、输入、参数以及可能产生的产物。

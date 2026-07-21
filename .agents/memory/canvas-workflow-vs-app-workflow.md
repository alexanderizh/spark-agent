# 无限画布工作流与应用工作台工作流边界记忆

> 最后核对: 2026-07-21

## 一句话区分

- 应用工作台工作流：Agent/工具/审批/验证的任务执行编排，服务于工作台会话和真实工具调用。
- 无限画布工作流：画布节点、素材、模型操作和创作产物的可复用产物流，服务于无限画布和资产血缘。

## 不能混用的命名与持久化

- 应用工作台使用 `WorkflowGraph`、`workflow_run`、`workflow_runs` 等语义。
- 无限画布工作流必须使用 `CanvasWorkflow*` 前缀，数据库建议为 `canvas_workflows`、`canvas_workflow_runs`、`canvas_workflow_run_tasks`。
- IPC 建议统一为 `canvas:workflow:*`。
- UI 文案中写“画布工作流”，不要只写“工作流”，避免和应用工作台混淆。

## 无限画布工作流的核心能力

- 常规 CRUD、复制、版本、导入导出和模板库。
- 作为折叠工作流节点拖入画布运行。
- 展开为普通画布节点继续编辑。
- 对选中素材直接应用。
- 用户通过自定义输入和参数运行后，输出文本、图片、视频、音频、分镜或结构化资产到画布。
- 框选画布节点后，用规则拓扑分析 + AI 语义提炼，提取为可复用画布工作流。

## ComfyUI 参考点

- 借鉴 subgraph：选中节点封装为可复用节点，并推导输入输出。
- 借鉴子图参数面板：外层只暴露关键参数。
- 借鉴模板库：按用途、模型、输入输出和依赖筛选。
- 借鉴 UI 保存格式与 API 执行格式分离。
- 借鉴 Partner Nodes：外部模型/API 可以作为节点能力接入。

## Spark 的取舍

- 不照搬 ComfyUI 的 Stable Diffusion 专用节点。
- 执行层复用画布任务队列、Provider Manifest、`CanvasInputBinding[]`、Prompt 参数编排器、任务可观测性和资产中心。
- 第一阶段只做画布任务 DAG，不支持任意循环、长期守护任务或应用工作台 Agent 审批链。
- AI 提取只能生成草案，保存前必须经过用户确认和规则校验。

## 相关设计文档

- `docs/superpowers/specs/2026-07-21-canvas-workflow-design.md`

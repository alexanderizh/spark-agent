# 画布 Agent 精细控制契约

> 状态: 已落地 | 最后核对: 2026-07-10

画布 Agent 以「先读取、再持久化修改、最后运行或重试」的契约操作一个已打开并 attach 的项目。

## 操作节点

`canvas_get_operation_config(nodeId)` 返回节点配置、关联任务、已连接输入、允许输入类型与参数 schema。Agent 必须在修改陌生操作节点前调用它，避免按猜测覆盖 `modelParams`。

`canvas_update_operation_config(nodeId, config, title?)` 是精细配置的首选写入口。它会把 prompt、negativePrompt、modelParams、模型选择、Agent、Skill 与 reasoningEffort 同步到节点和关联 CanvasTask。因此 `canvas_retry_operation(nodeId)` 使用的正是最新配置，而不是历史任务参数。

`canvas_run_operation(nodeId, prompt?)` 支持一次性覆盖本次运行参数；未传 prompt 时读取已经保存的 prompt。临时覆盖不会替代持久化配置，后续 retry 仍以持久化配置为准。

## 安全边界

- 修改前查询节点和操作配置；`modelParams` 是完整替换，不是深合并。
- 运行前确认 capability 的输入约束和已连接的输入节点。
- 删除、解散分组或删除影视资产仍须先获得用户确认。
- 工具只操作当前打开的单一画布，不暴露多画板操作。

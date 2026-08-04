# 会话计划任务 Agent 工具实施计划

> 状态: 已落地 | 最后核对: 2026-08-04

## 目标

把现有会话级计划任务提取为所有会话 Agent 可调用的内置工具，使 Agent 能在等待外部结果等场景中自行创建唤醒任务、结束当前 turn，并在后续定时 turn 中查询进度和完成清理。

## 实施范围

- 在 `spark_platform` MCP 增加当前会话限定的 list/get/create/update/delete 工具。
- 在 Platform Bridge 增加所有权校验后的 CRUD 适配层，复用 `ScheduledTaskService`，不复制调度计算。
- 在运行时允许列表加入新工具，并注入完整使用教程。
- 在定时唤醒 Prompt 中暴露任务 ID 和完成后删除提醒。
- Agent CRUD 后通知渲染进程刷新会话计划任务徽标与筛选。
- 增加工具领域层、MCP 工具清单、系统提示词、唤醒 Prompt 和 UI 刷新的回归测试。

## 安全边界

- 会话 ID 仅由运行时环境注入，不开放为工具参数。
- get/update/delete 必须验证任务属于当前会话；跨会话和全局任务统一按不可访问处理。
- update 不允许修改 scope 或 session binding。
- 创建默认沿用当前会话配置，不写入 Agent、模型、权限和工作区快照。
- 周期任务完成目标后必须删除；仅禁用用于明确需要保留定义但暂不运行的场景。

## 验证

- Agent runtime 单测覆盖 CRUD、越权拒绝、字段映射、教程提示和任务 ID 注入。
- Platform MCP server 测试覆盖五个工具及 sessionId 自动注入。
- Desktop 类型检查、相关测试、Lint/Prettier 与生产构建通过。

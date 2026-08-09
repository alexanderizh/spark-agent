---
name: acme-task-planning
description: 将复杂目标拆分为 Acme Tasks 中可执行的任务，并在写入前展示变更预览。
---

# Acme 任务规划

先使用 `mcp__spark_plugins__acme_search_tasks` 检查是否已有相同任务，再给出拆分结果。
需要写入时，先展示任务标题、状态和目标账号，得到确认后再调用更新工具。

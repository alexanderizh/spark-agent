# 会话栏拖拽排序设计

> 状态: 已落地 | 最后核对: 2026-07-29

## 范围

- 项目分组模式下，普通项目和“临时会话”项目可以通过拖拽手动排序。
- 每个项目内的会话可以拖拽排序；worktree 会话按其 base workspace 归入同一个排序域。
- 不显示或预留拖拽句柄；长按项目标题或会话条目 250ms 后开始拖拽，拖动项以浮起高亮样式跟随指针。
- 项目和会话上的操作按钮不会触发拖拽。
- 会话不能跨项目拖动。“未分组会话”不是项目，不开放拖拽排序。
- 日期、状态、无分组视图，以及搜索或任何筛选结果中不开放拖拽，避免只对可见子集排序造成隐藏条目位置不明确。

## 持久化

排序通过 `sidebar-order:list` / `sidebar-order:update` IPC 写入 SQLite 的 `app_settings`：

- `sidebar-order/projects` 保存项目 workspace ID 顺序，临时会话使用其真实 workspace ID。
- `sidebar-order/sessions:<projectId>` 保存项目内的 session ID 顺序。

新建且尚未进入手动顺序的项目或会话继续按原有“置顶 + 最近更新”规则排在已有手动序列之前。拖拽完成后会把当前分组的完整可见顺序持久化。

## 约束与校验

Renderer 使用独立的项目和会话 sortable ID。拖拽结束时先检查 active / over 是否属于相同类型；会话的 project ID 不一致时直接拒绝。

Main 进程再次校验：

- 项目排序项必须存在，且不能是独立 worktree workspace。
- 会话必须直接绑定目标 workspace，或绑定到以目标 workspace 为 base 的 worktree。
- 重复 ID、非 UUID 和超长列表由协议 schema 拒绝。

因此即使绕过 UI 调用 IPC，也不能把会话写入其他项目的排序域。

# Computer Use Phase 5.2 — Timeline 持久化与实时展示阶段审查

> 日期: 2026-07-31 | 范围: V2 计划 §5.2 会话日志链路 | 结论: 通过

## 审查结论

原 Phase 5 内存 MVP 已升级为可持久回放的产品链路：迁移 064、轻量 Event Store、14 类生命周期事件、实时 IPC 流、Renderer 重启回放和 `ComputerActivityBlock` 均已落地。Phase 5.1 系统级状态/Overlay 与 Phase 5.3 上层去轮询不在本切片内，分别继续并入 Phase 4 和 Phase 7，不能据此把完整 Phase 5 标为已完成。

## 实现范围

### 持久化与回放

- `064_computer_use_activity_events.sql` 保存内容无关的事件 JSON，以 `(computer_session_id, seq)` 唯一约束保证顺序。
- `ComputerActivityEventRepository` 提供追加、游标读取和进程重启后的序号续接。
- `ComputerUseTimelineStore` 保留有界内存实时缓存；数据库不可用时 fail-soft，动作控制流不因日志基础设施失败而判死。
- `computer-use:list-sessions` 允许 Renderer 从聊天 `sessionId` 发现历史 Computer Session；`get-timeline` 按 500 条分页回放。

### 生命周期完整性

生产路径已覆盖协议定义的 14 类事件：session started/completed/failed/canceled、observation、action requested/blocked/executed/failed、approval requested/resolved、verification started/completed、handoff required。原生审批框拒绝与 Renderer deny IPC 均记录 resolved=denied；批准在一次性 ticket 被 Broker 消费后记录 resolved=approved。

### Renderer 实时链路

- `stream:computer-use:activity-event` 使用协议类型安全的 stream channel。
- `ComputerActivityBlock` 先订阅实时流，再加载历史；合并时以 `computerSessionId + seq` 去重并恢复顺序，避免 replay/live 竞态重复。
- 每个 Computer Session 显示一张卡；运行中展开，终态折叠；失败码转换为可执行的人类提示。
- `ChatView.tsx` 仅增加 block 接入口，具体逻辑和样式均拆入独立文件，未继续膨胀大文件。

## 三遍复核

### 第一遍：需求覆盖

- 固定失败的 timeline handler 已删除。
- Renderer 实时展示与进程/Renderer 重启后的数据库回放已具备。
- 回放与实时的去重、顺序恢复、多 Computer Session 隔离有聚焦测试。
- 尚未实现的系统 Overlay 与去轮询已在主计划明确保持“实施中”，没有扩大完成声明。

### 第二遍：安全与失败语义

- Event Store 不保存截图、输入文本、AX/UIA 文本或模型 intent。
- timeline `record` 不参与 policy/approval/dispatch 决策；存储、序号查询、订阅者异常均降级，不放行动作也不把已执行动作误判失败。
- L0/L1、T01 intent 升档、unknown→L2、unattended/sensitive handoff、full-access 显式授权和 Native Host digest/timeout fail-closed 均未改变。
- denied approval 只记录结果，不会生成批准 ticket；approved 只在 ticket 成功消费后记录。

### 第三遍：并行改动与交付边界

- Renderer 共享文件存在其他功能改动；本阶段只对 `ChatView.tsx` 增加一个 import 和一个组件入口，提交前必须以 index patch 精确暂存这两个 hunk。
- `packages/protocol/src/ipc/index.ts` 同样存在未提交的 unread-badge 改动；Computer Use 的 import/stream hunk必须单独暂存。
- 其他 Sidebar、Canvas、Unread Badge 等改动不属于本阶段，不得进入提交。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| storage migrations 静态校验 | 64 个 migration 合法，无 version 撞号 |
| storage SQLite 真实迁移/仓储测试 | 20 文件 / 226 测试通过，迁移 64 实际执行成功 |
| Computer Use + protocol + Renderer reducer | 41 文件 / 277 测试；270 首轮通过，7 个 loopback 用例在允许监听 `127.0.0.1` 后通过 |
| Phase 5 聚焦链路 | 75 测试通过 |
| desktop typecheck | renderer + node 两套 `tsc --noEmit` exit 0 |
| storage typecheck | `tsc --noEmit` exit 0 |

## 剩余风险与后续

- 卡片当前展示用户级步骤、状态、耗时和修复提示；lane、retry 次数与 evidence preview 需要事件契约后续扩展，不能伪造。
- Timeline 是轻量产品日志，不替代加密 Evidence Vault 与安全审计。
- Phase 5.1 Overlay/系统状态依赖平台会话能力；Phase 5.3 去轮询依赖 Phase 7 Orchestrator 事件等待改造。

## 回滚

迁移为纯新增表；Timeline 注入为旁路。回滚代码后旧表可保留不读取，也可在后续兼容迁移中清理，不应直接破坏性删除用户数据。

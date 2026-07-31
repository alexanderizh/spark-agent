# Computer Use V2 · 实施进度总览

> 最后更新: 2026-07-31 | 关联计划: `docs/superpowers/plans/2026-07-30-computer-use-v2-reliability-and-collaboration.md`（状态: 实施中）

本文档是 V2 计划各阶段的运行中进度追踪。每阶段落地后追加一行；详细审查见同目录 `2026-07-31-computer-use-phase-*.md`。

## 已落地（已提交、已测试、已审查）

| 阶段                                         | Commit         | 测试 | 说明                                                                                                               |
| -------------------------------------------- | -------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| Wave 1（Phase 2.3 异步证据 + 部分 2.1）      | `352028245`    | 183  | 异步证据、Host 自愈 Stage A、codesign 缓存、诊断码、审批可中断、stale_frame 本地恢复                               |
| Phase 2.1 Host Supervisor 状态机             | `4731233b7`    | +8   | 心跳 5s/3 连败重启、有界重启(1)、onRebound 强制重绑、flag `SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR`                  |
| Phase 2.2 增量 AX 树（tree-diff 客户端切片） | `f03dd85a8`    | +5   | NativeHostTreeReconciler diff→full 重建、决策步可请求 diff、flag `SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE`          |
| Phase 3 动作批处理                           | `458e82a3c`    | +7   | ComputerDecision `actions` 变体(2-8)、逐动作审批、stale/noop 即停重规划、flag `SPARK_COMPUTER_USE_V2_ACTION_BATCH` |
| Phase 5.2 Timeline 产品链路                  | `a253f90c1` + `a97adb8cf` | +25  | 从内存 MVP 升级为 migration 064 持久化、14 类事件、实时流、Renderer 回放/去重卡片；5.1/5.3 仍待后续阶段 |
| Phase 0 诊断与指标代码切片                   | `本提交`       | +7   | 只读 IPC/MCP 诊断、Beta 标识、内容无关指标采集；真实失败包与性能样本待 Phase 1 签收                                |

Computer Use 相关回归：**41 文件 / 277 测试全过**（其中 7 个回环 HTTP 用例在允许监听 `127.0.0.1` 的测试环境运行）；storage **20 文件 / 226 测试全过**，迁移 064 已真实执行。desktop renderer/node 与 storage typecheck 均 exit 0；此前 Phase 2/3/5 严格测试类型债已清零。

## 进行中 / 待办

| 阶段                           | 类型          | 说明                                                                 |
| ------------------------------ | ------------- | -------------------------------------------------------------------- |
| Phase 0 真实基线样本           | 发布/真机签收 | macOS/Windows 失败安装包、冷启动/首次权限/四步任务真实样本           |
| Phase 5.1/5.3 控制状态与去轮询 | 原生 + 纯 TS  | 系统 Overlay/托盘状态并入 Phase 4；Orchestrator 事件等待并入 Phase 7 |
| Phase 7 灰度/迁移              | 纯 TS         | 统一 flag 框架 + 回退条件（依赖 Phase 0 指标）                       |
| Phase 4 人机协同               | 纯 TS         | 目标绑定、输入冲突规则、SparkWork 内部应用桥                         |
| Phase 6 会话级授权             | 安全评审门禁  | 动 T01 注入防御，需独立安全评审；做到交付物+签收清单                 |
| Phase 1 原生打包               | 原生/基建签收 | DMG/NSIS 握手、CI VM 矩阵、签名、干净 VM 黄金任务 100 次——需发布基建 |
| Phase 2.2 持久捕获（原生切片） | 原生签收      | SCStream/AXObserver/SCContentSharingPicker——macOS Swift/Windows Rust |

## 安全不变量（贯穿所有阶段，零回归）

click/type 基线 L1、T01 intent 升档、unknown→L2、L2/L3+unattended→handoff、sensitive→L4 handoff、codex-full-access/claude-bypass 跳过逐动作审批、digest/timeout fail-closed SIGKILL——所有已落地阶段均未触碰。

## flag 清单（均为环境变量，默认关；Phase 7 统一框架）

- `SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR` — Phase 2.1
- `SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE` — Phase 2.2
- `SPARK_COMPUTER_USE_V2_ACTION_BATCH` — Phase 3

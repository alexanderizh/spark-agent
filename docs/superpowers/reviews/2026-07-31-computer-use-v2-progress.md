# Computer Use V2 · 实施进度总览

> 最后更新: 2026-08-01 | 关联计划: `docs/superpowers/plans/2026-07-30-computer-use-v2-reliability-and-collaboration.md`（状态: 实施中）

本文档是 V2 计划各阶段的运行中进度追踪。每阶段落地后追加一行；详细审查见同目录 `2026-07-31-computer-use-phase-*.md`。

## 已落地（已提交、已测试、已审查）

| 阶段                                         | Commit                    | 测试 | 说明                                                                                                               |
| -------------------------------------------- | ------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| Wave 1（Phase 2.3 异步证据 + 部分 2.1）      | `352028245`               | 183  | 异步证据、Host 自愈 Stage A、codesign 缓存、诊断码、审批可中断、stale_frame 本地恢复                               |
| Phase 2.1 Host Supervisor 状态机             | `4731233b7`               | +8   | 心跳 5s/3 连败重启、有界重启(1)、onRebound 强制重绑、flag `SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR`                  |
| Phase 2.2 增量 AX 树（tree-diff 客户端切片） | `f03dd85a8`               | +5   | NativeHostTreeReconciler diff→full 重建、决策步可请求 diff、flag `SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE`          |
| Phase 3 动作批处理                           | `458e82a3c`               | +7   | ComputerDecision `actions` 变体(2-8)、逐动作审批、stale/noop 即停重规划、flag `SPARK_COMPUTER_USE_V2_ACTION_BATCH` |
| Phase 5.2 Timeline 产品链路                  | `a253f90c1` + `a97adb8cf` | +25  | 从内存 MVP 升级为 migration 064 持久化、14 类事件、实时流、Renderer 回放/去重卡片；5.1/5.3 仍待后续阶段            |
| Phase 0 诊断与指标代码切片                   | `f4d1c41b1`               | +7   | 只读 IPC/MCP 诊断、Beta 标识、内容无关指标采集；真实失败包与性能样本待 Phase 1 签收                                |
| Phase 6 治理瘦身                            | 本阶段提交                | +2   | L0/L1 无审批热路径保持异步；L2/L3 执行前同步固化 before-frame，失败不消费 ticket、不执行 backend                  |
| Phase 7 灰度与去轮询                        | 本阶段提交                | +6   | 统一 flag store、有界指标回退、Supervisor→基础连接回退、事件驱动 `wait_for_completion`                            |

Computer Use 最新主进程/协议/Renderer 回归：**45 文件 / 297 测试全过**（回环 HTTP 用例在允许监听 `127.0.0.1` 的测试环境运行）；storage **20 文件 / 226 测试全过**，迁移 064 已真实执行。desktop renderer/node、protocol 与 storage typecheck 均 exit 0；此前 Phase 2/3/5 严格测试类型债已清零。

## 进行中 / 待办

| 阶段                           | 类型          | 说明                                                                                                                                                              |
| ------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 真实基线样本           | 发布/真机签收 | macOS/Windows 失败安装包、冷启动/首次权限/四步任务真实样本                                                                                                        |
| Phase 5.1/5.3 控制状态与去轮询 | 原生 + 纯 TS  | 托盘/产品状态与事件等待已落地；原生透明 Overlay 仍需平台发布签收                                                                                                  |
| Phase 7 发布灰度               | 发布运营签收  | 5%→25%→100% 百分比放量与连续两个稳定版本后删旧路径需跨版本数据                                                                                                    |
| Phase 4 人机协同               | 原生 + TS     | macOS/Windows 对等代码、Tray/产品控制卡、AppControlBridge、精确窗口绑定/picker 已落地；真实签名桌面的 20 动作、状态一致性与 300 ms P99 待发布签收             |
| Phase 6 会话级授权             | 安全评审      | 自主代码与五轴/对抗审查完成；外部发布复核随总体签收执行                                                                                                           |
| Phase 1 原生打包               | 原生/基建签收 | DMG/NSIS 握手、CI VM 矩阵、签名、干净 VM 黄金任务 100 次——需发布基建                                                                                              |
| Phase 2.2 持久捕获（原生切片） | 原生签收      | SCStream/AXObserver/SCContentSharingPicker——macOS Swift/Windows Rust                                                                                              |

## 安全不变量（贯穿所有阶段，零回归）

click/type 基线 L1、T01 intent 升档、unknown→L2、L2/L3+unattended→handoff、sensitive→L4 handoff、codex-full-access/claude-bypass 跳过逐动作审批、digest/timeout fail-closed SIGKILL——所有已落地阶段均未触碰。

## flag 清单（统一注册表；实验链路默认关，已落地产品链路默认开）

- `SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR` — Phase 2.1
- `SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE` — Phase 2.2
- `SPARK_COMPUTER_USE_V2_ACTION_BATCH` — Phase 3
- `SPARK_COMPUTER_USE_V2_INSTALLED_ARTIFACT_DIAGNOSTICS` — Phase 0/1
- `SPARK_COMPUTER_USE_V2_PERSISTENT_CAPTURE` — Phase 2 原生持续捕获
- `SPARK_COMPUTER_USE_V2_BACKGROUND_SEMANTIC_LANE` — Phase 4
- `SPARK_COMPUTER_USE_V2_ACTIVITY_TIMELINE` — Phase 5
- `SPARK_COMPUTER_USE_V2_VISIBLE_CONTROL_INDICATOR` — Phase 4/5

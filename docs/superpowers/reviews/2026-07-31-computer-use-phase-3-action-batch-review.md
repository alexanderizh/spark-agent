# Computer Use V2 · Phase 3 动作批处理 阶段审查报告

> 日期: 2026-07-31 | 阶段: Phase 3 (WP6 批量规划) | 状态: 已落地（flag 默认关闭）

## 1. 需求覆盖

codex 看齐核心：模型一次决策可返回 2–8 步动作，省 N 次模型 round-trip（最大延迟/成本杠杆）。

| 计划要求 | 落地情况 |
| --- | --- |
| ComputerDecision 支持 1–8 步 batch | 新增 `{type:'actions', actions:[2..8], intent}` 变体，`MIN_BATCH_ACTIONS=2`/`MAX_BATCH_ACTIONS=8` |
| system prompt 允许 batch | `BATCH_DECISION_SYSTEM_PROMPT`（单动作 prompt 追加 batch 选项 + 「序列稳定才用、否则返回单动作」约束） |
| parseDecision 处理 batch | 数组校验（2–8）、逐动作 `ComputerActionSchema.safeParse` + `SUPPORTED_ACTIONS` 校验 |
| operator 顺序执行 batch | batch 分支循环每动作建独立 envelope、走 `dispatchWithApproval`（逐动作策略/审批），每步用上一步返回的新观察 |
| 失败即停、重规划 | 任一步 stale_frame/noop/可恢复错误 → 中止 batch + re-observe + 外层重决策；非可恢复错误抛出（与单动作一致） |
| flag 控制 | `SPARK_COMPUTER_USE_V2_ACTION_BATCH` 默认关；关时 prompt 要求单动作、operator 不遇 batch 决策 |

## 2. 安全论证（batch 的核心风险）

**风险**：batch 第 2–8 步基于 batch 前观察，而动作执行后树可能变化，后续元素动作可能失效或误中。

**论证安全**：
- 元素 id = `SHA256(runtimeID|index)`（`MacControlPolicy:203`），`runtimeID` 全局唯一 → **id 不会碰撞**。后续步的元素 id 在新树里要么仍指向原元素（id 持续有效）、要么不存在（Host 报错、安全失败），**绝不会误中不同元素**。
- 每步执行前 `dispatchWithApproval` 用最新观察重建 envelope；broker.execute 的 stale_frame 检查 + Host 的 elementId 解析共同保证「失效即失败」。
- stale_frame 被 dispatchWithApproval 内部的 relocateStaleFrame（Wave 1 item 6）优先本地恢复；若 relocate 也失败则冒泡到 batch catch → 中止 + 重规划。
- 逐动作仍过 policy/approval：L2 动作在 batch 内照常弹审批，未降级。

## 3. 主要文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `ComputerDecisionAdapter.ts` | 修改 | `actions` 决策变体；`BATCH_DECISION_SYSTEM_PROMPT`；parseDecision batch 分支 |
| `ComputerDecisionAdapter.test.ts` | 修改 | 5 个 batch 测试（解析、prompt 切换、<2 拒绝、不支持动作拒绝、allowBatch off 用单动作 prompt） |
| `ComputerTaskOperator.ts` | 修改 | decide 传 `allowBatch`；batch 执行分支（错误处理与单动作路径对齐） |
| `ComputerTaskOperator.test.ts` | 修改 | 2 测试：batch 顺序执行验证、batch 中止(noop)+重规划 |
| `computerUseV2Flags.ts` | 修改 | `isActionBatchEnabled` |

## 4. 验证证据

- `pnpm vitest run apps/desktop/src/main/services/computer-use/` → **30 文件 / 199 测试全过**。
- `pnpm -w tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0**。

## 5. 安全不变量核对（零回归）

- [x] click/type 基线 L1、T01 intent 升档、unknown→L2、handoff 各档、codex-full-access 跳过审批均未触碰。
- [x] 逐动作仍过 policy/approval（batch 不绕过）。
- [x] stale_frame/noop 处理与单动作语义一致；非可恢复错误仍抛出。
- [x] flag 关闭 = 模型只返回单动作，operator 走原单动作路径，零行为变化。

## 6. 遗留项

- **batch 决策质量需 eval**：flag 默认关。开启前建议对照任务（开 vs 关）确认模型在 batch 模式下的决策质量、误用率（理论上 prompt 已约束「序列稳定才用」）。
- **batch 内 L2 审批体验**：当前 batch 内每个 L2 动作仍逐个弹审批（Electron 模态框）。连续多个 L2 会打断流。Phase 6 会话级授权落地后可自然解决（同任务同类授权一次）。
- **batch 步间不 re-query 模型**：步间仅 re-observe（轻量），不重新决策；这是 batch 的省模型杠杆所在。

## 7. 回滚

- 关 flag：`SPARK_COMPUTER_USE_V2_ACTION_BATCH` 不设 → 单动作 prompt + 单动作路径，reconciler/batch 分支为死代码但不影响行为。
- 代码回退：移除 operator batch 分支 + adapter `actions` 变体即回退。

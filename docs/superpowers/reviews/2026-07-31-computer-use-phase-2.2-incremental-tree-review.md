# Computer Use V2 · Phase 2.2 增量 AX 树观察 阶段审查报告

> 日期: 2026-07-31 | 阶段: Phase 2.2 (WP6 差分观察的纯 TS 切片) | 状态: 已落地（tree-diff 切片，flag 默认关闭）

## 1. 范围与诚实边界

Phase 2.2 计划包含两大块：

1. **tree-diff（文本带宽优化）** — Host 发差分 `tree.text`，客户端重建完整文本。**Host 侧已存在**（`MacControlPolicy.publish` 已支持 `full`/`diff` 双模式），本阶段补齐**纯 TS 客户端**部分。
2. **持久捕获（SCStream + AXObserver + SCContentSharingPicker）** — macOS Swift / Windows Rust 原生工作，**非纯 TS，本阶段不做**，列为原生交付物签收项。

本报告只覆盖第 1 块（tree-diff 切片）。

## 2. 需求覆盖（tree-diff 切片）

| 计划要求 | 落地情况 |
| --- | --- |
| 协议支持 diff 观察 | 已存在（`observation.ts` `tree.mode:'full'\|'diff'`，`previousTreeVersion`） |
| Host 发射 diff | 已存在（`MacControlPolicy.publish` canDiff 逻辑） |
| 客户端从 diff 重建完整树文本 | **新增 `NativeHostTreeReconciler`**：diff 模式下从恒为全量的 `elements` 数组按 Host JSON 格式（sortedKeys、value 可选）重建 `tree.text`，mode 归一为 `full` |
| diff 不泄漏到模型 prompt | reconciler 放在 `observeWithRecovery` 返回处，所有决策/验证路径的观察先归一再消费 |
| 决策步可请求 diff 省 `tree.text` 带宽 | operator 6 个决策 observe 在 flag `SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE` 开启时传 `false`（diff-when-previous），Host 自身在 previous treeVersion 过期时回落 full（保护 recovery/首步） |
| execution_after 保留 diff | backend `execute` 的 re-observe 仍 `fullTree:false`，**不**经 observeWithRecovery，故保留原始 diff（省存储、诚实证据），未被破坏 |

## 3. 主要文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `NativeHostTreeReconciler.ts` | 新增 | 无状态 diff→full 重建；Host JSON 格式；失败回落原值 |
| `NativeHostTreeReconciler.test.ts` | 新增 | 5 测试：full 透传、diff→full 重建、字段保留、空数组、异常返回 null |
| `computerUseV2Flags.ts` | 修改 | 新增 `isIncrementalTreeEnabled` |
| `ComputerTaskOperator.ts` | 修改 | observeWithRecovery 返回前 reconcile；6 个决策 observe 用 `shouldRequestFullDecisionTree()`（flag 开→请求 diff） |

## 4. 安全性与等价性论证

- **模型输入等价**：重建文本源自 `elements` 数组——与 Host 全量请求时序列化的对象集相同，按相同 per-element JSON 形状（id/treeVersion/role/name/bounds/enabled/focused/actions/value）渲染。无论 Host 发 `full` 还是客户端从 `diff` 重建，adapter 收到的元素集与渲染形状一致；唯一差异是 `tree.text` 的传输字节数。
- **diff 不泄漏**：reconciler 在决策/验证消费点之前归一；execution_after 的 diff 不经此路径也不喂模型。
- **flag 关闭 = 零变化**：flag 关时 Host 总返回 full 模式，reconciler 是 no-op，operator 仍请求 full——与改造前行为完全一致。
- **Host 自保护**：recovery/首步时 previous treeVersion 与 Host currentVersion 不匹配 → Host `canDiff=false` → 返回 full。客户端无需额外处理。

## 5. 验证证据

- `pnpm vitest run apps/desktop/src/main/services/computer-use/` → **30 文件 / 193 测试全过**（含新增 5 个 reconciler 测试）。
- `pnpm -w tsc --noEmit -p apps/desktop/tsconfig.json` → **exit 0**。

## 6. 安全不变量核对（零回归）

- [x] click/type 基线 L1、T01 intent 升档、unknown→L2、handoff 各档、codex-full-access 跳过审批均未触碰。
- [x] digest/timeout fail-closed SIGKILL（NativeHostClient）未触碰。
- [x] execution_after diff 保留原语义（`NativeHostComputerUseBackend` 的 execute 测试全绿）。
- [x] 全链路无新增 `any`（reconciler 用 `unknown` + 类型收窄）。

## 7. 遗留项 / 原生签收清单

- **持久捕获（SCStream 替代逐次截屏、AXObserver 实时树更新、SCContentSharingPicker 窗口绑定）**：macOS Swift / Windows Rust 原生工作，非纯 TS 范围，列为 Phase 2.2 原生交付物签收项。
- **决策步 diff 开启需模型 eval**：flag 默认关。开启前建议跑一组对照任务（flag 开 vs 关）确认决策质量不回归（理论上等价，但 prompt 文本格式细节需经验证）。
- **`serializeElements` 与 `tree.text` 冗余**：adapter 同时消费两者；未来可考虑只用其一，进一步降 token，属 Phase 3/6 范围。

## 8. 回滚

- 关 flag：`SPARK_COMPUTER_USE_V2_INCREMENTAL_TREE` 不设 → 决策步恢复全量请求，reconciler 对 full 观察是 no-op。
- 代码回退：移除 operator 的 reconciler 调用与 `shouldRequestFullDecisionTree`、删除 reconciler 文件即回退。

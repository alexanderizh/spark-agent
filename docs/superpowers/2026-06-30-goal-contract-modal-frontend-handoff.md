# 前端对接：目标验收契约确认模态（给 UI agent）

> 状态: [待开发] | 最后核对: 2026-06-30

编排内核 M2「验收门槛 Gate」的后端 + CLI 已完成。前端契约确认模态因 `ChatView.tsx` / renderer `event-mapper.ts` 正被 UI agent 编辑（未提交），编排侧不便介入，故出此对接文档由 UI agent 实现。分支：`feat/unified-orchestration-kernel`。

## 背景流程（后端已就绪）

用户用 `/goal <目标>`（spark-loop 且未给验收标准）启动目标时：
1. 后端把目标置为 `pending_contract` 状态，**不直接开跑**，先跑一次「契约起草」turn。
2. 起草完成后后端 emit **`goal_contract_proposed`** 事件，携带编排者起草的验收契约。
3. 用户确认 → 目标转 `active` 并开始 Review→Act→Validate 循环；拒绝 → 清除目标。

目前确认/拒绝只能用 CLI：`/goal confirm` / `/goal reject`。前端要做的就是把这一步可视化。

## 需要消费的事件（已在 `@spark/protocol`）

`GoalEvent`（`packages/protocol/src/events/index.ts`）已新增：
- `GoalEventType` 增加 `'goal_contract_drafting'`（起草中）、`'goal_contract_proposed'`（契约已起草待确认）。
- `GoalEventStatus` 增加 `'pending_contract'`。
- `GoalEvent.proposedContract?: ProposedGoalContract`（**仅 `goal_contract_proposed` 携带**）：
  ```ts
  interface ProposedGoalContract {
    successCriteria: string[]   // 可验收标准
    constraints: string[]       // 约束/非目标
    validation: { commands?: string[]; checklist?: string[] }  // 验证命令/清单
  }
  ```
  事件还带 `goalId` / `objective` / `summary`。

## 前端要做的

1. **renderer `event-mapper.ts`**：把 `goal_contract_drafting` / `goal_contract_proposed` 映射成 UI 可渲染的消息/状态（参照现有 goal 事件如 `goal_started`/`goal_progress` 的映射方式）。`goal_contract_drafting` 可显示「正在起草验收契约…」；`goal_contract_proposed` 触发契约确认卡片/模态。
2. **契约确认模态/卡片**（建议新建独立组件，挂载点在 `ChatView.tsx`）：展示 `objective` + `successCriteria`（列表）+ `constraints` + `validation.commands`；提供「确认启动」「拒绝」两个操作；可选「编辑后确认」（编辑 successCriteria）。
3. **确认/拒绝动作**：最简做法——复用现有命令发送通道发 `/goal confirm`（确认）/ `/goal reject`（拒绝）。
   - 若要支持「编辑后确认」：后端 `confirmGoalContract` 已支持可选传入编辑后的契约（`{ successCriteria?, constraints?, validation? }`），但目前 CLI/deps 仅暴露无参确认。如需带编辑提交，需在 IPC/deps 暴露一个带 contract 参数的确认通道（后端 `SessionService.confirmGoalContract({ sessionId, contract })` 已具备能力，只差 IPC 暴露）——这块可与编排侧协调补 IPC。MVP 可先只做「确认/拒绝」无编辑。

## 验收点

- `/goal <目标>` 后出现「起草中」→「契约确认」卡片，展示验收标准。
- 点「确认」→ 目标开始执行（收到 `goal_started`/`goal_progress`）。
- 点「拒绝」→ 目标清除（收到 `goal_cleared`）。
- 后端已对全流程打审计日志（`goal gate: ...`），便于联调定位。

## 相关后端落点（只读参考，勿改）

- 起草/旁路：`session.service.ts` `setGoal` 门槛分支、`updateGoalContractFromAssistantBlock`。
- 确认/拒绝：`session.service.ts` `confirmGoalContract` / `rejectGoalContract`；命令在 `command-registry.ts` `/goal confirm|reject`。

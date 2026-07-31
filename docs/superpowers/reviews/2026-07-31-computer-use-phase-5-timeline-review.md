# Computer Use Phase 5 — Timeline 实时链路 阶段审查

> 日期: 2026-07-31 | 阶段: Phase 5 (V2 计划 §5) | 前置: Wave 1 / Phase 2.1 / 2.2 / 3

## 范围

把死代码 `computer-use:get-timeline`（一直抛 `environment_unavailable`）变为活的实时操作日志：内存事件存储 + broker 在动作生命周期转换点发射事件 + IPC 游标分页读取。

**本阶段为 MVP**：覆盖 broker 内可闭环的动作生命周期事件。session lifecycle / observation / verification 事件见「未覆盖」。

## 实现

### 1. `ComputerUseTimelineStore.ts`（新增）
- per-`computerSessionId` 有序事件 `Map<seq, event>`，每会话独立递增 `seq` 计数器。
- `record(input)`：自动赋 `id`（`crypto.randomUUID`，可注入）/ `seq`（per-session 递增）/ `timestamp`（`now().toISOString()`），返回完整事件。
- `read(computerSessionId, afterSeq?, limit?)`：按 seq 升序游标分页，`nextSeq` 为下一游标或 `null`（耗尽）。
- `clearSession` / `clear`：会话级与全局清理。
- `maxEventsPerSession` 默认 2000，超限按 seq 升序淘汰最旧（防内存膨胀）。
- 内存设计：进程重启丢失。**timeline 是 live 操作日志，非审计**（审计在 evidence store，已加密持久化）。

### 2. broker 发射点（`ComputerControlBroker`）
可选注入 `ComputerUseTimelineSink`（absent 时 broker 行为不变，保护现有测试）。在 `dispatchExclusive` 的 7 个转换点 `record`：
- `persistRequestedAction` 后 → `computer_action_requested`
- deny `blockAction` 后 → `computer_action_blocked`
- require_handoff 后 → `computer_handoff_required`
- require_approval（ticket==null）→ `computer_approval_requested`
- execute 成功 → `computer_action_executed`（before/after frameId）
- execute 失败（非 aborted）→ `computer_action_failed`
- noop → `computer_action_failed`（errorCode `action_noop`）

事件 provenance（sessionId/turnId）取自 `context.session`（`assertDispatchAllowed` 返回），零接口改动。

### 3. IPC（`registerComputerUseIpc`）
`computer-use:get-timeline` 从 `services().timeline.read(...)` 读取，去掉 `environment_unavailable` stub。

### 4. services 组装（`ComputerUseServices`）
`createComputerUseServices` 创建 `ComputerUseTimelineStore` 实例，注入 broker，类型暴露 `timeline`，`dispose` 时 `clear`。

## 测试证据

| 套件 | 结果 |
|---|---|
| `ComputerUseTimelineStore.test.ts` | 6 测试（seq 单调/跨会话独立/游标分页/空会话/淘汰/clearSession） |
| `ComputerControlBroker.test.ts` | 12 测试（含 3 新：executed/approval/noop 三路径 emit 断言） |
| `registerComputerUseIpc.test.ts` | 19 测试（含 2 新：游标分页读取 + 空会话；原 fail-closed 测试已更新） |
| **完整 computer-use + ipc 套件** | **32 文件 / 212 测试全过** |
| `tsc -p apps/desktop` | exit 0 |

## 安全不变量核对（零回归）

- timeline 是**只读旁路**：`record` 仅追加事件，**不进入 broker 控制流**（不读返回值、不影响 dispatch 决策）。
- policy / approval / handoff 升档逻辑（deny/handoff/approval 分支）**完全未改**，只是在这些分支内额外发了一个事件。
- click/type 基线 L1、T01 intent 升档、unknown→L2、L2/L3+unattended→handoff、sensitive→L4 handoff、codex-full-access 跳过逐动作审批 —— **均未触碰**。
- `stale_frame`/digest/timeout fail-closed —— 未触碰。

## 未覆盖（诚实标注，留 follow-up）

以下事件类型 protocol 已定义但本阶段**未发射**，因 broker 拿不到 provenance 或转换点不在 broker：

| 事件 | 原因 | follow-up 落点 |
|---|---|---|
| `computer_observation_created` | `observe` 入参仅 `computerSessionId`，`ComputerSessionController` 接口无 `get` 拿 sessionId/turnId | 给接口加 `get(id)` 或在 operator 层发 |
| `computer_session_started/completed/failed/canceled` | 转换点在 `ComputerSessionManager`（startSession/cancel/fail/complete） | SessionManager 注入 timeline |
| `computer_verification_started/completed` | 转换点在 `ComputerTaskOperator` | operator 注入 timeline |
| `computer_approval_resolved` | ticket consume 在 broker 内，但 approved/denied/expired 决策在 approval service / IPC | approval resolve 路径发 |

store 接口已支持这些事件类型（`ComputerUseTimelineInput` 覆盖全部 14 种），后续阶段只需补发射点。

## 风险

- **内存丢失**：进程重启 timeline 清空。可接受（live 日志），但若产品需要跨重启回放需后续持久化（非本阶段）。
- **并发**：`record` 是同步操作（Map set + 计数器自增），broker 单线程事件循环内调用，无竞争。
- **emit 失败**：`record` 是纯内存操作不抛；即使抛，broker 用 `?.` 可选链调用，不影响主流程。

## 回滚

- timeline 是可选注入，移除 services 组装里的 `timeline` 字段 + broker options 即完全回退到 stub 行为。
- 独立 commit，可单 `git revert`。

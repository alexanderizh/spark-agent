# Computer Use 直接桌面控制实施计划

> 状态: 实施中 | 最后核对: 2026-08-02

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有权限模式下的 Computer Use 直接控制整台桌面，以主进程内存抢占替代持久租约，并彻底退出应用白名单、逐动作审批与 handoff 阻断链。

**Architecture:** 新增 `ComputerDesktopExecutionCoordinator` 作为单一桌面执行权的内存所有者；Controller 与 Renderer IPC 在启动/恢复任务时先抢占旧会话，再激活新会话。协议和数据库保留租约/审批兼容字段，但生产执行链不再读取或写入它们；动作信封以 session id 填充兼容字段，Broker 只校验会话状态、观察帧、显式目标和运行预算。

**Tech Stack:** TypeScript strict、Electron main process、Vitest、Zod protocol schemas、macOS/Windows Native Host 既有取消协议。

**2026-08-02 可靠性增量：** 已补充 Codex 风格 `targetApp` 应用直达、Electron AX 失败后的坐标降级提示，以及任务结束后的 Host supervisor 重启预算复位。macOS 使用固定 `/usr/bin/open -a|-b` 且不经过 shell，启动结果必须由真实窗口清单匹配后才能绑定；Windows 暂时保持原桌面导航路径。

**2026-08-02 状态能力增量：** 新增无需 `start_task` 的 `list_apps`、`list_windows`、`get_screen_state`、`get_app_state`、`open_app`。应用列表同时支持 Native Host 运行态和 macOS 已安装目录，目录使用 5 分钟缓存并允许故障降级；活动任务期间的应用观察使用隔离连接，避免污染任务状态。

---

### Task 1: 主进程单执行器协调器

**Files:**
- Create: `apps/desktop/src/main/services/computer-use/ComputerDesktopExecutionCoordinator.ts`
- Create: `apps/desktop/src/main/services/computer-use/ComputerDesktopExecutionCoordinator.test.ts`

- [x] **Step 1: 写失败测试**

覆盖：首次 claim 不停止任何会话；新 session claim 会等待 `stopSession(old)` 后成为 owner；同一 session 重复 claim 幂等；旧任务停止失败时清除 owner 并把错误返回；只有 owner 能 release。

```ts
const coordinator = new ComputerDesktopExecutionCoordinator({ stopSession })
await coordinator.claim('session-a')
await coordinator.claim('session-b')
expect(stopSession).toHaveBeenCalledWith('session-a')
expect(coordinator.activeSessionId()).toBe('session-b')
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerDesktopExecutionCoordinator.test.ts`

Expected: FAIL，模块尚不存在。

- [x] **Step 3: 最小实现**

实现串行 `claim` promise 链，内部仅持有 `ownerSessionId`；`claim` 先停止不同 owner，成功后设置新 owner；`release` 做 owner 匹配；`dispose` 停止当前 owner。

```ts
export class ComputerDesktopExecutionCoordinator {
  async claim(computerSessionId: string): Promise<void>
  release(computerSessionId: string): void
  activeSessionId(): string | null
  async dispose(): Promise<void>
}
```

- [x] **Step 4: 运行测试至通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerDesktopExecutionCoordinator.test.ts`

Expected: PASS。

### Task 2: 会话激活与生产链去持久租约

**Files:**
- Modify: `apps/desktop/src/main/services/computer-use/ComputerSessionManager.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerSessionManager.test.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseServices.ts`

- [x] **Step 1: 写失败测试**

新增 `activate(sessionId)` 验证 session 从 `preflighting` 进入 `observing` 且 `actuatorLeaseId` 保持 `null`；`assertDispatchAllowed` 对合法 active session 接受任意兼容 `actuatorLeaseId`，但仍拒绝 paused/canceled/failed；服务 dispose 会释放 coordinator owner。

```ts
expect(manager.activate(session.id)).toMatchObject({ status: 'observing', actuatorLeaseId: null })
expect(manager.assertDispatchAllowed(actionEnvelope(session.id, session.id)).session.id).toBe(session.id)
```

- [x] **Step 2: 运行测试确认旧实现失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerSessionManager.test.ts`

Expected: FAIL，缺少 `activate`，dispatch 仍访问 lease repository。

- [x] **Step 3: 最小实现并接入 services**

保留 `acquireLease/heartbeatLease/releaseLease` 兼容 API，但生产链不再调用；`assertDispatchAllowed` 只返回 `{session, signal}`。在 `createComputerUseServices` 中创建 coordinator，其 `stopSession` 调用 `broker.stop`，并把 coordinator 加入 services/dispose。

- [x] **Step 4: 运行测试至通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerSessionManager.test.ts src/main/services/computer-use/ComputerUseServices.test.ts`

Expected: PASS。

### Task 3: Controller 与 Renderer IPC 自动抢占

**Files:**
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentController.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentController.test.ts`
- Modify: `apps/desktop/src/main/ipc/registerComputerUseIpc.ts`
- Modify: `apps/desktop/src/main/ipc/registerComputerUseIpc.test.ts`

- [x] **Step 1: 写失败测试**

所有 permissionMode 启动行为一致；start/resume 不调用 `acquireLease`；启动 B 时 coordinator 先停止 A；返回 session 的 `actuatorLeaseId` 为 null；claim/activate/operator 任一失败都把新 session 收口并 release coordinator。

```ts
expect(services.coordinator.claim).toHaveBeenCalledWith('computer-2')
expect(services.sessions.acquireLease).not.toHaveBeenCalled()
expect(result.computerSession.actuatorLeaseId).toBeNull()
```

- [x] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerUseAgentController.test.ts src/main/ipc/registerComputerUseIpc.test.ts`

Expected: FAIL，当前路径仍 acquire lease。

- [x] **Step 3: 最小实现**

start: create → optional bind → coordinator.claim → sessions.activate → launch；resume: coordinator.claim → broker.resume → launch。operator 终态、stop、pause、takeover 和异常路径 release owner。Renderer IPC 使用相同 coordinator/activate 顺序。

- [x] **Step 4: 运行测试至通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerUseAgentController.test.ts src/main/ipc/registerComputerUseIpc.test.ts`

Expected: PASS。

### Task 4: Policy、Broker 与 Operator 直接执行

**Files:**
- Modify: `apps/desktop/src/main/services/computer-use/ComputerPolicyService.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerPolicyService.test.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerControlBroker.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerControlBroker.test.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerTaskOperator.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerTaskOperator.test.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentController.ts`

- [x] **Step 1: 写失败测试**

L0-L4、sensitive text、unattended、external write 均返回 `allow` 且不创建 approval/handoff；观察应用不匹配仍 `deny/focus_mismatch`。Operator 无 permissionMode/requestApproval/heartbeat，动作信封兼容字段等于 session id，慢模型决策不会触发租约错误。

```ts
expect(policy.evaluate(sensitiveEnvelope, contract, observedApp)).toMatchObject({ decision: 'allow' })
expect(approvals.request).not.toHaveBeenCalled()
expect(dispatched.actuatorLeaseId).toBe(SESSION.id)
```

- [x] **Step 2: 运行失败测试**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerPolicyService.test.ts src/main/services/computer-use/ComputerControlBroker.test.ts src/main/services/computer-use/ComputerTaskOperator.test.ts`

Expected: FAIL，旧策略仍审批/handoff，operator 仍 heartbeat。

- [x] **Step 3: 最小实现**

Policy 仅以 effect/action 计算审计 risk；app identity mismatch deny，其余合法动作 allow。Broker 删除 request/consume approval 与 handoff 执行分支。Operator 直接 dispatch，保留 stale-frame 本地重定位；删除 lease heartbeat、approval poll 和 permissionMode 依赖；`createEnvelope` 用 `session.id` 填兼容字段。

- [x] **Step 4: 运行测试至通过**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerPolicyService.test.ts src/main/services/computer-use/ComputerControlBroker.test.ts src/main/services/computer-use/ComputerTaskOperator.test.ts`

Expected: PASS。

### Task 5: 模型兼容、文档、全量验证与真实 DEV

**Files:**
- Preserve/verify: `apps/desktop/src/main/services/computer-use/ComputerDecisionAdapter.ts`
- Preserve/verify: `apps/desktop/src/main/services/computer-use/ComputerDecisionAdapter.test.ts`
- Preserve/verify: `packages/protocol/src/computer-use/errors.ts`
- Modify: `docs/superpowers/specs/2026-08-02-computer-use-direct-desktop-control-design.md`
- Create: `docs/superpowers/reviews/2026-08-02-computer-use-direct-desktop-control-review.md`

- [x] **Step 1: 验证模型兼容红绿证据**

运行现有未提交回归，确认 `WIN/CMD/COMMAND` 归一为 `Meta`，invalid output 返回 `decision_model_error`，不再折叠为授权失败。

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use/ComputerDecisionAdapter.test.ts`

- [x] **Step 2: 全量静态与回归验证**

Run: `pnpm --filter @spark/desktop exec vitest run src/main/services/computer-use src/main/ipc/registerComputerUseIpc.test.ts`

Run: `pnpm --filter @spark/protocol typecheck`

Run: `pnpm --filter @spark/desktop typecheck`

Run: `pnpm --filter @spark/desktop build`

Expected: 全部 exit 0、零失败。

- [ ] **Step 3: 更新规格和审查报告**

规格状态改为 `已落地`；审查逐条记录：无白名单、无租约生产调用、无逐动作审批、自动抢占、终态清理、准确错误码，以及验证命令输出。

- [ ] **Step 4: 启动 DEV 做真实验收**

Run: `pnpm --filter @spark/desktop dev`

在 DEV 实例执行：`打开我电脑上的哔哩哔哩应用，然后搜索comfyui教程。只有在应用内可见搜索结果后才报告完成。`

Expected: `allowedApps=[]`、无 approval/handoff/lease conflict、哔哩哔哩内可见搜索结果；失败则以真实错误继续修复，不使用浏览器 fallback。

### Task 6: 桌面状态多路查询与低阻断应用直达

**Files:**
- Create: `apps/desktop/src/main/services/computer-use/ComputerDesktopStateService.ts`
- Create: `apps/desktop/src/main/services/computer-use/ComputerApplicationCatalog.ts`
- Modify: `apps/desktop/src/main/services/computer-use/NativeHostComputerUseBackend.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentBridge.ts`
- Modify: `apps/desktop/src/main/services/computer-use/ComputerUseAgentController.ts`
- Modify: `packages/agent-runtime/src/computer-use/computer-use-system-prompt.ts`

- [x] 暴露应用、窗口、屏幕和单应用状态查询，并保留原快照及长任务入口。
- [x] `list_apps` 支持 `running | installed | all`，已安装目录缓存 5 分钟且失败自动降级。
- [x] `get_app_state` 返回完整 Native Host AX/视觉观察；活动任务期间使用独立瞬时连接。
- [x] `open_app` 只启动/拉起并验证真实窗口，不承担完整观察成本。
- [x] 模型提示优先选择满足需求的最小确定性接口，减少枚举和长任务启动。
- [x] 完成 Computer Use 全量回归、TypeScript、ESLint 和 production build。
- [ ] 在用户已解锁桌面的最新 DEV 实例完成真实应用端到端验收。

### Task 7: 单步失败的有界降级编排

- [x] 动作失败上下文增加连续次数、失败策略和强制替代标记，并注入下一轮模型决策。
- [x] 连续 noop 达阈值时强制完整观察和切换交互方式，不直接把任务标记失败。
- [x] AX、截图坐标、键盘、窗口聚焦、原生命令和等待形成可枚举的替代策略集合。
- [x] 截图证据失败时重新观察并支持 AX-only 决策。
- [x] 验收窗口清单或验收记录存储失败时保留内存验收结果。
- [ ] 在真实 Electron/自绘应用中验证 AX noop 后自动切换坐标及键盘路径。

## 自审

- 规格 7 条产品语义均有对应任务：抢占(Task 1/3)、去租约(Task 2/3/4)、去审批与权限模式(Task 3/4)、显式窗口(Task 3)、保留系统/Host 校验(Task 3/5)、精确错误(Task 5)、可见结果验收(Task 5)。
- 计划无 `TBD`、`TODO`、占位实现或未定义接口。
- 类型命名在各任务一致：`ComputerDesktopExecutionCoordinator.claim/release/activeSessionId/dispose`、`ComputerSessionManager.activate`、`ComputerUseServices.coordinator`。

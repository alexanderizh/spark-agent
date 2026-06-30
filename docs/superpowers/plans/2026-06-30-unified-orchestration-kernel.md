# 统一编排内核 实现计划（M1 详细 + M2–M6 路线图）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 goal/loop、workflow、team 三套执行机制收敛成一个编排内核，并修复代码还原点；本里程碑（M1）只做「派发底座从 team mode 解绑」——让 A2A 派发引擎可在非 team 场景复用，且 team 不退化。

**Architecture:** 复用已有 `TeamDispatchService` + `agent_dispatch` in-process MCP，引入「允许 worker 集合」抽象把派发校验从 `teamConfig.memberAgentIds` 解耦。M1 是纯能力泛化 + 回归保护，不接线到 goal/workflow（那在 M3/M4）。

**Tech Stack:** TypeScript (ESM, `.js` 导入后缀)、Vitest、Claude Agent SDK in-process MCP（`createSdkMcpServer`/`tool`）、better-sqlite3（storage，测试时 mock）。

**配套 spec：** `docs/superpowers/specs/2026-06-30-unified-orchestration-kernel-design.md`

**分支：** `feat/unified-orchestration-kernel`（基于 develop）。

---

## 重要前置约定（每个 task 适用）

- **并发冲突警戒**：develop 上有其他 agent 并行改 `session.service.ts`/`claude-sdk-executor.ts`/`sdk/types.ts`/`scheduled-task.service.ts`。开工前 `git fetch origin develop` 并视情况 rebase；遵循项目记忆「跳过检测-并发编辑时」——若发现这些文件正被他人改动，只验证自己改动、不跑全量 typecheck/单测。
- **影响分析**：CLAUDE.md 要求改符号前跑 `gitnexus_impact`。**当前会话 gitnexus MCP 未连接**——回落到手工 caller 分析：改任一导出符号前先 `grep -rn "<symbol>" packages apps`。MCP 可用时优先用 `gitnexus_impact({target, direction:"upstream"})`。
- **测试命令**：`pnpm --filter @spark/agent-runtime test -- <file>`（vitest）。若该包脚本名不同，用 `pnpm --filter @spark/agent-runtime exec vitest run <file>`。
- **rename 推迟**：spec §4 的 `spark_team → spark_orchestrate` 重命名属**破坏性改动**（影响 `mcp__spark_team__*` 工具全限定名、已存预设）。M1 **不做重命名**，只做能力泛化；重命名挪到 M6（稳定后统一做、保留别名）。M1 完成后同步在 spec §13 里程碑表标注此调整。

---

## M1 文件结构

- Modify: `packages/agent-runtime/src/services/team-dispatch.service.ts`
  - `TeamDispatchRunContext` 增加可选 `allowedWorkerIds?: ReadonlySet<string>`
  - `run()` 校验逻辑改为基于「允许集合」（缺省回落 `teamConfig.memberAgentIds`）
- Modify: `packages/agent-runtime/src/services/team-dispatch.service.test.ts`
  - 新增「allowedWorkerIds 放行非 team 成员」「集合外拒绝」两类用例
- 不改 `session.service.ts`（team 调用方暂不传 `allowedWorkerIds`，行为不变）

> 设计要点：`run()` 当前用 `member = ctx.members.find(...)` + `!ctx.teamConfig.memberAgentIds.includes(...)` 双重判定。泛化后统一为：`member` 必须在 `ctx.members` 里，且其 id 必须在 `effectiveAllowedIds = ctx.allowedWorkerIds ?? new Set(ctx.teamConfig.memberAgentIds)` 里。team 不传 `allowedWorkerIds` → 行为完全不变。

---

## M1 任务

### Task 1: 为 allowedWorkerIds 写失败测试

**Files:**
- Test: `packages/agent-runtime/src/services/team-dispatch.service.test.ts`

- [ ] **Step 1: 在测试文件末尾的 `describe('TeamDispatchService', ...)` 内新增用例**

```typescript
  it('allows dispatch to a worker in allowedWorkerIds even if not in team roster', async () => {
    // worker 'planner' 不在 teamConfig.memberAgentIds，但在 allowedWorkerIds 内（workflow 场景）
    const { ctx, events } = makeCtx({
      members: [{ id: 'planner', name: 'Planner' }],
      allowedWorkerIds: new Set(['planner']),
    })
    const reply = await service.run(makeTask('planner'), ctx)

    expect(reply.state).toBe('completed')
    expect(reply.memberAgentId).toBe('planner')
    expect(events.map((e) => e.type)).toContain('team_dispatch_completed')
  })

  it('rejects dispatch to a worker outside allowedWorkerIds', async () => {
    const { ctx } = makeCtx({
      members: [{ id: 'planner', name: 'Planner' }],
      allowedWorkerIds: new Set(['planner']),
    })
    const reply = await service.run(makeTask('intruder'), ctx)

    expect(reply.state).toBe('failed')
    expect(reply.error?.code).toBe('member_disabled')
  })

  it('falls back to teamConfig.memberAgentIds when allowedWorkerIds is absent (team unchanged)', async () => {
    const { ctx } = makeCtx() // 无 allowedWorkerIds
    const reply = await service.run(makeTask('reviewer'), ctx)
    expect(reply.state).toBe('completed')
  })
```

- [ ] **Step 2: 运行测试，确认前两条失败**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/services/team-dispatch.service.test.ts`
Expected: 新增的「allows dispatch ... in allowedWorkerIds」失败（`allowedWorkerIds` 还不是 `TeamDispatchRunContext` 字段 → TS 报错或 'planner' 不在 roster 被判 member_disabled）。第三条（fallback）应通过。

### Task 2: 在 TeamDispatchRunContext 增加 allowedWorkerIds 字段

**Files:**
- Modify: `packages/agent-runtime/src/services/team-dispatch.service.ts`（`TeamDispatchRunContext` 接口，约 line 35）

- [ ] **Step 1: 在接口里加字段**

在 `TeamDispatchRunContext` 的 `teamConfig: TeamModeConfig` 下方加：

```typescript
  /**
   * 允许被派发的 worker id 集合。缺省时回落 teamConfig.memberAgentIds（team 行为不变）。
   * workflow/goal 编排场景显式传入：workflow 来自节点 agentId，goal 来自其可用 worker。
   */
  allowedWorkerIds?: ReadonlySet<string>
```

- [ ] **Step 2: 运行测试，确认 TS 编译通过但逻辑仍未生效**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/services/team-dispatch.service.test.ts`
Expected: 「allows dispatch ... allowedWorkerIds」仍失败（校验逻辑还在用 teamConfig），但不再是类型错误。

### Task 3: 泛化 run() 校验逻辑

**Files:**
- Modify: `packages/agent-runtime/src/services/team-dispatch.service.ts`（`run()` 校验段，约 line 99-104）

- [ ] **Step 1: 替换 member 校验**

把现有：

```typescript
    if (member == null || !ctx.teamConfig.memberAgentIds.includes(task.memberAgentId)) {
      return fail(
        'member_disabled',
        `Member "${task.memberAgentId}" is not enabled in this team session. Available members: [${ctx.teamConfig.memberAgentIds.join(', ')}].`,
      )
    }
```

改为：

```typescript
    const effectiveAllowedIds = ctx.allowedWorkerIds ?? new Set(ctx.teamConfig.memberAgentIds)
    if (member == null || !effectiveAllowedIds.has(task.memberAgentId)) {
      return fail(
        'member_disabled',
        `Worker "${task.memberAgentId}" is not enabled in this session. Available: [${[...effectiveAllowedIds].join(', ')}].`,
      )
    }
```

- [ ] **Step 2: 运行测试，确认全部通过**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/services/team-dispatch.service.test.ts`
Expected: PASS（含原有 team 用例 + 3 条新用例）。

- [ ] **Step 3: 跑该包类型检查（若并发未占用该文件）**

Run: `pnpm --filter @spark/agent-runtime exec tsc --noEmit`
Expected: 无新增错误。（若 `session.service.ts` 正被他人改动报错，按记忆「跳过检测-并发编辑时」只确认本文件相关无误。）

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/services/team-dispatch.service.ts \
        packages/agent-runtime/src/services/team-dispatch.service.test.ts
git commit -m "feat(orchestration): M1 派发校验从 team 名单泛化为 allowedWorkerIds

TeamDispatchService 不再硬依赖 teamConfig.memberAgentIds；缺省回落保持 team 行为不变，
为 goal/workflow 复用派发引擎铺路。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 4: team 回归确认 + 收尾

- [ ] **Step 1: 跑 team 相关全部测试**

Run: `pnpm --filter @spark/agent-runtime exec vitest run src/services/team-dispatch.service.test.ts src/services/team-roster-prompt.test.ts`
Expected: 全 PASS，team 无退化。

- [ ] **Step 2: 手工确认无其它调用方依赖被改的报错文案**

Run: `grep -rn "is not enabled in this team session" packages apps`
Expected: 无残留引用（旧文案已移除，无测试硬断言该字符串）。若有断言需同步更新。

- [ ] **Step 3: 在 spec 标注 rename 推迟到 M6**

编辑 `docs/superpowers/specs/2026-06-30-unified-orchestration-kernel-design.md` §13 M1 行，追加：「（rename `spark_team→spark_orchestrate` 推迟至 M6）」。提交：

```bash
git add docs/superpowers/specs/2026-06-30-unified-orchestration-kernel-design.md
git commit -m "docs(orchestration): M1 完成，标注 spark_team 重命名推迟至 M6

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## M1 自检

- **Spec 覆盖**：M1 对应 spec §6「允许 worker 集合」泛化 + §13 里程碑 M1。✅
- **占位符扫描**：无 TBD/TODO，所有 step 含真实代码/命令。✅
- **类型一致**：字段名 `allowedWorkerIds`、变量 `effectiveAllowedIds` 全计划统一。✅
- **不退化保证**：team 路径不传 `allowedWorkerIds` → `new Set(teamConfig.memberAgentIds)` → 行为等价。✅

---

# M2–M6 路线图（每个里程碑落地后再现制详细计划）

> 现制原则：每个里程碑开工前，基于**当时真实代码**（前序里程碑已落地的签名/类型 + develop 并发改动）再写该里程碑的 bite-sized 详细计划，避免后段计划过期。

### M2 验收门槛 Gate
- **落点**：`command-registry.ts:597`（/goal handler）、`session.service.ts`（`setGoal`/goal 启动路径）、新增契约起草逻辑、前端 ChatView 契约确认弹窗。
- **核心**：goal/loop/带工作流任务启动时若 `successCriteria` 为空 → 编排者据 objective 起草「目标成果 + 可验收标准 + 验证命令」→ 走现有 plan/approval 通道弹给用户确认/编辑 → 确认后才进循环；契约不完整拒跑。
- **验收**：契约起草、用户确认、拒跑路径各有测试；UI 流程闭环。

### M3 编排者约束 + budget 下传
- **落点**：`session.service.ts` 编排 turn 的工具集构造、`createTeamMcpServer` 注入点、budget 传递到 dispatch。
- **核心**：编排模式下默认硬约束工具集（只 dispatch + validate + loop-control，收起文件写/执行类）；定义「可退化」明确规则（如：无 agent/subagent worker 可派 且 任务单步可完成 → 退化自执行）；goal `budget` 下传覆盖整棵 worker 树。
- **验收**：硬约束生效、退化规则单测、预算树级耗尽测试。

### M4 工作流执行器（完整版）
- **落点**：`buildWorkflowSystemPrompt`（`session.service.ts:5271`）替换为执行器驱动；新增执行器模块；`WorkflowEdge` 加 `condition`；新增 workflow-run 持久化 repository（`packages/storage`）。
- **核心**：拓扑序（复用 `orderWorkflowNodes`）→ agent/subagent 节点 `agent_dispatch`（worker 集合来自节点 agentId + 临时 subagent）、原子节点（skill/tool/mcp/verify/approval/input/artifact）编排者自执行；`outputKey→inputs` 状态传递；`retryCount` 重试；并行分支（`agent_dispatch_batch` + `parallelism`）；条件边（安全子集求值）；节点级模型切换（每节点独立 dispatch/executor）；断点续跑（运行态落库，恢复跳过已完成节点）。
- **依赖**：M1（派发泛化）、M3（编排约束 + worker 来源）。
- **验收**：拓扑/派发/状态/重试/并行/条件边/断点续跑/节点模型 各有测试。

### M5 Checkpoint 修复
- **落点**：`sdk/event-mapper.ts:260`（移除死 `msg.checkpoint` 分支）、`sdk/claude-sdk-executor.ts`（采集 user-message UUID）、`session.service.ts`（`listSessionCheckpointsFromEvents`→基于 turn 锚点；`restoreCheckpoint`→`rewindFiles`）、`packages/storage`（turn 锚点字段）、前端 `CheckpointTimelinePanel.tsx`（dryRun 预览 + 入口显隐）。
- **核心**：采集 SDK user-message UUID 持久化为 turn 锚点 → list = 会话历史 turn → restore = `rewindFiles(uuid, {dryRun})` 预览→确认→回滚；不支持场景（team worker/checkpointing 关闭/canRewind=false）**隐藏入口**并记审计日志；弃用自研路径拷贝。
- **独立**：不依赖 M1–M4，可并行/插队。
- **验收**：list 从锚点产出、rewindFiles restore（含 dryRun）、不可还原隐藏入口 各有测试。

### M6 可观测 + 收尾 + rename
- **落点**：全链路（编排/派发/验收/循环/节点/checkpoint）接入现有日志审计；`spark_team→spark_orchestrate` 重命名 + 别名；端到端联调；文档刷新（spec 状态行、相关 reference 文档）；测试补齐到 §3.A 基线。
- **核心**：可观测性达标、命名统一、生产可交付验收。
- **验收**：§3.A 验收基线逐项过；端到端流程演示。

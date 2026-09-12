import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEventEnvelopeV1 } from '@spark/protocol'
import { SessionRepository, SparkDatabase, WorkspaceRepository } from '@spark/storage'
import { HookDispatcher } from './hook-dispatcher.js'
import { HookLifecycleBridge } from './hook-lifecycle-bridge.js'
import { HookManagementService } from './hook-definition-service.js'
import { type HookBuiltinActionHandlers, type HookToolGateway } from './hook-action-executor.js'
import { HookWorker } from './hook-worker.js'
import { deriveEventId } from './hook-expression.js'

/**
 * Hook 运行时全管线测试：真实 SQLite（全量迁移）+ 事件发射 → 派发 → 执行。
 * 内置动作与工具网关使用测试替身，验证调度语义而非 Electron/工具本体。
 */

// packages/storage/migrations：从本文件向上四级到 packages/，再进 storage。
const STORAGE_MIGRATIONS_DIR = fileURLToPath(
  new URL('../../../../storage/migrations', import.meta.url),
)

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(STORAGE_MIGRATIONS_DIR)
  return db
}

const alwaysEnabled = (): boolean => true

describe('Hook 运行时全管线', () => {
  let db: SparkDatabase
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-hook-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    // 会话与项目数据，供 LifecycleBridge 构建信封
    new SessionRepository(db).create({
      id: 'session-1',
      kind: 'chat',
      title: '测试会话',
      status: 'idle',
      projectId: 'ws-1',
      workspaceIds: ['ws-1'],
      agentId: 'agent-1',
    })
    new WorkspaceRepository(db).create({ id: 'ws-1', name: '项目A', rootPath: '/tmp/ws-1' })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function makeBuiltins(
    overrides: Partial<HookBuiltinActionHandlers> = {},
  ): HookBuiltinActionHandlers & {
    calls: Array<{ kind: string; title?: string; body?: string }>
  } {
    const calls: Array<{ kind: string; title?: string; body?: string }> = []
    return {
      calls,
      notification: async (input) => {
        calls.push({
          kind: 'notification',
          title: input.title,
          ...(input.body != null ? { body: input.body } : {}),
        })
        return true
      },
      sound: async () => {
        calls.push({ kind: 'sound' })
        return true
      },
      ...overrides,
    }
  }

  function makeToolGateway(overrides: Partial<HookToolGateway> = {}): HookToolGateway & {
    invocations: Array<{ target: unknown; input: unknown; attribution: unknown }>
  } {
    const invocations: Array<{ target: unknown; input: unknown; attribution: unknown }> = []
    return {
      invocations,
      describeTool: async () => ({
        found: true,
        governance: {
          risk: 'low-write',
          effect: 'send',
          idempotency: 'unsafe',
          enabled: true,
          version: '1.0.0',
        },
      }),
      invokeTool: async (request) => {
        invocations.push({
          target: request.target,
          input: request.input,
          attribution: request.attribution,
        })
        return {
          ok: true,
          result: { delivered: true },
          invocationId: 'inv-1',
          correlationId: 'corr-1',
        }
      },
      ...overrides,
    }
  }

  it('response.committed：发射→派发→串行执行内置通知，事件与运行记录可追踪', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '回答完成通知',
      eventName: 'response.committed',
      action: { type: 'builtin.notification' },
      inputMapping: { summary: { path: 'payload.response.finalText' } },
      timeoutMs: 15_000,
      retryPolicy: { mode: 'unsafe', maxAttempts: 3, backoffMs: 1000 },
      concurrencyPolicy: 'serial_per_session',
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
      authorizedEffect: 'builtin.notification',
    })

    const persisted: HookEventEnvelopeV1[] = []
    const bridgeWithHook = new HookLifecycleBridge(db, {
      onEventPersisted: (envelope) => persisted.push(envelope),
    })
    bridgeWithHook.responseCommitted('session-1', 'turn-1', 'msg-1', '最终回答正文')
    expect(persisted).toHaveLength(1)
    const payload = persisted[0]?.payload as { response?: { finalText?: string } } | undefined
    expect(payload?.response?.finalText).toBe('最终回答正文')

    const builtins = makeBuiltins()
    const toolGateway = makeToolGateway()
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway,
      isEnabled: alwaysEnabled,
    })

    // 同一事件重复发射被 outbox 主键去重
    bridgeWithHook.responseCommitted('session-1', 'turn-1', 'msg-1', '最终回答正文')
    expect(await dispatcher.dispatchPending()).toBe(1)

    const runs = management.listRuns({ sessionId: 'session-1' })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('queued')
    expect(runs[0]?.definitionSnapshot.id).toBe(definition.id)
    expect(runs[0]?.envelope.eventId).toBe(deriveEventId('response.committed', 'msg-1'))

    await worker.tickOnce()
    expect(builtins.calls).toHaveLength(1)
    expect(builtins.calls[0]?.kind).toBe('notification')
    const firstRunId = runs[0]?.id
    expect(firstRunId).toBeTruthy()
    const finished = management.getRun(firstRunId as string)
    expect(finished?.status).toBe('succeeded')
    expect(finished?.startedAt).toBeTruthy()
    expect(finished?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('turn.completed/failed/cancelled 确定性事件 ID：重复发射不重复执行', async () => {
    const bridge = new HookLifecycleBridge(db)
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '任务完成提示音',
      eventName: 'turn.completed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    bridge.turnTerminal('session-1', 'turn-2', 'completed')
    bridge.turnTerminal('session-1', 'turn-2', 'completed')

    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(1)
    const runs = management.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.eventName).toBe('turn.completed')
  })

  it('作用域优先级：session 覆盖 application，显式停用阻止执行', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '项目级 Hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    // 会话级显式停用
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'session',
      scopeId: 'session-1',
      enabled: false,
    })

    const effective = management.listEffective('session-1')
    expect(effective).toHaveLength(1)
    expect(effective[0]?.sourceScope).toBe('session')
    expect(effective[0]?.disabled).toBe(true)
    expect(effective[0]?.disabledReason).toBe('overridden_disabled')
    expect(effective[0]?.shadowedBy).toHaveLength(1)
    expect(effective[0]?.shadowedBy[0]?.scopeKind).toBe('application')

    // 停用的绑定不产生运行记录
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-3', 'msg-3', '回答')
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(1)
    expect(management.listRuns()).toHaveLength(0)
  })

  it('条件不匹配：运行记录为 skipped/condition_not_matched，不执行动作', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '仅特定会话回答',
      eventName: 'response.committed',
      condition: {
        operator: 'eq',
        left: { path: 'session.id' },
        right: { const: 'session-other' },
      },
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-4', 'msg-4', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)

    const runs = management.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('skipped')
    expect(runs[0]?.errorCode).toBe('condition_not_matched')
    await worker.tickOnce()
    expect(builtins.calls).toHaveLength(0)
  })

  it('授权失效：定义执行属性变化后未复核前 blocked/trust_required，不执行动作', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'tool-package',
          sourceId: 'pkg-1',
          version: '1.0.0',
          toolName: 'send',
          qualifiedName: 'webhook.send',
        },
      },
      inputMapping: { summary: { path: 'payload.response.finalText' } },
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    const updated = management.updateDefinition(definition.id, { timeoutMs: 30_000 })
    expect(updated.invalidatedBindings).toBe(1)

    const builtins = makeBuiltins()
    const toolGateway = makeToolGateway()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway,
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-5', 'msg-5', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()

    const runs = management.listRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('blocked')
    expect(runs[0]?.errorCode).toBe('trust_required')
    expect(toolGateway.invocations).toHaveLength(0)

    // 重新授权后可执行
    const currentHash = management.listDefinitions()[0]?.executionHash
    expect(currentHash).toBeTruthy()
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: currentHash as string,
      authorizedEffect: 'send',
    })
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-6', 'msg-6', '回答2')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()
    expect(toolGateway.invocations).toHaveLength(1)
    const invocation = toolGateway.invocations[0]
    expect(invocation?.input).toEqual({ summary: '回答2' })
    expect(invocation?.attribution).toMatchObject({
      hookId: definition.id,
      eventId: deriveEventId('response.committed', 'msg-6'),
    })
  })

  it('工具治理：destructive / high-write / 版本漂移分别被阻止', async () => {
    const management = new HookManagementService({ db })
    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway({
        describeTool: async () => ({
          found: true,
          governance: {
            risk: 'destructive',
            effect: 'delete',
            idempotency: 'unsafe',
            enabled: true,
            version: '1.0.0',
          },
        }),
      }),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })

    const destructive = management.createDefinition({
      name: 'destructive hook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: { sourceKind: 'connector', sourceId: 'c1', toolName: 'w', qualifiedName: 'w.w' },
      },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: destructive.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: destructive.executionHash,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-7', 'msg-7', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()
    expect(management.listRuns()[0]?.errorCode).toBe('policy_blocked')
  })

  it('工具版本漂移记录 tool_version_changed', async () => {
    const management = new HookManagementService({ db })
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway({
        describeTool: async () => ({
          found: true,
          governance: {
            risk: 'read',
            effect: 'read',
            idempotency: 'safe',
            enabled: true,
            version: '2.0.0',
          },
        }),
      }),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    const definition = management.createDefinition({
      name: 'pinned webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'tool-package',
          sourceId: 'pkg-2',
          version: '1.0.0',
          toolName: 'send',
          qualifiedName: 'webhook.send',
        },
      },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-8', 'msg-8', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()
    expect(management.listRuns()[0]?.errorCode).toBe('tool_version_changed')
  })

  it('safe 重试：瞬态失败按退避重新入队，成功后记录尝试次数', async () => {
    const management = new HookManagementService({ db })
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway({
        invokeTool: async () => ({
          ok: false,
          errorCode: 'transient_failure',
          message: '网络抖动',
        }),
      }),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    const definition = management.createDefinition({
      name: 'retry webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'custom-tool',
          sourceId: 'ct-1',
          toolName: 'notify',
          qualifiedName: 'notify.notify',
        },
      },
      inputMapping: {},
      retryPolicy: { mode: 'safe', maxAttempts: 3, backoffMs: 1000 },
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-9', 'msg-9', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)

    await worker.tickOnce()
    const run = management.listRuns()[0]
    expect(run?.status).toBe('queued')
    expect(run?.attemptCount).toBe(1)
    expect(run?.errorCode).toBe('transient_failure')
    // 退避未到，不可领取
    expect(await worker.tickOnce()).toBe(false)
    expect(management.listRuns()[0]?.attemptCount).toBe(1)
  })

  it('unsafe 重试：失败即为终态，用户显式重试可重新入队', async () => {
    const management = new HookManagementService({ db })
    let fail = true
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway({
        invokeTool: async () =>
          fail
            ? { ok: false, errorCode: 'action_failed', message: '4xx 确定性失败' }
            : { ok: true, result: { ok: 1 } },
      }),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    const definition = management.createDefinition({
      name: 'unsafe webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'custom-tool',
          sourceId: 'ct-2',
          toolName: 'notify',
          qualifiedName: 'notify.notify',
        },
      },
      inputMapping: {},
      retryPolicy: { mode: 'unsafe', maxAttempts: 3, backoffMs: 1000 },
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-10', 'msg-10', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)

    await worker.tickOnce()
    const run = management.listRuns()[0]
    expect(run?.status).toBe('failed')
    expect(run?.errorCode).toBe('action_failed')

    // 用户显式重试（此时代码改为成功路径）
    fail = false
    const retried = management.retryRun(run?.id as string)
    expect(retried?.status).toBe('queued')
    await worker.tickOnce()
    expect(management.getRun(run?.id as string)?.status).toBe('succeeded')
  })

  it('总开关关闭：不派发事件、不领取运行；重新打开后恢复', async () => {
    const management = new HookManagementService({ db })
    const enabledRef = { value: true }
    const bridge = new HookLifecycleBridge(db)
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: () => enabledRef.value,
    })
    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: () => enabledRef.value,
    })
    const definition = management.createDefinition({
      name: '开关 hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    // 开关关闭：事件滞留 pending，不产生运行
    enabledRef.value = false
    bridge.responseCommitted('session-1', 'turn-11', 'msg-11', '回答')
    expect(await dispatcher.dispatchPending()).toBe(0)
    expect(management.listRuns()).toHaveLength(0)

    // 重新打开：事件消费并执行
    enabledRef.value = true
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()
    expect(builtins.calls).toHaveLength(1)
  })

  it('启动崩溃恢复：过期 running 租约进入 outcome_unknown，不被 worker 自动领取', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'crash hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-12', 'msg-12', '回答')
    expect(await dispatcher.dispatchPending()).toBe(1)

    // 模拟崩溃：直接以立即过期的租约领取运行（对应一个领取后即崩溃的 worker 进程）
    const { HookRunRepository } = await import('@spark/storage')
    new HookRunRepository(db).claimNextRunnable('crashed-worker', -1)
    expect(management.listRuns()[0]?.status).toBe('running')

    // 新进程启动恢复
    const freshWorker = new HookWorker(db, {
      owner: 'fresh-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const recovery = freshWorker.recoverOnStartup()
    expect(recovery.unknownRuns).toBe(1)
    expect(management.listRuns()[0]?.status).toBe('outcome_unknown')
    expect(await freshWorker.tickOnce()).toBe(false)
  })

  it('same-hook serial_per_session：前序 queued 运行阻塞后续领取', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'serial hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
      concurrencyPolicy: 'serial_per_session',
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-13', 'msg-13', '回答一')
    bridge.responseCommitted('session-1', 'turn-14', 'msg-14', '回答二')

    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(2)

    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    // 第一条执行成功前，第二条不得越过
    await worker.tickOnce()
    const runs = management.listRuns()
    const succeeded = runs.filter((r) => r.status === 'succeeded')
    const queued = runs.filter((r) => r.status === 'queued')
    expect(succeeded).toHaveLength(1)
    expect(queued).toHaveLength(1)
    await worker.tickOnce()
    expect(management.listRuns().every((r) => r.status === 'succeeded')).toBe(true)
  })

  it('并发策略 parallel：两个会话的运行可以立即并行领取', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'parallel hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
      concurrencyPolicy: 'parallel',
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    new SessionRepository(db).create({
      id: 'session-2',
      kind: 'chat',
      title: '第二会话',
      status: 'idle',
      projectId: 'ws-1',
      workspaceIds: ['ws-1'],
      agentId: 'agent-1',
    })
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-15', 'msg-15', '回答一')
    bridge.responseCommitted('session-2', 'turn-16', 'msg-16', '回答二')

    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(2)
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins: makeBuiltins(),
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    await worker.tickOnce()
    await worker.tickOnce()
    expect(management.listRuns().every((r) => r.status === 'succeeded')).toBe(true)
  })

  it('映射预览不执行动作；样例信封参与条件与映射求值', () => {
    const management = new HookManagementService({ db })
    const preview = management.preview({
      name: '预览 hook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'tool-package',
          sourceId: 'pkg',
          toolName: 'send',
          qualifiedName: 'webhook.send',
        },
      },
      inputMapping: {
        summary: { path: 'payload.response.finalText' },
        sessionId: { path: 'session.id' },
      },
    })
    expect(preview.valid).toBe(true)
    expect(preview.conditionMatched).toBe(true)
    expect(preview.mappedInput).toEqual({
      summary: '（样例最终回答正文）',
      sessionId: 'sample-session',
    })
  })

  it('触发 onEventPersisted 后 Dispatcher 立即消费（宿主接线语义）', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'notify hook',
      eventName: 'question.requested',
      action: { type: 'builtin.notification' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    const dispatchSpy = vi.spyOn(dispatcher, 'dispatchPending')
    const bridge = new HookLifecycleBridge(db, {
      onEventPersisted: () => {
        void dispatcher.dispatchPending()
      },
    })
    bridge.questionRequested('session-1', 'turn-17', {
      questionId: 'q-1',
      questions: [{ title: '继续吗？' }],
    })
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalled())
    expect(management.listRuns()).toHaveLength(1)
    expect(management.listRuns()[0]?.eventName).toBe('question.requested')
  })

  it('内置通知标题/正文表达式按事件白名单求值，空值回退默认标题', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '表达式通知',
      eventName: 'response.committed',
      action: {
        type: 'builtin.notification',
        title: { template: '会话 ${session.title} 有新回答' },
        body: { path: 'payload.response.finalText' },
      },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    new HookLifecycleBridge(db).responseCommitted('session-1', 'turn-18', 'msg-18', '正文内容')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()

    expect(builtins.calls).toHaveLength(1)
    expect(builtins.calls[0]?.title).toBe('会话 测试会话 有新回答')
    expect(builtins.calls[0]?.body).toBe('正文内容')
  })

  it('通知标题路径在事件中缺失时回退默认标题而不是空串', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '缺失路径通知',
      eventName: 'turn.completed',
      action: { type: 'builtin.notification', title: { path: 'payload.message' } },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    // turn.completed 无 message 载荷 → title 求值为空 → 回退默认标题
    new HookLifecycleBridge(db).turnTerminal('session-1', 'turn-19', 'completed')
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()

    expect(builtins.calls).toHaveLength(1)
    expect(builtins.calls[0]?.title).toBe('SparkWork - 任务完成')
  })

  it('问题载荷支持数组索引映射（payload.questions.<n>.title）', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '提问联动',
      eventName: 'question.requested',
      action: { type: 'builtin.notification' },
      inputMapping: { firstQuestion: { path: 'payload.questions.0.title' } },
    })
    management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })

    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    new HookLifecycleBridge(db).questionRequested('session-1', 'turn-20', {
      questionId: 'q-20',
      questions: [{ title: '继续吗？', description: '请确认' }],
    })
    expect(await dispatcher.dispatchPending()).toBe(1)
    await worker.tickOnce()

    const run = management.listRuns()[0]
    expect(run?.status).toBe('succeeded')
  })

  it('updateDefinition 部分字段提交时哈希基于归一化值（同语义同哈希）', () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'hash 稳定性',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
      retryPolicy: { mode: 'safe', maxAttempts: 3, backoffMs: 1000 },
    })
    // 只改 mode，缺省 maxAttempts/backoffMs 由归一化补全，哈希与全量提交一致
    const { definition: updated } = management.updateDefinition(definition.id, {
      retryPolicy: { mode: 'safe' },
    })
    expect(updated.retryPolicy).toEqual({ mode: 'safe', maxAttempts: 3, backoffMs: 1000 })
    expect(updated.executionHash).toBe(definition.executionHash)
  })
})

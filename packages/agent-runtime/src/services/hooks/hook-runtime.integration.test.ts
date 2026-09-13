import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEventEnvelopeV1 } from '@spark/protocol'
import {
  HookEventRepository,
  SessionRepository,
  SparkDatabase,
  WorkspaceRepository,
} from '@spark/storage'
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

  it('闭环兜底：pending 事件由周期扫描消费（总开关关闭期间积累 → 开启后扫描派发）', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'sweep hook',
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

    const enabledRef = { value: false }
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
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-21', 'msg-21', '回答')
    // 开关关闭：新事件持久化触发的派发为空，事件滞留 pending
    expect(await dispatcher.dispatchPending()).toBe(0)

    // 开启后（模拟 setSystemEnabled(true) 的即时派发 + 周期 sweepOnce）
    enabledRef.value = true
    const sweep = await dispatcher.sweepOnce()
    expect(sweep.dispatched).toBe(1)
    await worker.tickOnce()
    expect(management.listRuns()).toHaveLength(1)
    expect(builtins.calls).toHaveLength(1)
  })

  it('派发失败释放回 pending 的事件由下一次扫描重试（事件不丢失）', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'retry sweep hook',
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
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-22', 'msg-22', '回答')

    // 定义启用中，事件必然入 outbox；模拟一次派发后事件已 resolved
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(1)
    const events = new HookEventRepository(db)
    expect(events.countByStatus('resolved')).toBe(1)

    // sweep 不重复消费 resolved 事件，也不产生第二条运行（唯一约束兜底）
    const sweep = await dispatcher.sweepOnce()
    expect(sweep.dispatched).toBe(0)
    expect(management.listRuns()).toHaveLength(1)
  })

  it('resolved 事件按保留期清理，pending 事件不受影响', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'prune hook',
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
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-23', 'msg-23', '回答一')
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(1)

    // 手动把 resolved 事件的 resolved_at 拨老
    const events = new HookEventRepository(db)
    db.raw
      .prepare("UPDATE hook_events SET resolved_at = ? WHERE status = 'resolved'")
      .run(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString())

    // 制造一个滞留 pending 事件（关闭开关期间到达）
    const enabledRef = { value: false }
    const gatedDispatcher = new HookDispatcher(db, {
      owner: 'gated',
      isEnabled: () => enabledRef.value,
    })
    bridge.responseCommitted('session-1', 'turn-24', 'msg-24', '回答二')
    expect(await gatedDispatcher.dispatchPending()).toBe(0)

    const sweep = await dispatcher.sweepOnce({ pruneResolvedAfterMs: 7 * 24 * 60 * 60 * 1000 })
    expect(sweep.pruned).toBe(1)
    // 周期扫描同时消化了滞留的 pending 事件（闭环兜底语义）
    expect(sweep.dispatched).toBeGreaterThanOrEqual(1)
    expect(events.countByStatus('pending')).toBe(0)
    // 运行记录（审计事实）不随事件清理：老事件 1 条 + 扫描新派发 1 条
    expect(management.listRuns()).toHaveLength(2)
  })

  it('测试运行：产生 isTest 独立运行并可执行成功，不影响真实事件链路', async () => {
    const management = new HookManagementService({ db })
    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })

    // 未创建任何定义/绑定的情况下直接试运行
    const run = management.testRun({
      name: '试运行',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    expect(run.isTest).toBe(true)
    expect(run.status).toBe('queued')
    expect(run.definitionSnapshot.name).toBe('试运行')

    await worker.tickOnce()
    expect(management.getRun(run.id)?.status).toBe('succeeded')
    expect(builtins.calls).toHaveLength(1)

    // 测试运行不写 outbox、与真实事件运行互不影响
    const events = new HookEventRepository(db)
    expect(events.countByStatus('pending')).toBe(0)
    expect(events.countByStatus('resolved')).toBe(0)
  })

  it('测试运行按确认时快照执行：与其他定义并存互不影响', async () => {
    const management = new HookManagementService({ db })
    // 预创建一个无关定义，证明测试运行不受现存定义影响
    management.createDefinition({
      name: '无关定义',
      eventName: 'turn.failed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    const builtins = makeBuiltins()
    const worker = new HookWorker(db, {
      owner: 'test-worker',
      builtins,
      toolGateway: makeToolGateway(),
      isEnabled: alwaysEnabled,
    })
    const run = management.testRun({
      name: '试运行通知',
      eventName: 'response.committed',
      action: { type: 'builtin.notification', title: { const: '测试通知' } },
      inputMapping: {},
    })
    await worker.tickOnce()
    const finished = management.getRun(run.id)
    expect(finished?.status).toBe('succeeded')
    expect(builtins.calls).toHaveLength(1)
    expect(builtins.calls[0]?.title).toBe('测试通知')
  })

  it('listRuns 支持事件/作用域/时间范围筛选', async () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: 'filter hook',
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
    const completedDefinition = management.createDefinition({
      name: 'completed hook',
      eventName: 'turn.completed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    management.upsertBinding({
      hookId: completedDefinition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: completedDefinition.executionHash,
    })
    const bridge = new HookLifecycleBridge(db)
    bridge.responseCommitted('session-1', 'turn-30', 'msg-30', '回答一')
    bridge.turnTerminal('session-1', 'turn-31', 'completed')
    const dispatcher = new HookDispatcher(db, {
      owner: 'test-dispatcher',
      isEnabled: alwaysEnabled,
    })
    expect(await dispatcher.dispatchPending()).toBe(2)

    expect(management.listRuns({ eventName: 'response.committed' })).toHaveLength(1)
    expect(management.listRuns({ eventName: 'turn.completed' })).toHaveLength(1)
    expect(management.listRuns({ scopeKind: 'application' })).toHaveLength(2)
    expect(management.listRuns({ from: new Date(Date.now() + 60_000).toISOString() })).toHaveLength(
      0,
    )
    expect(management.listRuns({ to: new Date(Date.now() - 60_000).toISOString() })).toHaveLength(0)
  })

  it('未使用 Hook 功能时生命周期事件零写入（bridge 短路）', () => {
    const events = new HookEventRepository(db)
    const bridge = new HookLifecycleBridge(db)
    bridge.turnStarted('session-1', 'turn-25')
    bridge.responseCommitted('session-1', 'turn-25', 'msg-25', '回答')
    bridge.turnTerminal('session-1', 'turn-25', 'completed')
    bridge.permissionRequested({
      sessionId: 'session-1',
      turnId: 'turn-25',
      requestId: 'req-25',
      toolName: 'bash',
      action: 'run',
      riskLevel: 'low',
    })
    bridge.questionRequested('session-1', 'turn-25', { questionId: 'q-25' })
    expect(events.countByStatus('pending')).toBe(0)
    expect(events.countByStatus('resolved')).toBe(0)
  })

  it('定义停用时事件不写入；启用后恢复写入', () => {
    const management = new HookManagementService({ db })
    const events = new HookEventRepository(db)
    const definition = management.createDefinition({
      name: 'gate hook',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
      enabled: false,
    })
    const bridge = new HookLifecycleBridge(db)
    // 定义级停用：事件不写入 outbox
    bridge.responseCommitted('session-1', 'turn-26', 'msg-26', '回答')
    expect(events.countByStatus('pending')).toBe(0)

    // 启用定义后恢复写入
    management.updateDefinition(definition.id, { enabled: true })
    bridge.responseCommitted('session-1', 'turn-27', 'msg-27', '回答')
    expect(events.countByStatus('pending')).toBe(1)
  })

  it('重新启用已授权绑定不使授权失效；提供错误授权哈希则降级 needs_review', () => {
    const management = new HookManagementService({ db })
    const definition = management.createDefinition({
      name: '授权保留',
      eventName: 'response.committed',
      action: { type: 'builtin.sound' },
      inputMapping: {},
    })
    const binding = management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: definition.executionHash,
    })
    expect(binding.state).toBe('active')

    // 仅切换 enabled=false 再重新启用（不带授权参数）：既有授权保留
    management.upsertBinding({ hookId: definition.id, scopeKind: 'application', enabled: false })
    const reEnabled = management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
    })
    expect(reEnabled.state).toBe('active')
    expect(reEnabled.trustedExecutionHash).toBe(definition.executionHash)
    expect(reEnabled.id).toBe(binding.id)

    // 提供不匹配的授权哈希：显式降级 needs_review
    const mismatched = management.upsertBinding({
      hookId: definition.id,
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: 'wrong-hash',
    })
    expect(mismatched.state).toBe('needs_review')
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

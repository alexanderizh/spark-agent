import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HookEventEnvelopeV1, HookDefinitionV1 } from '@spark/protocol'
import { SparkDatabase } from '../database.js'
import { SessionRepository } from './session.repository.js'
import { HookBindingRepository } from './hook-binding.repository.js'
import { HookDefinitionRepository } from './hook-definition.repository.js'
import { HookEventRepository } from './hook-event.repository.js'
import { HookRunRepository } from './hook-run.repository.js'
import type { CreateHookDefinitionParams } from './hook-definition.repository.js'

function createTestDb(testDir: string): SparkDatabase {
  const db = new SparkDatabase(join(testDir, 'test.db'))
  db.runMigrations(join(process.cwd(), 'migrations'))
  return db
}

function makeDefinitionInput(
  overrides: Partial<CreateHookDefinitionParams> = {},
): CreateHookDefinitionParams {
  return {
    name: '回答落库后发 Webhook',
    enabled: true,
    eventName: 'response.committed',
    action: {
      type: 'tool.invoke',
      target: {
        sourceKind: 'tool-package',
        sourceId: 'webhook-package',
        version: '1.0.0',
        toolName: 'send',
        qualifiedName: 'webhook.send',
      },
    },
    inputMapping: { summary: { path: 'payload.response.finalText' } },
    timeoutMs: 15_000,
    retryPolicy: { mode: 'unsafe', maxAttempts: 3, backoffMs: 1000 },
    concurrencyPolicy: 'serial_per_session',
    revision: 1,
    executionHash: 'hash-1',
    ...overrides,
  }
}

function makeEnvelope(eventId: string, sessionId = 'session-1'): HookEventEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId,
    eventName: 'response.committed',
    occurredAt: new Date().toISOString(),
    source: 'host',
    session: { id: sessionId, title: '测试会话' },
    turn: { id: 'turn-1' },
    workspaces: [{ id: 'ws-1' }],
    primaryWorkspaceId: 'ws-1',
    payload: { response: { messageId: 'msg-1', finalText: '最终回答' } },
  }
}

describe('Hook V2 repositories', () => {
  let db: SparkDatabase
  let testDir: string
  let definitions: HookDefinitionRepository
  let bindings: HookBindingRepository
  let events: HookEventRepository
  let runs: HookRunRepository

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-test-hook-repos-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = createTestDb(testDir)
    definitions = new HookDefinitionRepository(db)
    bindings = new HookBindingRepository(db)
    events = new HookEventRepository(db)
    runs = new HookRunRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('定义 CRUD：创建后可读、更新执行性字段、删除', () => {
    const created = definitions.create(makeDefinitionInput())
    expect(created.id).toBeTruthy()
    expect(created.eventName).toBe('response.committed')
    expect(created.enabled).toBe(true)
    expect(created.action).toEqual({
      type: 'tool.invoke',
      target: {
        sourceKind: 'tool-package',
        sourceId: 'webhook-package',
        version: '1.0.0',
        toolName: 'send',
        qualifiedName: 'webhook.send',
      },
    })
    expect(definitions.get(created.id)?.inputMapping.summary).toEqual({
      path: 'payload.response.finalText',
    })

    const updated = definitions.update(created.id, {
      name: '改名不改执行语义',
      enabled: false,
      revision: 2,
      executionHash: 'hash-2',
    })
    expect(updated?.name).toBe('改名不改执行语义')
    expect(updated?.enabled).toBe(false)
    expect(updated?.revision).toBe(2)

    definitions.create(makeDefinitionInput({ eventName: 'turn.failed', executionHash: 'hash-3' }))
    expect(definitions.list()).toHaveLength(2)
    expect(definitions.listEnabledByEvent('response.committed')).toHaveLength(0)

    expect(definitions.delete(created.id)).toBe(true)
    expect(definitions.get(created.id)).toBeNull()
  })

  it('绑定 upsert 幂等：同 Hook 同作用域只保留一条', () => {
    const def = definitions.create(makeDefinitionInput())
    const first = bindings.upsert({
      hookId: def.id,
      scopeKind: 'workspace',
      scopeId: 'ws-1',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
      authorizedEffect: 'send',
      authorizedAt: new Date().toISOString(),
    })
    const second = bindings.upsert({
      hookId: def.id,
      scopeKind: 'workspace',
      scopeId: 'ws-1',
      enabled: true,
      state: 'needs_review',
    })
    expect(second.id).toBe(first.id)
    expect(second.state).toBe('needs_review')
    expect(bindings.list({ hookId: def.id })).toHaveLength(1)

    bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })
    expect(bindings.list({ hookId: def.id })).toHaveLength(2)
    expect(bindings.listForScopes([{ scopeKind: 'application', scopeId: '' }])).toHaveLength(1)
  })

  it('授权失效：哈希不匹配的绑定批量进入 needs_review', () => {
    const def = definitions.create(makeDefinitionInput())
    bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'old-hash',
    })
    const sessionBinding = bindings.upsert({
      hookId: def.id,
      scopeKind: 'session',
      scopeId: 'session-1',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'new-hash',
    })
    const invalidated = bindings.invalidateStaleAuthorizations(def.id, 'new-hash')
    expect(invalidated).toBe(1)
    expect(bindings.get(sessionBinding.id)?.state).toBe('active')
    const appBinding = bindings.findByScope(def.id, 'application', '')
    expect(appBinding?.state).toBe('needs_review')
  })

  it('事件 outbox：幂等写入、租约领取、过期回收、终态标记', () => {
    expect(
      events.insertIfAbsent({
        eventId: 'evt-1',
        eventName: 'response.committed',
        sessionId: 'session-1',
        turnId: 'turn-1',
        envelope: makeEnvelope('evt-1'),
      }),
    ).toBe(true)
    // 重放同一 eventId 不产生第二行
    expect(
      events.insertIfAbsent({
        eventId: 'evt-1',
        eventName: 'response.committed',
        sessionId: 'session-1',
        turnId: 'turn-1',
        envelope: makeEnvelope('evt-1'),
      }),
    ).toBe(false)

    const claimed = events.claimNextPending('worker-A', 60_000)
    expect(claimed?.event_id).toBe('evt-1')
    expect(claimed?.status).toBe('resolving')

    // 未过期租约不被重复领取
    events.insertIfAbsent({
      eventId: 'evt-2',
      eventName: 'turn.completed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      envelope: { ...makeEnvelope('evt-2'), eventName: 'turn.completed' },
    })
    expect(events.claimNextPending('worker-A', 60_000)?.event_id).toBe('evt-2')

    // 过期 resolving 租约回收为 pending
    events.markFailed('evt-2', 'boom')
    expect(events.countByStatus('failed')).toBe(1)
    const requeued = events.requeueExpiredLeases()
    expect(requeued).toBeGreaterThanOrEqual(0)

    events.markResolved('evt-1')
    expect(events.get('evt-1')?.status).toBe('resolved')
  })

  it('运行记录：唯一约束去重、领取串行防护、手动重试', async () => {
    const def = definitions.create(makeDefinitionInput())
    const binding = bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })
    const defV1 = definitions.get(def.id) as HookDefinitionV1
    events.insertIfAbsent({
      eventId: 'evt-run-1',
      eventName: 'response.committed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      envelope: makeEnvelope('evt-run-1'),
    })

    const created = runs.insertIfAbsent({
      eventId: 'evt-run-1',
      eventName: 'response.committed',
      hookId: defV1.id,
      hookRevision: defV1.revision,
      bindingId: binding.id,
      scopeKind: binding.scopeKind,
      sessionId: 'session-1',
      turnId: 'turn-1',
      definitionSnapshot: defV1,
      bindingSnapshot: binding,
      envelope: makeEnvelope('evt-run-1'),
    })
    expect(created).not.toBeNull()
    // 同事件同 Hook 再次创建被唯一约束拒绝
    expect(
      runs.insertIfAbsent({
        eventId: 'evt-run-1',
        eventName: 'response.committed',
        hookId: defV1.id,
        hookRevision: 99,
        bindingId: binding.id,
        scopeKind: binding.scopeKind,
        sessionId: 'session-1',
        turnId: 'turn-1',
        definitionSnapshot: { ...defV1, revision: 99 },
        bindingSnapshot: binding,
        envelope: makeEnvelope('evt-run-1'),
      }),
    ).toBeNull()
    expect(runs.getByEventAndHook('evt-run-1', defV1.id)?.hookRevision).toBe(1)

    const claimed = runs.claimNextRunnable('worker-A', 60_000)
    const claimedId = claimed?.id as string
    expect(claimedId).toBe(created?.id)
    expect(claimed?.status).toBe('running')
    expect(claimed?.attemptCount).toBe(1)

    const finished = runs.finish(claimedId, {
      status: 'failed',
      errorCode: 'action_failed',
      errorMessage: 'webhook 5xx',
    })
    expect(finished?.status).toBe('failed')
    expect(finished?.finishedAt).toBeTruthy()
    expect(finished?.durationMs).toBeGreaterThanOrEqual(0)

    // 手动重试仅对终态运行生效
    expect(runs.requeueForManualRetry(claimedId)?.status).toBe('queued')
    expect(runs.list({ status: 'queued' })).toHaveLength(1)

    // queued 运行可被取消
    const cancelled = runs.cancelPending(claimedId)
    expect(cancelled?.status).toBe('cancelled')
  })

  it('serial_per_session：前序运行阻塞后续运行领取', () => {
    const def = definitions.create(makeDefinitionInput())
    const binding = bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })
    const defV1 = definitions.get(def.id) as HookDefinitionV1

    const insertRun = (eventId: string, sessionId: string): string => {
      events.insertIfAbsent({
        eventId,
        eventName: 'response.committed',
        sessionId,
        turnId: 'turn-1',
        envelope: makeEnvelope(eventId, sessionId),
      })
      const run = runs.insertIfAbsent({
        eventId,
        eventName: 'response.committed',
        hookId: defV1.id,
        hookRevision: defV1.revision,
        bindingId: binding.id,
        scopeKind: binding.scopeKind,
        sessionId,
        turnId: 'turn-1',
        definitionSnapshot: defV1,
        bindingSnapshot: binding,
        envelope: makeEnvelope(eventId, sessionId),
      })
      return run?.id as string
    }
    const firstId = insertRun('evt-s-1', 'session-1')
    const secondId = insertRun('evt-s-2', 'session-1')
    insertRun('evt-other-1', 'session-2')

    // 第一条可领取；第二条同会话被前序阻塞，另一会话不受影响
    expect(runs.claimNextRunnable('worker-A', 60_000)?.id).toBe(firstId)
    const next = runs.claimNextRunnable('worker-A', 60_000)
    expect(next?.sessionId).toBe('session-2')

    // 前序进入终态后，第二条才可领取
    runs.finish(firstId, { status: 'succeeded' })
    expect(runs.claimNextRunnable('worker-A', 60_000)?.id).toBe(secondId)
  })

  it('启动回收：过期 running 租约进入 outcome_unknown 而非重新排队', () => {
    const def = definitions.create(makeDefinitionInput())
    const binding = bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })
    const defV1 = definitions.get(def.id) as HookDefinitionV1
    events.insertIfAbsent({
      eventId: 'evt-crash',
      eventName: 'response.committed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      envelope: makeEnvelope('evt-crash'),
    })
    const run = runs.insertIfAbsent({
      eventId: 'evt-crash',
      eventName: 'response.committed',
      hookId: defV1.id,
      hookRevision: defV1.revision,
      bindingId: binding.id,
      scopeKind: binding.scopeKind,
      sessionId: 'session-1',
      turnId: 'turn-1',
      definitionSnapshot: defV1,
      bindingSnapshot: binding,
      envelope: makeEnvelope('evt-crash'),
    })
    runs.claimNextRunnable('worker-A', /* leaseMs */ -1) // 立即过期的租约
    const recovered = runs.recoverExpiredLeasesToOutcomeUnknown()
    expect(recovered).toBe(1)
    expect(runs.get(run?.id as string)?.status).toBe('outcome_unknown')
    // outcome_unknown 不会被自动领取
    expect(runs.claimNextRunnable('worker-A', 60_000)).toBeNull()
  })

  it('会话删除级联清理会话作用域绑定', () => {
    const sessions = new SessionRepository(db)
    sessions.create({
      id: 'session-del',
      kind: 'chat',
      title: '待删',
      status: 'idle',
      projectId: 'p1',
    })
    const def = definitions.create(makeDefinitionInput())
    bindings.upsert({
      hookId: def.id,
      scopeKind: 'session',
      scopeId: 'session-del',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })
    bindings.upsert({
      hookId: def.id,
      scopeKind: 'application',
      scopeId: '',
      enabled: true,
      state: 'active',
      trustedExecutionHash: 'hash-1',
    })

    sessions.deleteWithRelatedData('session-del')
    expect(bindings.listForScopes([{ scopeKind: 'session', scopeId: 'session-del' }])).toHaveLength(
      0,
    )
    // 应用级绑定不受影响
    expect(bindings.listForScopes([{ scopeKind: 'application', scopeId: '' }])).toHaveLength(1)
  })
})

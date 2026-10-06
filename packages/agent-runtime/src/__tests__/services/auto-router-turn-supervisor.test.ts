import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { autoRouterHealthRegistry } from '../../services/auto-router-health'
import { AutoRouterTurnSupervisor } from '../../services/auto-router-turn-supervisor'

/**
 * AutoRouter 轮次监督器单测：终态失败归类 → 冻结 → 一次性故障切换武装。
 * 冻结副作用落在进程内健康注册表单例（与生产同路径），每个用例前后清空隔离。
 */

function makeSupervisor() {
  return new AutoRouterTurnSupervisor()
}

function registerStandardTurn(
  supervisor: AutoRouterTurnSupervisor,
  overrides?: { turnId?: string; isRedispatch?: boolean },
): void {
  supervisor.registerTurn({
    turnId: overrides?.turnId ?? 't1',
    sessionId: 's1',
    routerId: 'r1',
    routerName: '测试路由',
    providerId: 'p-exec',
    modelId: 'm-exec',
    isRedispatch: overrides?.isRedispatch ?? false,
    seed: { sessionId: 's1', message: '帮我把这个模块重构一下' },
  })
}

describe('AutoRouterTurnSupervisor 故障切换判定', () => {
  beforeEach(() => {
    autoRouterHealthRegistry.clear()
  })
  afterEach(() => {
    autoRouterHealthRegistry.clear()
  })

  it('可切换上游失败 + 无副作用 → 冻结并武装重派发', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    const outcome = supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'HTTP 429: too many requests',
      hasProducedSideEffects: false,
    })
    expect(outcome?.frozen).toBe(true)
    expect(outcome?.kind).toBe('retryable')
    expect(outcome?.failoverArmed).toBe(true)
    const seed = supervisor.consumeFailover('s1', 't1')
    expect(seed?.message).toBe('帮我把这个模块重构一下')
    expect(seed?.sessionId).toBe('s1')
    // 消费后不再有 armed
    expect(supervisor.consumeFailover('s1', 't1')).toBeNull()
  })

  it('已产出用户可见内容 → 冻结但不武装（避免重复计费/副作用）', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    const outcome = supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'HTTP 503: service unavailable',
      hasProducedSideEffects: true,
    })
    expect(outcome?.frozen).toBe(true)
    expect(outcome?.failoverArmed).toBe(false)
    expect(autoRouterHealthRegistry.isFrozen('p-exec', 'm-exec')).toBe(true)
  })

  it('环境类失败 → 不冻结不武装', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    const outcome = supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'WORKSPACE_UNAVAILABLE: path missing',
      hasProducedSideEffects: false,
    })
    expect(outcome?.frozen).toBe(false)
    expect(outcome?.failoverArmed).toBe(false)
    expect(autoRouterHealthRegistry.isFrozen('p-exec', 'm-exec')).toBe(false)
  })

  it('纯超时失败 → 冻结但不自动重跑', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    const outcome = supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'request timeout after 120s',
      hasProducedSideEffects: false,
    })
    expect(outcome?.frozen).toBe(true)
    expect(outcome?.failoverArmed).toBe(false)
  })

  it('重派发轮自身不再武装（每条用户消息至多一次）', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor, { turnId: 't2', isRedispatch: true })
    const outcome = supervisor.onTerminalError({
      turnId: 't2',
      errorText: 'HTTP 429: too many requests',
      hasProducedSideEffects: false,
    })
    expect(outcome?.frozen).toBe(true)
    expect(outcome?.failoverArmed).toBe(false)
  })

  it('未登记轮次（非 auto-router 会话）→ null no-op', () => {
    const supervisor = makeSupervisor()
    expect(
      supervisor.onTerminalError({
        turnId: 't-unknown',
        errorText: 'HTTP 429',
        hasProducedSideEffects: false,
      }),
    ).toBeNull()
    expect(supervisor.onTurnSuccess('t-unknown')).toBeUndefined()
  })

  it('成功终态清零失败计数（半开恢复探针通过）', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    autoRouterHealthRegistry.reportFailure('p-exec', 'm-exec', 'retryable', 'HTTP 429')
    autoRouterHealthRegistry.reportFailure('p-exec', 'm-exec', 'retryable', 'HTTP 429')
    supervisor.onTurnSuccess('t1')
    expect(autoRouterHealthRegistry.isFrozen('p-exec', 'm-exec')).toBe(false)
    const snap = autoRouterHealthRegistry.snapshot()
    expect(snap.length).toBe(0)
  })

  it('consumeFailover 只消费武装轮自身的收尾；其他轮收尾拿不到', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor, { turnId: 't1' })
    registerStandardTurn(supervisor, { turnId: 't9' })
    supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'HTTP 500: internal server error',
      hasProducedSideEffects: false,
    })
    expect(supervisor.consumeFailover('s1', 't9')).toBeNull()
    expect(supervisor.consumeFailover('s1', 't1')?.message).toBe('帮我把这个模块重构一下')
  })

  it('forgetTurn 后终态上报变为 no-op（防泄漏回收语义）', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    supervisor.forgetTurn('t1')
    expect(
      supervisor.onTerminalError({
        turnId: 't1',
        errorText: 'HTTP 429',
        hasProducedSideEffects: false,
      }),
    ).toBeNull()
  })

  it('discardFailover 放弃已武装的重派发', () => {
    const supervisor = makeSupervisor()
    registerStandardTurn(supervisor)
    supervisor.onTerminalError({
      turnId: 't1',
      errorText: 'HTTP 429: too many requests',
      hasProducedSideEffects: false,
    })
    supervisor.discardFailover('s1')
    expect(supervisor.consumeFailover('s1', 't1')).toBeNull()
  })
})

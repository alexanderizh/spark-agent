import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderProfileRow } from '@spark/storage'
import {
  AutoRouterHealthRegistry,
  autoRouterHealthRegistry,
  classifyExecutorFailure,
  classifyExecutorFailureText,
  isFailoverWorthyFailure,
} from '../../services/auto-router-health'
import { AutoRouterService, type AutoRouterRouteInput } from '../../services/auto-router.service'
import type { CompleteResult, ModelService } from '../../services/model.service'
import { createDefaultAutoRouterConfig, type AutoRouterConfig } from '@spark/protocol'

// ─── 失败归类 ─────────────────────────────────────────────────────────────────

describe('classifyExecutorFailureText 失败归类', () => {
  it('鉴权/模型不存在/套餐配额 → deterministic', () => {
    expect(classifyExecutorFailureText('HTTP 401: invalid api key')).toBe('deterministic')
    expect(classifyExecutorFailureText('HTTP 404: model not found')).toBe('deterministic')
    expect(classifyExecutorFailureText('[1311] 当前订阅套餐暂未开放GLM-5.3-FlashX权限')).toBe(
      'deterministic',
    )
    expect(classifyExecutorFailureText('insufficient quota, balance is 0')).toBe('deterministic')
  })

  it('429/5xx/超时/网络断流 → retryable', () => {
    expect(classifyExecutorFailureText('HTTP 429: too many requests')).toBe('retryable')
    expect(classifyExecutorFailureText('HTTP 503: service unavailable')).toBe('retryable')
    expect(classifyExecutorFailureText('stream ended prematurely')).toBe('retryable')
    expect(classifyExecutorFailureText('fetch failed: ECONNREFUSED')).toBe('retryable')
  })

  it('工作区/SDK/渠道配置类 → environment（不冻结不重派发）', () => {
    expect(classifyExecutorFailureText('WORKSPACE_UNAVAILABLE: path missing')).toBe('environment')
    expect(classifyExecutorFailureText('Claude Agent SDK is required')).toBe('environment')
    expect(classifyExecutorFailureText('会话绑定的渠道已不存在')).toBe('environment')
    expect(classifyExecutorFailureText('')).toBe('environment')
  })

  it('environment 优先级最高（即使混入 429 字样）', () => {
    expect(classifyExecutorFailureText('WORKSPACE_UNAVAILABLE after HTTP 429 retry')).toBe(
      'environment',
    )
  })

  it('未识别文本默认 retryable（短冻代价低，漏冻会持续撞墙）', () => {
    expect(classifyExecutorFailureText('某个完全没见过的错误格式')).toBe('retryable')
  })

  it('isFailoverWorthyFailure：environment 永不切换；retryable 子集才切换', () => {
    expect(isFailoverWorthyFailure('environment', 'WORKSPACE_UNAVAILABLE')).toBe(false)
    expect(isFailoverWorthyFailure('deterministic', 'HTTP 401')).toBe(true)
    expect(isFailoverWorthyFailure('retryable', 'HTTP 429: too many requests')).toBe(true)
    // 纯超时/网络类不自动重跑（可能已跑很久、或用户网络问题重跑同样失败）
    expect(isFailoverWorthyFailure('retryable', 'request timeout after 120s')).toBe(false)
    expect(isFailoverWorthyFailure('retryable', 'fetch failed')).toBe(false)
  })
})

// ─── 注册表 ───────────────────────────────────────────────────────────────────

describe('classifyExecutorFailure 错误码优先归类', () => {
  it.each([
    'PERMISSION_TIMEOUT',
    'PERMISSION_CANCELLED',
    'CLAUDE_PERMISSION_DENIED',
    'MAX_ITERATIONS',
    'SDK_RESUME_CIRCUIT_OPEN',
    'CODEX_RUNTIME_NOT_INSTALLED',
  ])('%s → environment（本地闸门/策略/环境，与执行模型上游无关）', (code) => {
    expect(classifyExecutorFailure({ code, text: 'whatever text' })).toBe('environment')
  })

  it('错误码优先于文本：权限超时文本会被误判为可重试，错误码纠正为 environment', () => {
    // 回归对照：纯文本路径确实把它判成 retryable（这正是需要错误码的原因）
    expect(classifyExecutorFailureText('permission request timed out after 300s')).toBe(
      'retryable',
    )
    expect(
      classifyExecutorFailure({ code: 'PERMISSION_TIMEOUT', text: 'permission request timed out' }),
    ).toBe('environment')
  })

  it('未命中错误码走文本归类', () => {
    expect(classifyExecutorFailure({ code: 'CLAUDE_RATE_LIMIT', text: 'rate limited' })).toBe(
      'retryable',
    )
    expect(classifyExecutorFailure({ code: undefined, text: 'HTTP 401 unauthorized' })).toBe(
      'deterministic',
    )
  })
})

describe('AutoRouterHealthRegistry 递进冻结与半开恢复', () => {
  it('retryable 递进冻结 1min → 5min → 10min 封顶', () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = 1_000_000
    expect(registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0)).toBe(60_000)
    expect(registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0 + 10_000)).toBe(300_000)
    expect(registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0 + 20_000)).toBe(600_000)
    expect(registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0 + 30_000)).toBe(600_000)
  })

  it('deterministic 固定 30min 长冻', () => {
    const registry = new AutoRouterHealthRegistry()
    expect(registry.reportFailure('p1', 'm1', 'deterministic', 'HTTP 401', 0)).toBe(30 * 60_000)
  })

  it('environment 不冻结（防御性）', () => {
    const registry = new AutoRouterHealthRegistry()
    expect(registry.reportFailure('p1', 'm1', 'environment', 'WORKSPACE_UNAVAILABLE', 0)).toBe(0)
    expect(registry.isFrozen('p1', 'm1')).toBe(false)
  })

  it('冻结期内 isFrozen；到期自动解冻（半开探针入口）', () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = 1_000_000
    registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0)
    expect(registry.isFrozen('p1', 'm1', t0 + 30_000)).toBe(true)
    expect(registry.isFrozen('p1', 'm1', t0 + 60_001)).toBe(false)
  })

  it('reportSuccess 清零计数：成功后再次失败回到首档短冻', () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = 1_000_000
    registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0)
    registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0 + 1)
    registry.reportSuccess('p1', 'm1')
    expect(registry.reportFailure('p1', 'm1', 'retryable', 'HTTP 429', t0 + 2)).toBe(60_000)
  })

  it('firstHealthy 按声明顺序取健康条目；soonestUnfreeze 取最快解冻者', () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = 1_000_000
    registry.reportFailure('p1', 'm1', 'retryable', 'x', t0) // 冻 1min
    registry.reportFailure('p2', 'm2', 'retryable', 'x', t0) // 冻 1min
    registry.reportFailure('p2', 'm2', 'retryable', 'x', t0 + 1) // 升 5min
    const candidates = [
      { providerProfileId: 'p1', modelId: 'm1' },
      { providerProfileId: 'p2', modelId: 'm2' },
      { providerProfileId: 'p3', modelId: 'm3' },
    ]
    expect(registry.firstHealthy(candidates, t0 + 10)?.providerProfileId).toBe('p3')
    expect(registry.firstHealthy(candidates, t0 + 61_000)?.providerProfileId).toBe('p1')
    // 全部冻结 → 最快解冻者（p1 剩余更短）
    const allFrozen = [
      { providerProfileId: 'p1', modelId: 'm1' },
      { providerProfileId: 'p2', modelId: 'm2' },
    ]
    expect(registry.soonestUnfreeze(allFrozen, t0 + 10)?.providerProfileId).toBe('p1')
    expect(registry.soonestUnfreeze([], t0)).toBeNull()
  })

  it('snapshot 投影 frozen 状态与剩余毫秒', () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = 1_000_000
    registry.reportFailure('p1', 'm1', 'deterministic', 'HTTP 401: bad key', t0)
    const snap = registry.snapshot(t0 + 1_000)
    expect(snap.length).toBe(1)
    expect(snap[0]?.state).toBe('frozen')
    expect(snap[0]?.lastFailureKind).toBe('deterministic')
    expect(snap[0]?.consecutiveFailures).toBe(1)
    expect(snap[0]?.frozenRemainingMs).toBe(30 * 60_000 - 1_000)
  })
})

// ─── 选执行器健康避让（service 集成） ────────────────────────────────────────

type CompleteMock = ReturnType<typeof vi.fn<ModelService['complete']>>

function okComplete(text: string): CompleteMock {
  return vi.fn<ModelService['complete']>(async (): Promise<CompleteResult> => ({
    available: true,
    text,
  }))
}

function makeProviderRow(id: string): ProviderProfileRow {
  return {
    id,
    name: id,
    provider_type: 'anthropic',
    config_json: '{}',
    keystore_ref: null,
    enabled: 1,
    is_default: 0,
    created_at: '',
    updated_at: '',
  } as unknown as ProviderProfileRow
}

function makeAvoidanceConfig(): AutoRouterConfig {
  const config = createDefaultAutoRouterConfig('claude')
  config.dispatcher = { providerProfileId: 'p-dispatch', modelId: 'dispatch-mini', timeoutMs: 8_000 }
  // 同强度（high）两条：首条为主、次条为热备
  config.executors = [
    { id: 'e-h1', providerProfileId: 'p-h1', modelId: 'opus-a', intensity: 'high', enabled: true },
    { id: 'e-h2', providerProfileId: 'p-h2', modelId: 'opus-b', intensity: 'high', enabled: true },
    { id: 'e-bal', providerProfileId: 'p-bal', modelId: 'sonnet-mid', intensity: 'balanced', enabled: true },
  ]
  return config
}

function makeAvoidanceInput(): AutoRouterRouteInput {
  return {
    sessionId: 's1',
    turnId: 't1',
    routerId: 'r1',
    routerName: '健康避让测试',
    config: makeAvoidanceConfig(),
    userMessage: '帮我重构这个模块',
    eventCount: 10,
    estimatedTokens: 2_000,
    recentUserMessages: [],
    sessionAdapter: 'claude',
    isTurnCancelled: () => false,
  }
}

describe('AutoRouterService 选执行器健康避让', () => {
  beforeEach(() => {
    autoRouterHealthRegistry.clear()
  })
  afterEach(() => {
    autoRouterHealthRegistry.clear()
  })

  function makeService(complete: CompleteMock, registry: AutoRouterHealthRegistry) {
    const rows = new Map(
      ['p-dispatch', 'p-h1', 'p-h2', 'p-bal'].map((id) => [id, makeProviderRow(id)]),
    )
    return new AutoRouterService({
      complete,
      getProviderRow: (id) => rows.get(id) ?? null,
      getLatestDecisionIntensity: () => null,
      healthRegistry: registry,
    })
  }

  it('主执行器冻结 → 同强度热备顶上，强度标签不变', async () => {
    const registry = new AutoRouterHealthRegistry()
    registry.reportFailure('p-h1', 'opus-a', 'retryable', 'HTTP 429')
    const result = await makeService(
      okComplete('{"intensity":"high","decompose":false,"subtasks":[],"reason":"重构"}'),
      registry,
    ).routeTurn(makeAvoidanceInput())
    expect(result.ok).toBe(true)
    expect(result.resolvedProviderId).toBe('p-h2')
    expect(result.resolvedModelId).toBe('opus-b')
    expect(result.intensity).toBe('high')
    expect(result.fallbackUsed).toBe(false)
    expect(result.skippedFrozenExecutors?.length).toBe(1)
    expect(result.skippedFrozenExecutors?.[0]?.providerId).toBe('p-h1')
  })

  it('全部执行器冻结 → best-effort 取最快解冻条目并标记 healthFallbackUsed', async () => {
    const registry = new AutoRouterHealthRegistry()
    const t0 = Date.now()
    registry.reportFailure('p-h1', 'opus-a', 'retryable', 'HTTP 429', t0) // 1min
    registry.reportFailure('p-h2', 'opus-b', 'retryable', 'HTTP 429', t0) // 1min
    registry.reportFailure('p-h2', 'opus-b', 'retryable', 'HTTP 429', t0 + 1) // 升 5min
    registry.reportFailure('p-bal', 'sonnet-mid', 'retryable', 'HTTP 429', t0)
    registry.reportFailure('p-bal', 'sonnet-mid', 'retryable', 'HTTP 429', t0 + 1)
    registry.reportFailure('p-bal', 'sonnet-mid', 'retryable', 'HTTP 429', t0 + 2) // 升 10min
    const result = await makeService(
      okComplete('{"intensity":"high","decompose":false,"subtasks":[],"reason":"重构"}'),
      registry,
    ).routeTurn(makeAvoidanceInput())
    // p-h1 冻结剩余最短（1min），best-effort 选中它
    expect(result.ok).toBe(true)
    expect(result.resolvedProviderId).toBe('p-h1')
    expect(result.healthFallbackUsed).toBe(true)
    // 避让清单排除最终选中的执行器（否则「避让了 A」同时「路由到 A」自相矛盾）
    expect(result.skippedFrozenExecutors?.length).toBe(2)
    expect(
      result.skippedFrozenExecutors?.some((item) => item.providerId === 'p-h1'),
    ).toBe(false)
  })

  it('无冻结 → 行为与既有语义一致（取第一条）', async () => {
    const registry = new AutoRouterHealthRegistry()
    const result = await makeService(
      okComplete('{"intensity":"high","decompose":false,"subtasks":[],"reason":"重构"}'),
      registry,
    ).routeTurn(makeAvoidanceInput())
    expect(result.resolvedProviderId).toBe('p-h1')
    expect(result.skippedFrozenExecutors).toBeUndefined()
    expect(result.healthFallbackUsed).toBeUndefined()
  })
})

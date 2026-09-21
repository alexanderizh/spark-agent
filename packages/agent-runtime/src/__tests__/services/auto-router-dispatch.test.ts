import { describe, expect, it, vi } from 'vitest'
import type { ProviderProfileRow } from '@spark/storage'
import {
  AutoRouterService,
  ruleClassifyIntensity,
  type AutoRouterRouteInput,
} from '../../services/auto-router.service'
import type { CompleteResult, ModelService } from '../../services/model.service'
import { createDefaultAutoRouterConfig, type AutoRouterConfig } from '@spark/protocol'

type CompleteMock = ReturnType<typeof vi.fn<ModelService['complete']>>

/** 成功返回固定文本的分流器 mock。 */
function okComplete(text: string): CompleteMock {
  return vi.fn<ModelService['complete']>(async (): Promise<CompleteResult> => ({
    available: true,
    text,
  }))
}

/** 失败（超时/HTTP）返回的分流器 mock。 */
function failComplete(reason: string): CompleteMock {
  return vi.fn<ModelService['complete']>(async (): Promise<CompleteResult> => ({
    available: false,
    reason,
  }))
}

/**
 * AutoRouter 分流决策链单测：LLM 正常 / 超时 / 坏 JSON 兜底 / 强度粘性 /
 * 取消中止 / adapterMismatch 回退 / 无可用执行器。依赖全部注入，无 IO。
 */

function makeConfig(overrides?: Partial<AutoRouterConfig>): AutoRouterConfig {
  const config = createDefaultAutoRouterConfig('claude')
  config.dispatcher = { providerProfileId: 'p-dispatch', modelId: 'dispatch-mini', timeoutMs: 8_000 }
  config.executors = [
    { id: 'e-high', providerProfileId: 'p-high', modelId: 'opus-max', intensity: 'high', enabled: true },
    { id: 'e-bal', providerProfileId: 'p-bal', modelId: 'sonnet-mid', intensity: 'balanced', enabled: true },
    { id: 'e-low', providerProfileId: 'p-low', modelId: 'haiku-small', intensity: 'low', enabled: true },
  ]
  return { ...config, ...overrides }
}

function makeProviderRow(id: string, providerType = 'anthropic'): ProviderProfileRow {
  return {
    id,
    name: id,
    provider_type: providerType,
    config_json: '{}',
    keystore_ref: null,
    enabled: 1,
    is_default: 0,
    created_at: '',
    updated_at: '',
  } as unknown as ProviderProfileRow
}

function makeInput(overrides?: Partial<AutoRouterRouteInput>): AutoRouterRouteInput {
  return {
    sessionId: 's1',
    turnId: 't1',
    routerId: 'r1',
    routerName: '测试路由',
    config: makeConfig(),
    userMessage: '帮我重构这个模块',
    eventCount: 10,
    estimatedTokens: 2_000,
    recentUserMessages: [],
    sessionAdapter: 'claude',
    isTurnCancelled: () => false,
    ...overrides,
  }
}

function makeService(complete: CompleteMock, options?: {
  providerRows?: ProviderProfileRow[]
  latestIntensity?: 'high' | 'balanced' | 'low' | null
}) {
  const rows = new Map(
    (options?.providerRows ?? [
      makeProviderRow('p-dispatch'),
      makeProviderRow('p-high'),
      makeProviderRow('p-bal'),
      makeProviderRow('p-low'),
    ]).map((row) => [row.id, row]),
  )
  return new AutoRouterService({
    complete,
    getProviderRow: (id) => rows.get(id) ?? null,
    getLatestDecisionIntensity: () => options?.latestIntensity ?? null,
  })
}

describe('AutoRouterService 分流决策链', () => {
  it('LLM 正常返回合法 JSON → 按强度选执行器，非兜底', async () => {
    const complete = okComplete('{"intensity":"high","decompose":true,"subtasks":[{"summary":"检索","intensity":"low","parallelizable":true}],"reason":"跨模块重构"}')
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput())
    expect(result.ok).toBe(true)
    expect(result.intensity).toBe('high')
    expect(result.resolvedProviderId).toBe('p-high')
    expect(result.resolvedModelId).toBe('opus-max')
    expect(result.fallbackUsed).toBe(false)
    expect(result.decompose).toBe(true)
    expect(result.subtasks.length).toBe(1)
    expect(complete).toHaveBeenCalledTimes(1)
    // 分流调用走显式 provider/model + systemPrompt + 超时
    const call = complete.mock.calls[0]
    expect(call?.[1]?.providerId).toBe('p-dispatch')
    expect(call?.[1]?.model).toBe('dispatch-mini')
    expect(call?.[1]?.systemPrompt).toBeTruthy()
    expect(call?.[1]?.timeoutMs).toBe(8_000)
  })

  it('LLM 超时失败 → 规则兜底分类（含"重构" → high）', async () => {
    const complete = failComplete('HTTP timeout after 8000ms')
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput())
    expect(result.intensity).toBe('high')
    expect(result.fallbackUsed).toBe(true)
    expect(result.fallbackStage).toBe('timeout')
    expect(result.resolvedModelId).toBe('opus-max')
    // 失败重试 1 次
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('LLM 返回坏 JSON（重试后仍坏）→ schema 兜底 balanced', async () => {
    const complete = okComplete('这不是 JSON')
    const service = makeService(complete)
    const result = await service.routeTurn(
      makeInput({ userMessage: '普通问题' }),
    )
    expect(result.fallbackUsed).toBe(true)
    expect(result.fallbackStage).toBe('schema')
    expect(result.intensity).toBe('balanced')
    expect(result.resolvedModelId).toBe('sonnet-mid')
  })

  it('强度粘性：决策强度与上轮相同且执行器一致 → keptPrevIntensity', async () => {
    const complete = okComplete('{"intensity":"low","decompose":false,"subtasks":[],"reason":"继续上一轮"}')
    const service = makeService(complete, { latestIntensity: 'low' })
    const result = await service.routeTurn(makeInput({ userMessage: '继续' }))
    expect(result.intensity).toBe('low')
    expect(result.keptPrevIntensity).toBe(true)
    expect(result.prevIntensity).toBe('low')
  })

  it('轮次已取消 → cancelled=true，不选执行器', async () => {
    const complete = okComplete('{}')
    const service = makeService(complete)
    const result = await service.routeTurn(
      makeInput({ isTurnCancelled: () => true }),
    )
    expect(result.cancelled).toBe(true)
    expect(complete).not.toHaveBeenCalled()
  })

  it('adapterMismatch：codex 会话选 claude router → 回退匹配渠道并标记', async () => {
    const complete = okComplete('{}')
    const rows = [
      makeProviderRow('p-dispatch'),
      makeProviderRow('p-high'), // anthropic：不匹配 codex
      makeProviderRow('p-bal', 'openai'), // openai：匹配 codex
      makeProviderRow('p-low'),
    ]
    const service = makeService(complete, { providerRows: rows })
    const result = await service.routeTurn(makeInput({ sessionAdapter: 'codex' }))
    expect(result.adapterMismatch).toBe(true)
    expect(result.fallbackUsed).toBe(true)
    // fallbackIntensity=balanced → p-bal（openai 渠道，匹配 codex 引擎）
    expect(result.resolvedProviderId).toBe('p-bal')
    expect(complete).not.toHaveBeenCalled()
  })

  it('执行器渠道全部失效 → ok=false + no_executor', async () => {
    const complete = okComplete('{}')
    const service = makeService(complete, {
      providerRows: [makeProviderRow('p-dispatch')], // 只留分流器渠道
    })
    const result = await service.routeTurn(makeInput())
    expect(result.ok).toBe(false)
    expect(result.fallbackStage).toBe('no_executor')
    expect(result.invalidEntries.length).toBe(3)
  })

  it('强度档未配置执行器 → 回落兜底强度并标注', async () => {
    const complete = okComplete('{"intensity":"high","decompose":false,"subtasks":[],"reason":"复杂任务"}')
    const service = makeService(complete)
    const result = await service.routeTurn(
      makeInput({
        config: (() => {
          const config = makeConfig()
          config.executors = config.executors.filter((entry) => entry.intensity !== 'high')
          return config
        })(),
      }),
    )
    // high 档缺失 → 回落 balanced
    expect(result.intensity).toBe('balanced')
    expect(result.fallbackUsed).toBe(true)
    expect(result.resolvedModelId).toBe('sonnet-mid')
  })
})

describe('ruleClassifyIntensity 规则兜底', () => {
  it('token 阈值 → high', () => {
    expect(ruleClassifyIntensity('继续', 50_000)).toBe('high')
  })
  it('延续性回复 → low', () => {
    expect(ruleClassifyIntensity('好的', 100)).toBe('low')
    expect(ruleClassifyIntensity('继续', 100)).toBe('low')
  })
  it('复杂词 → high；其余 balanced', () => {
    expect(ruleClassifyIntensity('帮我重构认证模块', 100)).toBe('high')
    expect(ruleClassifyIntensity('写一段介绍', 100)).toBe('balanced')
  })
})

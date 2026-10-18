import { describe, expect, it, vi } from 'vitest'
import type { ProviderProfileRow } from '@spark/storage'
import {
  AutoRouterService,
  ruleClassifyIntensity,
  type AutoRouterLatestDecision,
  type AutoRouterRouteInput,
} from '../../services/auto-router.service'
import type { CompleteResult, ModelService } from '../../services/model.service'
import { AutoRouterHealthRegistry } from '../../services/auto-router-health'
import { createDefaultAutoRouterConfig, type AutoRouterConfig } from '@spark/protocol'

type CompleteMock = ReturnType<typeof vi.fn<ModelService['complete']>>

/** 成功返回固定文本的分流器 mock。 */
function okComplete(text: string): CompleteMock {
  return vi.fn<ModelService['complete']>(
    async (): Promise<CompleteResult> => ({
      available: true,
      text,
    }),
  )
}

/** 失败（超时/HTTP）返回的分流器 mock。 */
function failComplete(reason: string): CompleteMock {
  return vi.fn<ModelService['complete']>(
    async (): Promise<CompleteResult> => ({
      available: false,
      reason,
    }),
  )
}

/**
 * AutoRouter 分流决策链单测：LLM 正常 / 超时 / 坏 JSON 兜底 / 强度粘性 /
 * 取消中止 / adapterMismatch 回退 / 无可用执行器。依赖全部注入，无 IO。
 */

function makeConfig(overrides?: Partial<AutoRouterConfig>): AutoRouterConfig {
  const config = createDefaultAutoRouterConfig('claude')
  config.dispatcher = {
    providerProfileId: 'p-dispatch',
    modelId: 'dispatch-mini',
    timeoutMs: 8_000,
  }
  config.executors = [
    {
      id: 'e-high',
      providerProfileId: 'p-high',
      modelId: 'opus-max',
      intensity: 'high',
      enabled: true,
    },
    {
      id: 'e-bal',
      providerProfileId: 'p-bal',
      modelId: 'sonnet-mid',
      intensity: 'balanced',
      enabled: true,
    },
    {
      id: 'e-low',
      providerProfileId: 'p-low',
      modelId: 'haiku-small',
      intensity: 'low',
      enabled: true,
    },
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

function makeService(
  complete: CompleteMock,
  options?: {
    providerRows?: ProviderProfileRow[]
    latestDecision?: AutoRouterLatestDecision | null
    healthRegistry?: AutoRouterHealthRegistry
  },
) {
  const rows = new Map(
    (
      options?.providerRows ?? [
        makeProviderRow('p-dispatch'),
        makeProviderRow('p-high'),
        makeProviderRow('p-bal'),
        makeProviderRow('p-low'),
      ]
    ).map((row) => [row.id, row]),
  )
  return new AutoRouterService({
    complete,
    getProviderRow: (id) => rows.get(id) ?? null,
    getLatestDecision: () => options?.latestDecision ?? null,
    ...(options?.healthRegistry != null ? { healthRegistry: options.healthRegistry } : {}),
  })
}

describe('AutoRouterService 分流决策链', () => {
  it('LLM 正常返回合法 JSON → 按强度选执行器，非兜底', async () => {
    const complete = okComplete(
      '{"intensity":"high","decompose":true,"subtasks":[{"summary":"检索","intensity":"low","parallelizable":true}],"reason":"跨模块重构"}',
    )
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

  it('执行器显式推理强度 → 路由结果透传；未配置 → 缺省（跟随会话）', async () => {
    const config = makeConfig()
    config.executors[0] = {
      ...config.executors[0]!,
      reasoningEffort: 'xhigh',
    }
    const complete = okComplete(
      '{"intensity":"high","decompose":false,"subtasks":[],"reason":"重构"}',
    )
    const service = makeService(complete)
    const routed = await service.routeTurn(makeInput({ config }))
    expect(routed.reasoningEffort).toBe('xhigh')

    // 未配置推理强度的执行器：结果不带该字段（渲染端不展示、运行时跟随会话）
    const plain = await makeService(
      okComplete('{"intensity":"low","decompose":false,"subtasks":[],"reason":"简单"}'),
    ).routeTurn(makeInput())
    expect(plain.reasoningEffort).toBeUndefined()
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
    const result = await service.routeTurn(makeInput({ userMessage: '普通问题' }))
    expect(result.fallbackUsed).toBe(true)
    expect(result.fallbackStage).toBe('schema')
    expect(result.intensity).toBe('balanced')
    expect(result.resolvedModelId).toBe('sonnet-mid')
  })

  it('强度粘性：决策强度与上轮相同且执行器一致 → keptPrevIntensity', async () => {
    // 消息避开延续语/低强度规则（否则会被本地快路径截获，测不到 LLM 粘性链路）
    const complete = okComplete(
      '{"intensity":"low","decompose":false,"subtasks":[],"reason":"继续上一轮"}',
    )
    const service = makeService(complete, {
      latestDecision: { intensity: 'low', routerId: 'r1' },
    })
    const result = await service.routeTurn(makeInput({ userMessage: '把刚才的实现再补一些测试' }))
    expect(result.intensity).toBe('low')
    expect(result.keptPrevIntensity).toBe(true)
    expect(result.prevIntensity).toBe('low')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('轮次已取消 → cancelled=true，不选执行器', async () => {
    const complete = okComplete('{}')
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput({ isTurnCancelled: () => true }))
    expect(result.cancelled).toBe(true)
    expect(complete).not.toHaveBeenCalled()
  })

  it('分流调用中途用户取消 → cancelled=true，不得降级为规则兜底继续执行', async () => {
    let cancelled = false
    const complete = vi.fn<ModelService['complete']>(async (): Promise<CompleteResult> => {
      // 模拟：分流 HTTP 在途时用户点了停止，取消轮询 abort 掉在途请求
      cancelled = true
      return { available: false, reason: 'Request to https://x was aborted before dispatch' }
    })
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput({ isTurnCancelled: () => cancelled }))
    expect(result.cancelled).toBe(true)
    expect(result.resolvedProviderId).toBe('')
    // 已取消就不该再发第二次分流请求（重试耗尽会带 cancelled=false 返回）
    expect(complete).toHaveBeenCalledTimes(1)
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
    const complete = okComplete(
      '{"intensity":"high","decompose":false,"subtasks":[],"reason":"复杂任务"}',
    )
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

  it('规则兜底 + 该强度档未配置 → 强度标签仍对齐实际执行器（P3 回归）', async () => {
    // 分流器超时（fallbackUsed=true）→ 规则判出 high；但只有 balanced 档配了执行器。
    // 修复前 !fallbackUsed 守卫会让强度标签停在 high，实际跑的是 balanced 模型，
    // 渲染端据此显示「●高」+ 错误模型强度语义。
    const complete = failComplete('HTTP timeout after 8000ms')
    const service = makeService(complete)
    const config = makeConfig()
    config.executors = config.executors.filter((entry) => entry.intensity !== 'high')
    const result = await service.routeTurn(makeInput({ config }))
    expect(result.fallbackUsed).toBe(true)
    expect(result.resolvedModelId).toBe('sonnet-mid')
    expect(result.intensity).toBe('balanced')
    // 文案为「档不可用」：涵盖未配置与健康冻结避让两种回落来源
    expect(result.reason).toContain('档不可用')
  })

  it('取消分支契约：cancelled=true 且 resolved 为空（调用方须先判 cancelled，不得报配置错）', async () => {
    const service = makeService(okComplete('{}'))
    const result = await service.routeTurn(makeInput({ isTurnCancelled: () => true }))
    expect(result.cancelled).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.resolvedProviderId).toBe('')
    expect(result.reason).toBe('轮次已取消')
  })

  it('确定性 4xx（如套餐无权限 403）→ 不重试，降级 reason 含人话详情', async () => {
    const complete = failComplete(
      'HTTP 403: {"type":"error","error":{"type":"api_error","code":"1311","message":"[1311][当前订阅套餐暂未开放GLM-5.3-FlashX权限]"}}',
    )
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput({ userMessage: '普通问题' }))
    // 401/403/404/400 等确定性错误：立即收口，不白付第二次调用
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fallbackUsed).toBe(true)
    expect(result.fallbackStage).toBe('http')
    expect(result.reason).toContain('HTTP 403')
    expect(result.reason).toContain('暂未开放')
  })

  it('429（可能瞬时限流）→ 保留一次重试', async () => {
    const complete = failComplete('HTTP 429: rate limited')
    const service = makeService(complete)
    const result = await service.routeTurn(makeInput({ userMessage: '普通问题' }))
    expect(complete).toHaveBeenCalledTimes(2)
    expect(result.fallbackUsed).toBe(true)
    expect(result.reason).toContain('HTTP 429')
  })

  it('testDispatcher：渠道可用 → ok；无权限模型 → 带回业务错误详情', async () => {
    // 可用
    const okService = makeService(okComplete('ok'))
    const okResult = await okService.testDispatcher({
      dispatcher: { providerProfileId: 'p-dispatch', modelId: 'dispatch-mini', timeoutMs: 5_000 },
    })
    expect(okResult.ok).toBe(true)

    // 套餐无权限（真实 429 形态）：错误须包含状态码与业务 message，供弹层直接展示
    const failService = makeService(
      failComplete(
        'HTTP 429: {"type":"error","error":{"type":"api_error","code":"1311","message":"[1311][当前订阅套餐暂未开放GLM-5.3-FlashX权限]"}}',
      ),
    )
    const failResult = await failService.testDispatcher({
      dispatcher: { providerProfileId: 'p-dispatch', modelId: 'glm-5.3-flashx', timeoutMs: 5_000 },
    })
    expect(failResult.ok).toBe(false)
    if (!failResult.ok) {
      expect(failResult.error).toContain('HTTP 429')
      expect(failResult.error).toContain('暂未开放')
    }

    // 渠道不存在 / 已禁用：配置期即可发现，无需发请求
    const noRowService = new AutoRouterService({
      complete: okComplete('ok'),
      getProviderRow: () => null,
      getLatestDecision: () => null,
    })
    const noRow = await noRowService.testDispatcher({
      dispatcher: { providerProfileId: 'p-missing', modelId: 'm', timeoutMs: 5_000 },
    })
    expect(noRow.ok).toBe(false)

    const disabledRows = new Map([['p-dispatch', { ...makeProviderRow('p-dispatch'), enabled: 0 }]])
    const disabledService = new AutoRouterService({
      complete: okComplete('ok'),
      getProviderRow: (id) => disabledRows.get(id) ?? null,
      getLatestDecision: () => null,
    })
    const disabled = await disabledService.testDispatcher({
      dispatcher: { providerProfileId: 'p-dispatch', modelId: 'm', timeoutMs: 5_000 },
    })
    expect(disabled.ok).toBe(false)
    if (!disabled.ok) expect(disabled.error).toContain('已禁用')
  })

  it('extractDispatchFailureDetail：从真实错误体提取 message，无 JSON 时截断原文', async () => {
    const { extractDispatchFailureDetail } = await import('../../services/auto-router.service')
    expect(
      extractDispatchFailureDetail(
        'HTTP 429: {"type":"error","error":{"type":"api_error","message":"[1311][当前订阅套餐暂未开放GLM-5.3-FlashX权限]"}}',
      ),
    ).toBe('HTTP 429：[1311][当前订阅套餐暂未开放GLM-5.3-FlashX权限]')
    expect(extractDispatchFailureDetail('fetch failed')).toBe('fetch failed')
  })
})

describe('本地快路径（明确延续/明确低强度消息跳过分流 LLM）', () => {
  const fastLatest = (intensity: 'high' | 'balanced' | 'low'): AutoRouterLatestDecision => ({
    intensity,
    routerId: 'r1',
  })

  it('明确延续语 + 同 router 上一轮强度 → 不发 LLM，维持上一轮强度', async () => {
    const complete = okComplete('{"intensity":"high","decompose":false,"subtasks":[],"reason":"x"}')
    const service = makeService(complete, { latestDecision: fastLatest('high') })
    const result = await service.routeTurn(makeInput({ userMessage: '继续' }))
    expect(complete).not.toHaveBeenCalled()
    expect(result.fastPathUsed).toBe(true)
    expect(result.intensity).toBe('high')
    expect(result.resolvedProviderId).toBe('p-high')
    expect(result.fallbackUsed).toBe(false)
    expect(result.decompose).toBe(false)
    expect(result.reason).toContain('本地快路径')
    // 健康避让与强度粘性照常执行（不 early-return 的回归断言）
    expect(result.keptPrevIntensity).toBe(true)
  })

  it('无上一条决策（首轮延续语）→ 不命中延续分支，走 LLM', async () => {
    const complete = okComplete(
      '{"intensity":"balanced","decompose":false,"subtasks":[],"reason":"常规"}',
    )
    const service = makeService(complete, { latestDecision: null })
    const result = await service.routeTurn(makeInput({ userMessage: '继续' }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
    expect(result.intensity).toBe('balanced')
  })

  it('上一条决策来自别的 router（成员路径/切换渠道）→ 不命中', async () => {
    const complete = okComplete(
      '{"intensity":"low","decompose":false,"subtasks":[],"reason":"简单"}',
    )
    const service = makeService(complete, {
      latestDecision: { intensity: 'low', routerId: 'r-other' },
    })
    const result = await service.routeTurn(makeInput({ userMessage: '继续' }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
  })

  it('明确低强度消息（翻译类）且未命中高强度正则 → 命中 low', async () => {
    const complete = okComplete(
      '{"intensity":"low","decompose":false,"subtasks":[],"reason":"简单"}',
    )
    const service = makeService(complete, { latestDecision: fastLatest('high') })
    const result = await service.routeTurn(makeInput({ userMessage: '帮我翻译这段话' }))
    expect(complete).not.toHaveBeenCalled()
    expect(result.fastPathUsed).toBe(true)
    expect(result.intensity).toBe('low')
    expect(result.resolvedProviderId).toBe('p-low')
  })

  it('低强度 + 高强度双命中（"翻译并重构"）→ 不命中（规则先判低会误判，快路径必须排除）', async () => {
    const complete = okComplete(
      '{"intensity":"high","decompose":false,"subtasks":[],"reason":"重构"}',
    )
    const service = makeService(complete, { latestDecision: fastLatest('high') })
    const result = await service.routeTurn(makeInput({ userMessage: '翻译并重构这段代码' }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
    expect(result.intensity).toBe('high')
  })

  it('正常任务消息 → 不命中，走 LLM 分流', async () => {
    const complete = okComplete(
      '{"intensity":"high","decompose":false,"subtasks":[],"reason":"复杂"}',
    )
    const service = makeService(complete, { latestDecision: fastLatest('low') })
    const result = await service.routeTurn(makeInput())
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
  })

  it('目标强度执行器全部冻结 → 不命中（避免回落档位被误标"分流降级"）', async () => {
    const complete = okComplete(
      '{"intensity":"low","decompose":false,"subtasks":[],"reason":"简单"}',
    )
    const health = new AutoRouterHealthRegistry()
    health.reportFailure('p-low', 'haiku-small', 'deterministic', 'HTTP 403 无权限')
    const service = makeService(complete, {
      latestDecision: fastLatest('low'),
      healthRegistry: health,
    })
    const result = await service.routeTurn(makeInput({ userMessage: '继续' }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
  })

  it('低强度档未配置执行器 → 不命中，回落决策交给 LLM 链路', async () => {
    const complete = okComplete(
      '{"intensity":"balanced","decompose":false,"subtasks":[],"reason":"常规"}',
    )
    const config = makeConfig()
    config.executors = config.executors.filter((entry) => entry.intensity !== 'low')
    const service = makeService(complete, { latestDecision: fastLatest('low') })
    const result = await service.routeTurn(makeInput({ userMessage: '帮我翻译这段话', config }))
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
  })

  it('长会话高 estimatedTokens 不影响快路径（消息自身 token 口径）', async () => {
    const complete = okComplete(
      '{"intensity":"balanced","decompose":false,"subtasks":[],"reason":"x"}',
    )
    const service = makeService(complete, { latestDecision: fastLatest('high') })
    const result = await service.routeTurn(
      makeInput({ userMessage: '继续', estimatedTokens: 200_000, eventCount: 500 }),
    )
    expect(complete).not.toHaveBeenCalled()
    expect(result.fastPathUsed).toBe(true)
    expect(result.intensity).toBe('high')
  })

  it('轮次已取消 → 返回取消契约（cancelled=true，不发 LLM）', async () => {
    const complete = okComplete('{"intensity":"low","decompose":false,"subtasks":[],"reason":"x"}')
    const service = makeService(complete, { latestDecision: fastLatest('low') })
    const result = await service.routeTurn(
      makeInput({ userMessage: '继续', isTurnCancelled: () => true }),
    )
    expect(complete).not.toHaveBeenCalled()
    expect(result.cancelled).toBe(true)
    expect(result.reason).toBe('轮次已取消')
  })

  it('fastPathEnabled=false → 强制全量走 LLM（排查开关）', async () => {
    const complete = okComplete(
      '{"intensity":"low","decompose":false,"subtasks":[],"reason":"简单"}',
    )
    const service = makeService(complete, { latestDecision: fastLatest('low') })
    const result = await service.routeTurn(
      makeInput({ userMessage: '继续', config: makeConfig({ fastPathEnabled: false }) }),
    )
    expect(complete).toHaveBeenCalledTimes(1)
    expect(result.fastPathUsed).toBeUndefined()
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

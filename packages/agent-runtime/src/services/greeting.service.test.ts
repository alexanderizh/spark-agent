/**
 * @module greeting.service.test
 *
 * 单测：空会话问候语的 2 小时缓存、失败冷却、模型档位逐档降级与文案清洗。
 * 全程不联网：complete() 由 fake 提供。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GreetingService,
  sanitizeGreeting,
  GREETING_FAILURE_COOLDOWN_MS,
  GREETING_MAX_MODEL_ATTEMPTS,
  GREETING_REFRESH_INTERVAL_MS,
  GREETING_STYLES,
  type GreetingCompletion,
  type GreetingModelRef,
  type GreetingServiceDeps,
} from './greeting.service.js'

const HOUR = 9 // 早上：前缀「早上好，」

/** 默认档位：除显式声明 defaultChats: [] 的用例（验证全空降级）外，测试都落在这档。 */
const DEFAULT_CHAT_MODEL: GreetingModelRef = {
  providerId: 'default-prov',
  model: 'gpt-4o-mini',
  source: 'default-chat',
}

function makeHarness(
  opts: {
    /** memory 分类下的 settings（抽取模型档位）。 */
    memory?: Record<string, unknown>
    complete?: GreetingCompletion
    /** 二级档位候选（按优先级）；缺省为 [DEFAULT_CHAT_MODEL]，传 [] 表示该级无候选。 */
    defaultChats?: GreetingModelRef[]
    sessionChat?: GreetingModelRef | null
    startAt?: number
  } = {},
): {
  service: GreetingService
  /** greeting 分类下的 settings（= 缓存落点）。 */
  greetingSettings: Record<string, unknown>
  complete: ReturnType<typeof vi.fn>
  advance: (ms: number) => void
} {
  const memorySettings: Record<string, unknown> = { ...(opts.memory ?? {}) }
  const greetingSettings: Record<string, unknown> = {}
  const complete = vi.fn(
    opts.complete ??
      (async () => ({ available: true as const, text: '愿你今日灵感如泉' }) as const),
  )
  let clock = opts.startAt ?? new Date(2026, 0, 1, HOUR, 0, 0).getTime()

  const deps: GreetingServiceDeps = {
    complete: complete as unknown as GreetingCompletion,
    settingsGet: (category, key) => {
      if (category === 'memory') return memorySettings[key] ?? null
      if (category === 'greeting') return greetingSettings[key] ?? null
      return null
    },
    settingsSet: (category, key, value) => {
      if (category === 'greeting') greetingSettings[key] = value
    },
    getDefaultChatModels: () => opts.defaultChats ?? [DEFAULT_CHAT_MODEL],
    getSessionChatModel: () => opts.sessionChat ?? null,
    now: () => clock,
  }

  return {
    service: new GreetingService(deps),
    greetingSettings,
    complete,
    advance: (ms) => {
      clock += ms
    },
  }
}

describe('GreetingService — 模型档位回退链', () => {
  it('当前会话模型是第一档（用户明确选中的模型优先）', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      defaultChats: [{ providerId: 'default-prov', model: 'gpt-4o', source: 'default-chat' }],
      sessionChat: { providerId: 'sess-prov', model: 'sess-model', source: 'session' },
    })
    const res = await h.service.getGreeting({ sessionId: 'sess-1' })
    expect(res).toMatchObject({ ok: true, source: 'model', model: 'sess-model' })
    expect(h.complete).toHaveBeenCalledTimes(1)
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({
      providerId: 'sess-prov',
      model: 'sess-model',
    })
  })

  it('无会话模型时优先使用记忆抽取小模型（不经默认渠道）', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      defaultChats: [{ providerId: 'default-prov', model: 'gpt-4o', source: 'default-chat' }],
    })
    const res = await h.service.getGreeting({})
    expect(res).toMatchObject({ ok: true, source: 'model', model: 'haiku' })
    expect(h.complete).toHaveBeenCalledTimes(1)
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({
      providerId: 'mem-prov',
      model: 'haiku',
    })
  })

  it('无会话、无抽取配置时使用默认对话模型', async () => {
    const h = makeHarness({})
    await h.service.getGreeting({})
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'default-prov' })
  })

  it('会话模型解析失败（如自动路由会话 model_id 为空）时落到记忆抽取档', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      defaultChats: [],
      sessionChat: null,
    })
    await h.service.getGreeting({ sessionId: 'sess-1' })
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'mem-prov' })
  })

  it('档位全空 → ok:false，不调用模型（渲染端回退写死文案）', async () => {
    const h = makeHarness({ defaultChats: [] })
    const res = await h.service.getGreeting({})
    expect(res).toEqual({ ok: false, reason: 'no model available' })
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('抽取模型只配了一半（缺 model）不算命中，继续往下回退', async () => {
    const h = makeHarness({ memory: { extractionProviderId: 'mem-prov' } })
    await h.service.getGreeting({})
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'default-prov' })
  })
})

describe('GreetingService — 逐档降级（某档必然失败时换下一档）', () => {
  /** 前 failCount 次调用失败，之后成功。 */
  const failingThenOk = (failCount: number) => {
    let calls = 0
    return vi.fn(async (_prompt: string, opts: { providerId: string }) => {
      calls += 1
      return calls <= failCount
        ? { available: false as const, reason: `HTTP 403: ${opts.providerId} 不可用` }
        : { available: true as const, text: '愿你今日灵感如泉' }
    })
  }

  it('默认渠道失败 → 自动改试下一个对话渠道并成功', async () => {
    const h = makeHarness({
      defaultChats: [
        { providerId: 'broken-prov', model: 'broken-model', source: 'default-chat' },
        { providerId: 'good-prov', model: 'good-model', source: 'default-chat' },
      ],
      complete: failingThenOk(1) as unknown as GreetingCompletion,
    })
    const res = await h.service.getGreeting({})

    expect(res).toMatchObject({ ok: true, source: 'model', model: 'good-model' })
    expect(h.complete).toHaveBeenCalledTimes(2)
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'broken-prov' })
    expect(h.complete.mock.calls[1]?.[1]).toMatchObject({ providerId: 'good-prov' })
  })

  it('抽取模型失败也会继续降级到默认渠道', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      complete: failingThenOk(1) as unknown as GreetingCompletion,
    })
    const res = await h.service.getGreeting({})

    expect(res).toMatchObject({ ok: true, model: 'gpt-4o-mini' })
    expect(h.complete).toHaveBeenCalledTimes(2)
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'mem-prov' })
  })

  it('全部档位失败 → ok:false，且 lastError 记录最后一档的原因', async () => {
    const h = makeHarness({
      defaultChats: [
        { providerId: 'p1', model: 'm1', source: 'default-chat' },
        { providerId: 'p2', model: 'm2', source: 'default-chat' },
      ],
      complete: (async (_p: string, opts: { providerId: string }) => ({
        available: false as const,
        reason: `fail:${opts.providerId}`,
      })) as unknown as GreetingCompletion,
    })
    const res = await h.service.getGreeting({})

    expect(res).toEqual({ ok: false, reason: 'fail:p2' })
    expect(h.complete).toHaveBeenCalledTimes(2)
    expect((h.greetingSettings.emptyHero as Record<string, unknown>).lastError).toBe('fail:p2')
  })

  it('候选去重，同一 provider+model 只试一次', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'dup-prov', extractionModel: 'dup-model' },
      defaultChats: [
        { providerId: 'dup-prov', model: 'dup-model', source: 'default-chat' },
        { providerId: 'other', model: 'other-model', source: 'default-chat' },
      ],
      complete: (async () => ({
        available: false as const,
        reason: 'nope',
      })) as unknown as GreetingCompletion,
    })
    await h.service.getGreeting({})

    expect(h.complete).toHaveBeenCalledTimes(2)
    expect(h.complete.mock.calls.map((c) => (c[1] as { providerId: string }).providerId)).toEqual([
      'dup-prov',
      'other',
    ])
  })

  it('尝试档位数有上限，避免一次请求打过多渠道', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      defaultChats: Array.from({ length: 6 }, (_, i) => ({
        providerId: `p${i}`,
        model: `m${i}`,
        source: 'default-chat' as const,
      })),
      sessionChat: { providerId: 'sess-prov', model: 'sess-model', source: 'session' },
      complete: (async () => ({
        available: false as const,
        reason: 'nope',
      })) as unknown as GreetingCompletion,
    })
    await h.service.getGreeting({ sessionId: 'sess-1' })

    expect(h.complete).toHaveBeenCalledTimes(GREETING_MAX_MODEL_ATTEMPTS)
  })
})

describe('GreetingService — 缓存与刷新', () => {
  it('2 小时窗口内命中缓存，不再调用模型', async () => {
    const h = makeHarness()
    const first = await h.service.getGreeting({})
    expect(first).toMatchObject({ ok: true, source: 'model' })

    h.advance(GREETING_REFRESH_INTERVAL_MS - 1000)
    const second = await h.service.getGreeting({})
    expect(second).toMatchObject({ ok: true, source: 'cache', text: '愿你今日灵感如泉' })
    expect(h.complete).toHaveBeenCalledTimes(1)
  })

  it('超过 2 小时重新生成', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    h.advance(GREETING_REFRESH_INTERVAL_MS + 1000)
    const res = await h.service.getGreeting({})
    expect(res).toMatchObject({ ok: true, source: 'model' })
    expect(h.complete).toHaveBeenCalledTimes(2)
  })

  it('forceRefresh 忽略缓存', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const res = await h.service.getGreeting({ forceRefresh: true })
    expect(res).toMatchObject({ ok: true, source: 'model' })
    expect(h.complete).toHaveBeenCalledTimes(2)
  })

  it('缓存内容由 app_settings 持久化（跨实例复用）', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    expect(h.greetingSettings.emptyHero).toMatchObject({ text: '愿你今日灵感如泉' })
  })
})

describe('GreetingService — 失败降级与冷却', () => {
  it('模型返回 unavailable → ok:false 且不污染缓存文案', async () => {
    const h = makeHarness({ complete: async () => ({ available: false, reason: 'HTTP 401' }) })
    const res = await h.service.getGreeting({})
    expect(res).toEqual({ ok: false, reason: 'HTTP 401' })
    const record = h.greetingSettings.emptyHero as Record<string, unknown>
    expect(record.text).toBeUndefined()
    expect(record.lastError).toBe('HTTP 401')
  })

  it('失败后 5 分钟冷却内不再重试', async () => {
    const h = makeHarness({ complete: async () => ({ available: false, reason: 'network down' }) })
    await h.service.getGreeting({})
    h.advance(GREETING_FAILURE_COOLDOWN_MS - 1000)
    const res = await h.service.getGreeting({})
    expect(res.ok).toBe(false)
    expect(h.complete).toHaveBeenCalledTimes(1)
  })

  it('冷却期过后允许重试并成功', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ available: false, reason: 'network down' })
      .mockResolvedValueOnce({ available: true, text: '愿你今日灵感如泉' })
    const h = makeHarness({ complete: complete as unknown as GreetingCompletion })
    expect((await h.service.getGreeting({})).ok).toBe(false)
    h.advance(GREETING_FAILURE_COOLDOWN_MS + 1000)
    const res = await h.service.getGreeting({})
    expect(res).toMatchObject({ ok: true, source: 'model' })
    expect(h.complete).toHaveBeenCalledTimes(2)
  })

  it('complete 抛异常也被吞掉，返回 ok:false', async () => {
    const h = makeHarness({
      complete: (async () => {
        throw new Error('boom')
      }) as unknown as GreetingCompletion,
    })
    await expect(h.service.getGreeting({})).resolves.toEqual({ ok: false, reason: 'boom' })
  })

  it('模型输出清洗后为空 → ok:false', async () => {
    const h = makeHarness({ complete: async () => ({ available: true, text: '   ' }) })
    const res = await h.service.getGreeting({})
    expect(res.ok).toBe(false)
  })

  it('生成失败后过期缓存不再被复用（回退写死文案而非旧内容）', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ available: true, text: '愿你今日灵感如泉' })
      .mockResolvedValueOnce({ available: false, reason: 'HTTP 500' })
    const h = makeHarness({ complete: complete as unknown as GreetingCompletion })
    await h.service.getGreeting({})
    h.advance(GREETING_REFRESH_INTERVAL_MS + 1000)
    const res = await h.service.getGreeting({})
    expect(res).toEqual({ ok: false, reason: 'HTTP 500' })
  })
})

describe('GreetingService — 请求参数', () => {
  it('抬高温度以保证多样性，并带上 system prompt', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const opts = h.complete.mock.calls[0]?.[1] as Record<string, unknown>
    expect(opts.temperature).toBeGreaterThan(0)
    expect(String(opts.systemPrompt)).toContain('问候语')
  })

  it('单档不做瞬时重试（maxRetries=0）：超时不应把单档耗时翻倍，降级发生在档间', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const opts = h.complete.mock.calls[0]?.[1] as Record<string, unknown>
    expect(opts.maxRetries).toBe(0)
  })

  it('prompt 带当前时段作氛围参考，但明确不要用时段称呼开头', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const prompt = String(h.complete.mock.calls[0]?.[0])
    expect(prompt).toContain('现在是早上')
    expect(prompt).toContain('直接输出这一句话')
    // 不再要求「以「早上好，」开头」，标题也不再拼接时段前缀。
    expect(prompt).not.toContain('请以「早上好，」开头')
    expect(prompt).toContain('不要以「早上好 / 下午好 / 晚上好」这类时段称呼开头')
  })

  it('prompt 保持行业中立：不预设使用者是程序员，风格也不含任何行业专属词', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const prompt = String(h.complete.mock.calls[0]?.[0])

    // 面向对象必须是泛指的「人」，不能写死成某个行业。
    expect(prompt).toContain('任何行业')
    expect(prompt).not.toContain('开发者')
    expect(prompt).not.toContain('程序员')
    expect(prompt).not.toContain('工程师')
    expect(prompt).not.toContain('写代码')
    expect(prompt).not.toContain('编程')

    // 风格池同样不能混进行业专属措辞（早期版本有过「给长期写代码的人的打气话」）。
    for (const style of GREETING_STYLES) {
      expect(style).not.toMatch(/代码|编程|程序|工程|IT|办公/)
    }
  })
})

describe('sanitizeGreeting — 文案清洗', () => {
  it('剥掉引号并原样保留正文（不再拼接时段前缀）', () => {
    expect(sanitizeGreeting('“愿你今日灵感如泉”')).toBe('愿你今日灵感如泉')
  })

  it('不再拼接时段前缀：模型给的什么就展示什么', () => {
    // 早期版本会强行拼成「早上好，愿你今日灵感如泉」，导致时间信息重复。
    expect(sanitizeGreeting('愿你今日灵感如泉')).toBe('愿你今日灵感如泉')
    // 模型自己带了时段称呼时也不改动（不增不减）。
    expect(sanitizeGreeting('早上好，愿你今日灵感如泉')).toBe('早上好，愿你今日灵感如泉')
  })

  it('剥掉「问候语：」这类标签前缀', () => {
    expect(sanitizeGreeting('问候语：愿你今日灵感如泉')).toBe('愿你今日灵感如泉')
  })

  it('多行只取首个非空行', () => {
    expect(sanitizeGreeting('\n\n愿你今日灵感如泉\n（解释文字）')).toBe('愿你今日灵感如泉')
  })

  it('超长截断到上限且不留残缺标点', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    const out = sanitizeGreeting(long)
    expect(out.length).toBeLessThanOrEqual(24)
    expect(/[，,。]$/.test(out)).toBe(false)
  })

  it('只有时段称呼没有正文 → 空串（触发失败降级）', () => {
    expect(sanitizeGreeting('早上好，')).toBe('')
    expect(sanitizeGreeting('   ')).toBe('')
  })
})

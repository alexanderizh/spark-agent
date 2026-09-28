/**
 * @module greeting.service.test
 *
 * 单测：空会话问候语的 2 小时缓存、失败冷却、三级模型回退链与文案清洗。
 * 全程不联网：complete() 由 fake 提供。
 */

import { describe, it, expect, vi } from 'vitest'
import {
  GreetingService,
  sanitizeGreeting,
  GREETING_FAILURE_COOLDOWN_MS,
  GREETING_REFRESH_INTERVAL_MS,
  type GreetingCompletion,
  type GreetingModelRef,
  type GreetingServiceDeps,
} from './greeting.service.js'

const HOUR = 9 // 早上：前缀「早上好，」

/** 默认档位：除显式声明 defaultChat: null 的用例（验证全空降级）外，测试都落在这档。 */
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
    defaultChat?: GreetingModelRef | null
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
    getDefaultChatModel: () =>
      opts.defaultChat === undefined ? DEFAULT_CHAT_MODEL : opts.defaultChat,
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
  it('优先使用记忆抽取小模型（不经默认渠道）', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov', extractionModel: 'haiku' },
      defaultChat: { providerId: 'default-prov', model: 'gpt-4o', source: 'default-chat' },
      sessionChat: { providerId: 'sess-prov', model: 'sess-model', source: 'session' },
    })
    const res = await h.service.getGreeting({})
    expect(res).toMatchObject({ ok: true, source: 'model', model: 'haiku' })
    expect(h.complete).toHaveBeenCalledTimes(1)
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({
      providerId: 'mem-prov',
      model: 'haiku',
    })
  })

  it('无抽取模型配置时回退到默认对话模型', async () => {
    const h = makeHarness({
      defaultChat: { providerId: 'default-prov', model: 'gpt-4o-mini', source: 'default-chat' },
      sessionChat: { providerId: 'sess-prov', model: 'sess-model', source: 'session' },
    })
    await h.service.getGreeting({})
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'default-prov' })
  })

  it('默认对话模型也没有时回退到当前会话模型', async () => {
    const h = makeHarness({
      defaultChat: null,
      sessionChat: { providerId: 'sess-prov', model: 'sess-model', source: 'session' },
    })
    await h.service.getGreeting({ sessionId: 'sess-1' })
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'sess-prov' })
  })

  it('三级全空 → ok:false，不调用模型（渲染端回退写死文案）', async () => {
    const h = makeHarness({ defaultChat: null })
    const res = await h.service.getGreeting({})
    expect(res).toEqual({ ok: false, reason: 'no model available' })
    expect(h.complete).not.toHaveBeenCalled()
  })

  it('抽取模型只配了一半（缺 model）不算命中，继续往下回退', async () => {
    const h = makeHarness({
      memory: { extractionProviderId: 'mem-prov' },
      defaultChat: { providerId: 'default-prov', model: 'gpt-4o-mini', source: 'default-chat' },
    })
    await h.service.getGreeting({})
    expect(h.complete.mock.calls[0]?.[1]).toMatchObject({ providerId: 'default-prov' })
  })
})

describe('GreetingService — 缓存与刷新', () => {
  it('2 小时窗口内命中缓存，不再调用模型', async () => {
    const h = makeHarness()
    const first = await h.service.getGreeting({})
    expect(first).toMatchObject({ ok: true, source: 'model' })

    h.advance(GREETING_REFRESH_INTERVAL_MS - 1000)
    const second = await h.service.getGreeting({})
    expect(second).toMatchObject({ ok: true, source: 'cache', text: '早上好，愿你今日灵感如泉' })
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
    expect(h.greetingSettings.emptyHero).toMatchObject({ text: '早上好，愿你今日灵感如泉' })
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

  it('prompt 带当前时段与「{时段}好，」开头约束', async () => {
    const h = makeHarness()
    await h.service.getGreeting({})
    const prompt = String(h.complete.mock.calls[0]?.[0])
    expect(prompt).toContain('早上好，')
    expect(prompt).toContain('直接输出这一句话')
  })
})

describe('sanitizeGreeting — 文案清洗', () => {
  it('剥掉引号并按当前时段补齐前缀', () => {
    expect(sanitizeGreeting('“愿你今日灵感如泉”', HOUR)).toBe('早上好，愿你今日灵感如泉')
  })

  it('模型已自带时段前缀时不重复叠加', () => {
    expect(sanitizeGreeting('早上好，愿你今日灵感如泉', HOUR)).toBe('早上好，愿你今日灵感如泉')
  })

  it('剥掉「问候语：」这类标签前缀', () => {
    expect(sanitizeGreeting('问候语：愿你今日灵感如泉', HOUR)).toBe('早上好，愿你今日灵感如泉')
  })

  it('多行只取首个非空行', () => {
    expect(sanitizeGreeting('\n\n愿你今日灵感如泉\n（解释文字）', HOUR)).toBe(
      '早上好，愿你今日灵感如泉',
    )
  })

  it('超长截断到上限且不留残缺标点', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十'
    const out = sanitizeGreeting(long, HOUR)
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out.startsWith('早上好，')).toBe(true)
    expect(/[，,。]$/.test(out)).toBe(false)
  })

  it('只有前缀没有正文 → 空串（触发失败降级）', () => {
    expect(sanitizeGreeting('早上好，', HOUR)).toBe('')
    expect(sanitizeGreeting('   ', HOUR)).toBe('')
  })

  it('按小时切换时段前缀', () => {
    expect(sanitizeGreeting('愿你今日灵感如泉', 14)).toBe('下午好，愿你今日灵感如泉')
    expect(sanitizeGreeting('愿你今日灵感如泉', 21)).toBe('晚上好，愿你今日灵感如泉')
  })
})

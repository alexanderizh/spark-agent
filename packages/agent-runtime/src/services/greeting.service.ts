/**
 * @module greeting.service
 *
 * 空会话 Hero 问候语生成：按 2 小时窗口缓存，向模型要一句整句问候
 * （古诗词化用 / 鼓励话语 / 优美短句），失败一律降级 —— 由渲染端回退到
 * 本地写死的「{时段}好，继续推进」，绝不阻塞空会话首屏。
 *
 * 协议无关：模型调用统一走注入的 complete()（即 ModelService.complete），
 * 由它按 provider_type 分派两套差异化的调用方式：
 *   - anthropic        → POST /v1/messages，x-api-key/Bearer 双投放 + anthropic-version，system 独立字段
 *   - 其它（openai 兼容）→ POST /chat/completions，Authorization: Bearer，system 作为 messages[0]
 * 本服务不感知协议细节，只负责「选哪个模型、写什么 prompt、怎么清洗、怎么缓存」。
 *
 * 模型档位是**逐个尝试**的（不是选定一个就绑死）：档位由调用方按优先级给出，
 * 前一个失败就换下一个 —— 订阅制「Coding Plan」渠道、失效的 Key、无法访问的
 * 端点都可能让某一档必然失败，逐档降级是「不成功就回退写死文案」之外的第二层兜底。
 */

import type { EmptyHeroGreetingRequest, EmptyHeroGreetingResponse } from '@spark/protocol'
import { createLogger, getLocalTimeGreeting } from '@spark/shared'

const log = createLogger('greeting.service')

/** 缓存落点：app_settings(greeting/emptyHero)，与其它 tweak 同构，零新增表。 */
export const GREETING_SETTINGS_CATEGORY = 'greeting'
export const GREETING_SETTINGS_KEY = 'emptyHero'

/** 缓存保鲜窗口：窗口内直接复用，不再调用模型。 */
export const GREETING_REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000
/**
 * 失败冷却：生成失败后短时间内不再重试，避免空会话每次挂载都打一次
 * 注定失败的请求（无网络 / key 失效时尤其明显）。
 */
export const GREETING_FAILURE_COOLDOWN_MS = 5 * 60 * 1000

/** 文案总长上限（含「{时段}好，」前缀）。 */
export const GREETING_MAX_CHARS = 24
/**
 * 输出 token 预算。思考型模型（GLM 等）的思考 token 计入该预算，给太小会被思考
 * 耗尽、正文返回空 —— 与会话标题生成器同因，取同一个经过验证的量级。
 */
export const GREETING_MAX_OUTPUT_TOKENS = 512
export const GREETING_REQUEST_TIMEOUT_MS = 12_000
/**
 * 最多尝试几个模型档位。档位链可能很长（所有可用对话渠道），逐个试会拉长
 * 空会话的等待并放大成本，故设上限。
 */
export const GREETING_MAX_MODEL_ATTEMPTS = 3
/**
 * 生成型任务需要多样性：ModelService.complete 默认 temperature=0（确定性），
 * 不显式抬高温度会导致每 2 小时产出完全相同的一句话。
 */
export const GREETING_TEMPERATURE = 0.9

/** 模型返回了内容但清洗后不可用（只有前缀 / 纯标点）时的失败原因。 */
const EMPTY_GREETING_REASON = 'empty greeting after sanitize'

/** 模型档位，仅用于日志与排查「这句话是哪个档位产出的」。 */
export type GreetingModelSource = 'extraction' | 'default-chat' | 'session'

export interface GreetingModelRef {
  providerId: string
  model: string
  source: GreetingModelSource
}

export type GreetingCompletionResult =
  | { available: true; text: string }
  | { available: false; reason: string }

/** complete 的形状与 ModelService.complete 兼容（结构化直接传入即可）。 */
export type GreetingCompletion = (
  prompt: string,
  opts: {
    providerId: string
    model: string
    systemPrompt: string
    maxTokens: number
    timeoutMs: number
    temperature: number
  },
) => Promise<GreetingCompletionResult>

export interface GreetingServiceDeps {
  /** 唯一的模型调用入口（ModelService.complete），自带协议分派与失败降级。 */
  complete: GreetingCompletion
  settingsGet: (category: string, key: string) => unknown | null
  settingsSet: (category: string, key: string, value: unknown) => void
  /**
   * 二级档位：可用的对话模型，**按优先级排序**（默认渠道排在最先）。
   * 返回多个是为了「某一档必然失败时还能试下一档」——例如订阅制 Coding Plan
   * 渠道拒绝非编程请求、或某渠道 Key 失效。可异步（渠道服务为 async）。
   */
  getDefaultChatModels: () => GreetingModelRef[] | Promise<GreetingModelRef[]>
  /** 三级档位：当前会话使用的模型（会话级 model_id）。 */
  getSessionChatModel: (sessionId: string | undefined) => GreetingModelRef | null
  /** 便于测试注入时间源。 */
  now?: () => number
}

interface GreetingCacheRecord {
  /** 上一次成功生成的文案。 */
  text?: string
  /** 该文案的生成时刻（epoch ms）。 */
  generatedAt?: number
  /** 产出该文案的模型 id。 */
  model?: string
  /** 最近一次尝试（成功或失败）的时刻（epoch ms）。 */
  attemptAt?: number
  /** 最近一次失败原因；成功时被清空。 */
  lastError?: string
}

const GREETING_SYSTEM_PROMPT =
  '你是 Spark 工作台的问候语撰写者。只输出问候语本身，不要解释、不加引号、不使用表情符号。'

/**
 * 风格轮换：与随机温度叠加，降低连续两次生成撞句的概率。
 * 注意保持**行业中立**——这个产品的使用者来自各行各业，不要出现任何
 * 职业/行业专属措辞（早期版本里有过「给长期写代码的人」这种写法，已移除）。
 */
/** 风格轮换：与随机温度叠加，降低连续两次生成撞句的概率。 */
export const GREETING_STYLES = [
  '化用一句古诗词的意境（不必逐字引用，取其凝练与画面感）',
  '写一句朴素而温暖的鼓励',
  '写一句有画面感的优美短句',
  '写一句贴合此刻时段氛围、让人愿意开始做手头事情的短句',
]

export class GreetingService {
  private readonly now: () => number

  constructor(private readonly deps: GreetingServiceDeps) {
    this.now = deps.now ?? (() => Date.now())
  }

  /**
   * 取空会话问候语。永不抛异常：
   *   - 命中 2 小时缓存 → ok:true + source:'cache'
   *   - 本次生成成功   → ok:true + source:'model'
   *   - 生成失败 / 无可用模型 / 失败冷却中 → ok:false，渲染端回退写死文案
   */
  async getGreeting(input: EmptyHeroGreetingRequest = {}): Promise<EmptyHeroGreetingResponse> {
    const now = this.now()
    const cached = this.readCache()
    const forceRefresh = input.forceRefresh === true

    if (
      !forceRefresh &&
      cached != null &&
      typeof cached.text === 'string' &&
      cached.text.length > 0
    ) {
      const age = now - (cached.generatedAt ?? 0)
      if (age >= 0 && age < GREETING_REFRESH_INTERVAL_MS) {
        return {
          ok: true,
          text: cached.text,
          source: 'cache',
          ...(typeof cached.model === 'string' ? { model: cached.model } : {}),
        }
      }
    }

    // 失败冷却：窗口内不重试，直接让渲染端用写死文案。
    const lastAttemptAt = cached?.attemptAt ?? 0
    if (
      !forceRefresh &&
      cached?.lastError != null &&
      now - lastAttemptAt < GREETING_FAILURE_COOLDOWN_MS
    ) {
      return { ok: false, reason: `cooldown: ${cached.lastError}` }
    }

    const candidates = await this.resolveCandidates(input.sessionId)
    if (candidates.length === 0) {
      // 档位全空属于「用户还没配渠道」，无需冷却重试的语义，记日志即可。
      log.info('问候语跳过：没有任何可用模型档位（记忆抽取模型 / 默认渠道 / 当前会话）')
      return { ok: false, reason: 'no model available' }
    }

    const hour = new Date(now).getHours()
    const prompt = buildGreetingPrompt(hour, now)

    // 逐档尝试：某一档必然失败（订阅制渠道拒绝、Key 失效、端点不可达）时继续下一档。
    let lastReason = 'all model candidates failed'
    for (const [index, candidate] of candidates.entries()) {
      log.info(
        `问候语生成开始（第 ${index + 1}/${candidates.length} 档）：` +
          `source=${candidate.source} provider=${candidate.providerId} model=${candidate.model}`,
      )
      const outcome = await this.attemptGenerate(candidate, prompt)
      if (outcome.ok) {
        this.writeCache({
          text: outcome.text,
          generatedAt: now,
          model: candidate.model,
          attemptAt: now,
        })
        log.info(`问候语生成成功：${outcome.text}（model=${candidate.model}）`)
        return { ok: true, text: outcome.text, source: 'model', model: candidate.model }
      }
      lastReason = outcome.reason
      const hasNext = index + 1 < candidates.length
      log.warn(
        `问候语生成失败（${candidate.source}/${candidate.model}）：${lastReason}` +
          (hasNext ? '，改试下一档' : '，渲染端回退写死文案'),
      )
    }

    this.recordFailure(cached, now, lastReason)
    return { ok: false, reason: lastReason }
  }

  /** 用单个档位生成一次；只负责「调用 + 清洗」，不碰缓存（缓存由调用方按整链结果写）。 */
  private async attemptGenerate(
    candidate: GreetingModelRef,
    prompt: string,
  ): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    try {
      const result = await this.deps.complete(prompt, {
        providerId: candidate.providerId,
        model: candidate.model,
        systemPrompt: GREETING_SYSTEM_PROMPT,
        maxTokens: GREETING_MAX_OUTPUT_TOKENS,
        timeoutMs: GREETING_REQUEST_TIMEOUT_MS,
        temperature: GREETING_TEMPERATURE,
      })
      if (!result.available) return { ok: false, reason: result.reason }
      const text = sanitizeGreeting(result.text)
      if (text.length === 0) return { ok: false, reason: EMPTY_GREETING_REASON }
      return { ok: true, text }
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 模型档位候选，按用户约定的优先级（前一级优先，同级内保持调用方给序）：
   *   1. 记忆抽取小模型（settings memory.extractionProviderId/Model，通常便宜且快）
   *   2. 配置的默认对话模型（默认渠道在前，其后是其它可用对话渠道）
   *   3. 当前会话模型（会话级 model_id）
   * 去重后按上限截断 —— 返回多个而不是一个，是为了让某档必然失败时还能继续降级。
   */
  private async resolveCandidates(sessionId?: string): Promise<GreetingModelRef[]> {
    const list: GreetingModelRef[] = []
    const extraction = this.resolveExtractionModel()
    if (extraction != null) list.push(extraction)
    list.push(...(await this.deps.getDefaultChatModels()))
    const session = this.deps.getSessionChatModel(sessionId)
    if (session != null) list.push(session)

    const seen = new Set<string>()
    return list
      .filter((candidate) => {
        if (candidate.providerId.trim().length === 0 || candidate.model.trim().length === 0)
          return false
        const key = `${candidate.providerId}::${candidate.model}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, GREETING_MAX_MODEL_ATTEMPTS)
  }

  private resolveExtractionModel(): GreetingModelRef | null {
    const providerId = this.deps.settingsGet('memory', 'extractionProviderId')
    const model = this.deps.settingsGet('memory', 'extractionModel')
    if (typeof providerId !== 'string' || providerId.trim().length === 0) return null
    if (typeof model !== 'string' || model.trim().length === 0) return null
    return { providerId: providerId.trim(), model: model.trim(), source: 'extraction' }
  }

  /** 失败时保留旧文案（只写 attemptAt/lastError），冷却期过后可就地重试。 */
  private recordFailure(cached: GreetingCacheRecord | null, now: number, reason: string): void {
    this.writeCache({ ...(cached ?? {}), attemptAt: now, lastError: reason })
  }

  private readCache(): GreetingCacheRecord | null {
    try {
      const raw = this.deps.settingsGet(GREETING_SETTINGS_CATEGORY, GREETING_SETTINGS_KEY)
      if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null
      return raw as GreetingCacheRecord
    } catch (err) {
      log.warn(
        `读取问候语缓存失败（按未缓存处理）：${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  private writeCache(record: GreetingCacheRecord): void {
    try {
      this.deps.settingsSet(GREETING_SETTINGS_CATEGORY, GREETING_SETTINGS_KEY, record)
    } catch (err) {
      // 缓存写失败只影响「下次是否重算」，不影响本次展示，不阻断。
      log.warn(
        `写入问候语缓存失败（本次结果照常返回）：${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

/** 依时段与随机风格拼 prompt；随机性让同温度下的输出也随时间变化。 */
function buildGreetingPrompt(hour: number, nowMs: number): string {
  const greeting = getLocalTimeGreeting(hour)
  const period = greeting.replace(/好$/, '')
  const style =
    GREETING_STYLES[Math.floor(Math.random() * GREETING_STYLES.length)] ?? '写一句朴素而温暖的鼓励'
  return [
    `现在是${period}（当地 ${hour} 点，时间戳 ${nowMs}），仅作氛围参考。`,
    // ⚠️ 行业中立：使用者来自各行各业，不要预设对方是程序员/工程师。
    '请写一句问候语，对象是刚打开 Spark 工作台的人——TA 可能来自任何行业、任何职业、任何年龄段。',
    '要求：',
    '- 一句完整的话，总长 10 到 22 个汉字',
    `- 风格：${style}`,
    // 不再拼接时段前缀（见 sanitizeGreeting）：模型也不该自己加，否则又变回
    // 「早上好，晨光正好」这种重复的时间信息。
    '- 不要以「早上好 / 下午好 / 晚上好」这类时段称呼开头，直接说想说的话',
    '- 人人都能懂，不要出现任何行业、职业或工具专属词',
    '- 温暖、有力量、不油腻、不喊口号',
    '- 不要引号、不要表情符号、不要换行、不要解释、不要任何前后缀',
    '- 直接输出这一句话',
  ].join('\n')
}

const LEADING_NOISE = /^[\s"'“”‘’`【「《（(]+/
const TRAILING_NOISE = /[\s"'“”‘’`】」》）)，,。.!?！?；;、:：…~～\-—]+$/

/** 只有时段称呼、没有正文的结果视为不可用（否则标题会变成光秃秃的「早上好」）。 */
const BARE_PERIOD_GREETINGS = new Set<string>(['早上好', '下午好', '晚上好'])

function stripTrailingNoise(value: string): string {
  return value.replace(TRAILING_NOISE, '')
}

/**
 * 清洗模型输出：取首个非空行、剥引号与「问候语：」这类标签、限长。
 *
 * ⚠️ 不再拼接「{时段}好，」前缀 —— 模型生成的文案原样使用（早期版本会把
 * 「早上好，」强行拼在前面，导致「早上好，晨光正好」这类重复的时间信息）。
 * 写死兜底文案仍带时段问候，两者只在「拿不到模型文案」时区分。
 *
 * 返回空串表示这条结果不可用，调用方据此走失败降级。
 */
export function sanitizeGreeting(raw: string): string {
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''

  const text = stripTrailingNoise(
    firstLine
      .replace(LEADING_NOISE, '')
      .replace(/^(问候语|问候|greeting)[:：\s]*/i, '')
      .trim(),
  )
  if (text.length === 0) return ''
  // 只有一句干巴巴的时段称呼（模型没按指令来）也算不可用，否则标题会变成光秃秃的「早上好」。
  if (BARE_PERIOD_GREETINGS.has(text)) return ''
  if (text.length <= GREETING_MAX_CHARS) return text

  const clipped = stripTrailingNoise(text.slice(0, GREETING_MAX_CHARS))
  return clipped
}

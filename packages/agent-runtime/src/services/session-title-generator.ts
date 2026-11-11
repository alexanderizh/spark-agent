/**
 * @module session-title-generator
 *
 * 异步会话标题生成：基于会话正文摘录，调用 provider API
 * 生成简短中文标题（≤ 16 字符）。失败时返回 null，由调用方决定是否回退。
 */

import {
  buildAnthropicAuthHeaders,
  createLogger,
  fetchJson,
  fetchText,
  HttpError,
  resolveAnthropicMessagesUrl,
} from '@spark/shared'

const log = createLogger('session-title-generator')

const TITLE_MAX_CHARS = 16
const TITLE_PROMPT_USER_MAX_CHARS = 800
const TITLE_PROMPT_ASSISTANT_MAX_CHARS = 800
const REQUEST_TIMEOUT_MS = 15_000
/**
 * 输出 token 预算。思考型模型（如 GLM）的思考 token 计入该预算：
 * 64 会被思考耗尽导致正文为空 → 标题精炼静默失败，因此给足余量。
 * 512 仍不够（生产库观测：思考一长正文即空，且按实际生成计费、上限不增加成本），
 * 与 wiki-extraction-model 的 4096 对齐。
 */
const TITLE_MAX_OUTPUT_TOKENS = 4096

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export interface GenerateTitleParams {
  /** Provider 类型，与 provider_profiles.provider_type 一致（'anthropic' | 'openai' | ...） */
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  /** 渠道声明的 apiEndpoint 是完整请求地址：原样请求，不做自动拼裁。 */
  apiEndpointFullUrl?: boolean | undefined
  model: string
  userMessage: string
  assistantMessage: string
}

export async function generateSessionTitle(params: GenerateTitleParams): Promise<string | null> {
  const user = clip(params.userMessage, TITLE_PROMPT_USER_MAX_CHARS)
  const assistant = clip(params.assistantMessage, TITLE_PROMPT_ASSISTANT_MAX_CHARS)
  if (user.length === 0) return null

  const prompt = buildPrompt(user, assistant)

  try {
    const raw = isAnthropic(params.providerType)
      ? await callAnthropic(params, prompt)
      : await callOpenAICompatible(params, prompt)
    if (raw == null) return null
    const title = sanitizeTitle(raw)
    return title.length === 0 ? null : title
  } catch (err) {
    log.warn(
      `Failed to generate session title: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

function buildPrompt(userMessage: string, assistantMessage: string): string {
  const assistantPart =
    assistantMessage.length > 0 ? `\n\n[Assistant 对话摘录]\n${assistantMessage}` : ''
  return [
    '为下面这段对话生成一个尽量简短、能体现主题的中文标题。',
    '要求：',
    '- 8 到 16 个字符之间',
    '- 不要包含引号、标点、表情符号或前缀（如"标题："）',
    '- 直接输出标题，不要任何解释',
    '',
    `[用户对话摘录]\n${userMessage}${assistantPart}`,
  ].join('\n')
}

async function callAnthropic(params: GenerateTitleParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  // 渠道配置允许填完整 messages 地址，统一归一化后再用，避免 /v1/messages 重复；
  // 渠道声明「完整 URL」时原样请求，不做任何拼裁。
  const url = resolveAnthropicMessagesUrl(endpoint, {
    fullUrl: params.apiEndpointFullUrl === true,
  })
  const body = {
    model: params.model,
    max_tokens: TITLE_MAX_OUTPUT_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  }
  try {
    const data = await fetchJson<{ content?: Array<{ type?: string; text?: string }> }>(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 第三方 Anthropic 兼容渠道只认 x-api-key 或 Bearer 之一，统一双投放。
        ...buildAnthropicAuthHeaders(endpoint, params.apiKey),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    })
    const text = data.content?.find((item) => item.type === 'text')?.text
    if (typeof text !== 'string' || text.length === 0) {
      // 与 OpenAI 兼容路径对称：空正文（思考耗尽预算 / 渠道异常响应）必须留 WARN，
      // 否则失败被静默吞掉、无任何日志可查（2026-09 标题失败排查的观测缺口）。
      log.warn(
        `Anthropic title response had no usable text content (model may have spent the token budget on reasoning): ${describeTarget(url)}`,
      )
      return null
    }
    return text
  } catch (err) {
    if (err instanceof HttpError) {
      log.warn(
        `Anthropic title request failed: HTTP ${err.statusCode} ${describeTarget(url)} ${summarizeErrorDetail(err)}`,
      )
    } else {
      log.warn(
        `Anthropic title request failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return null
  }
}

/**
 * OpenAI 兼容渠道的 token 上限字段。官方对 reasoning 模型（gpt-5 系与 o 系）强制
 * `max_completion_tokens`，传 `max_tokens` 直接 400；中转渠道多数只认 `max_tokens`。
 */
type TitleTokenField = 'max_tokens' | 'max_completion_tokens'

interface TitleRequestContext {
  url: string
  headers: Record<string, string>
  baseBody: {
    model: string
    temperature: number
    messages: Array<{ role: 'user'; content: string }>
  }
}

async function callOpenAICompatible(
  params: GenerateTitleParams,
  prompt: string,
): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  // 渠道声明「完整 URL」时原样请求（用户填的已是最终 chat 地址），否则拼接后缀。
  const url = params.apiEndpointFullUrl === true ? endpoint : `${endpoint}/chat/completions`
  const context: TitleRequestContext = {
    url,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    baseBody: {
      model: params.model,
      temperature: 0.3,
      messages: [{ role: 'user', content: prompt }],
    },
  }

  /**
   * 请求降级阶梯（最多三次，每一步都由服务端 400 的明确提示驱动，不做无依据猜测；
   * 其余 400 —— 模型不存在、鉴权失败等 —— 不重试，直接上交由调用方记 warn）：
   *   ① `max_tokens` + 非流式：兼容面最广的默认组合；
   *   ② `max_completion_tokens`：① 被拒且服务端原文点名该字段时换字段重发；
   *   ③ `stream: true`：中转渠道风控拒绝非流式请求时改 SSE 流式并拼接增量正文
   *      （实测 2026-11-12，api3.codexcn.com：「出于OpenAI风控，非流式请求不再被支持，
   *      请设置 stream: true」）。主对话链路本就恒流式（codex-openai-executor 里
   *      stream:true），只有标题这条非流式旁路会被这类渠道拦死，自动精炼与手动
   *      「提取标题」同时静默失败——两者共用本函数，故一并修复。
   */
  let tokenField: TitleTokenField = 'max_tokens'
  let streaming = false
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await sendTitleRequest(context, tokenField, streaming)
      } catch (err) {
        if (!(err instanceof HttpError) || err.statusCode !== 400) throw err
        if (!streaming && requiresStreamingResponse(err.message)) {
          streaming = true
          log.warn(
            `Title request retrying with stream:true (channel rejects non-streaming requests): ${describeTarget(url)}`,
          )
          continue
        }
        if (tokenField === 'max_tokens' && /max_completion_tokens/i.test(err.message)) {
          tokenField = 'max_completion_tokens'
          log.warn(`Title request retrying with max_completion_tokens: ${describeTarget(url)}`)
          continue
        }
        throw err
      }
    }
    return null
  } catch (err) {
    // 观测口径不可退：HTTP 状态码 + host + 响应体摘要（2026-09 与 2026-11 两次标题
    // 静默失败都靠这一行定位到根因），降级阶梯只是重试策略，不替代终态 warn。
    if (err instanceof HttpError) {
      log.warn(
        `OpenAI-compatible title request failed: HTTP ${err.statusCode} ${describeTarget(url)} ${summarizeErrorDetail(err)}`,
      )
    } else {
      log.warn(
        `OpenAI-compatible title request failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return null
  }
}

/**
 * 发送一次标题补全请求。非流式走 `fetchJson` 直接取 JSON；流式走 `fetchText` 读完整
 * SSE 正文（复用同一套 timeout / 重试 / 错误归一：非 2xx 仍抛 HttpError，且消息体
 * 保留渠道原文，供上层判定降级维度与 warn 排查）。
 */
async function sendTitleRequest(
  context: TitleRequestContext,
  tokenField: TitleTokenField,
  streaming: boolean,
): Promise<string | null> {
  const body = JSON.stringify({
    ...context.baseBody,
    [tokenField]: TITLE_MAX_OUTPUT_TOKENS,
    ...(streaming ? { stream: true } : {}),
  })

  if (!streaming) {
    const data = await fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(
      context.url,
      {
        method: 'POST',
        headers: context.headers,
        body,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxRetries: 1,
      },
    )
    const text = data.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) {
      logMissingContent(context.url)
      return null
    }
    return text
  }

  const raw = await fetchText(context.url, {
    method: 'POST',
    headers: { ...context.headers, accept: 'text/event-stream' },
    body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    maxRetries: 1,
  })
  const text = extractStreamedCompletionContent(raw)
  if (text == null || text.length === 0) {
    log.warn(
      `Streamed title response had no usable content (model may have spent the token budget on reasoning): ${describeTarget(context.url)}`,
    )
    return null
  }
  return text
}

function logMissingContent(url: string): void {
  // 与流式分支对称：空正文（思考耗尽预算 / 渠道异常响应）必须留 WARN，
  // 否则失败被静默吞掉、无任何日志可查（2026-09 标题失败排查的观测缺口）。
  log.warn(
    `Title response had no usable content (model may have spent the token budget on reasoning): ${describeTarget(url)}`,
  )
}

/**
 * 渠道 400 明确要求流式时才升级为 SSE 请求。实测文案（2026-11-12，api3.codexcn.com）：
 * 「出于OpenAI风控，非流式请求不再被支持，请设置 stream: true」。中英文双写，
 * 避免依赖单一渠道的措辞。
 */
function requiresStreamingResponse(errorMessage: string): boolean {
  return /stream\s*:\s*true/i.test(errorMessage) || /非流式|流式请求/.test(errorMessage)
}

/**
 * 从 OpenAI 兼容 SSE 响应中拼接正文增量（标准为 `choices[0].delta.content`）。
 *
 * 容错分支：
 * - 个别网关忽略 `stream` 标志仍回完整 JSON → 先按 JSON 解析，避免误判为空；
 * - 单事件内含完整 `message.content`（网关「伪流式」形态）→ 与 delta 同口径采集；
 * - usage-only 尾包（`choices` 为空数组）与心跳 / 注释行 → 跳过；
 * - 单事件含多行 `data:` 时按 SSE 规范拼接后再 JSON.parse；
 * - `[DONE]` 之后的内容不再采集。
 */
function extractStreamedCompletionContent(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content ?? null
    } catch {
      // 不是合法 JSON：继续按 SSE 逐事件解析
    }
  }

  let content = ''
  for (const event of raw.split(/\r?\n\r?\n/)) {
    const payload = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    if (payload.length === 0 || payload === '[DONE]') continue
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{
          delta?: { content?: string | null }
          message?: { content?: string | null }
        }>
      }
      // 标准流式是 delta.content；个别网关「伪流式」把完整 completion 塞进单个事件的
      // message.content（非流式分支本就兼容该形态），这里一并认，否则取空后标题精炼
      // 失败且只剩一句无正文的 warn。
      const choice = chunk.choices?.[0]
      content += choice?.delta?.content ?? choice?.message?.content ?? ''
    } catch {
      // 心跳 / 注释等非 JSON 行：跳过
    }
  }
  return content.length > 0 ? content : null
}

/**
 * HttpError.message 形如 `HTTP 400: {响应体前 800 字符}`（fetchJson 统一构造），
 * 而此前 WARN 只打状态码 + host，400 的具体原因（鉴权 / 参数 / 模型名）无从查起。
 * 这里取 message 的脱敏摘要（仅截短，不额外打印请求头/凭据），保留排查线索。
 */
function summarizeErrorDetail(err: HttpError): string {
  const detail = err.message.slice(0, 300).replace(/\s+/g, ' ').trim()
  return detail.length > 0 ? `detail=${detail}` : ''
}

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return 'provider'
  }
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  const base = (custom?.trim() || fallback).replace(/\/+$/, '')
  return base
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars)
}

function sanitizeTitle(raw: string): string {
  const firstLine =
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  const stripped = firstLine
    .replace(/^[\s"'“”‘’`【「《]+/, '')
    .replace(/[\s"'“”‘’`】」》。.!?！？]+$/, '')
    .replace(/^标题[:：\s]*/i, '')
    .replace(/^title[:\s]*/i, '')
    .trim()
  if (stripped.length === 0) return ''
  return stripped.length <= TITLE_MAX_CHARS ? stripped : stripped.slice(0, TITLE_MAX_CHARS)
}

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

async function callOpenAICompatible(
  params: GenerateTitleParams,
  prompt: string,
): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  // 渠道声明「完整 URL」时原样请求（用户填的已是最终 chat 地址），否则拼接后缀。
  const url = params.apiEndpointFullUrl === true ? endpoint : `${endpoint}/chat/completions`
  const baseBody = {
    model: params.model,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  }
  // 大多数 OpenAI 兼容网关只认 max_tokens；但 OpenAI 官方对 reasoning 模型
  // （gpt-5*/o 系）强制要求 max_completion_tokens，传 max_tokens 直接 400。
  // 先按兼容面最广的 max_tokens 发，仅在 400 且服务端明确提示时换参重发一次。
  const request = async (tokenField: 'max_tokens' | 'max_completion_tokens') =>
    fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [tokenField]: TITLE_MAX_OUTPUT_TOKENS }),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    })
  try {
    let data: { choices?: Array<{ message?: { content?: string } }> }
    try {
      data = await request('max_tokens')
    } catch (err) {
      if (
        err instanceof HttpError &&
        err.statusCode === 400 &&
        /max_completion_tokens/i.test(err.message)
      ) {
        log.warn(`Title request retrying with max_completion_tokens: ${describeTarget(url)}`)
        data = await request('max_completion_tokens')
      } else {
        throw err
      }
    }
    const text = data.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) {
      log.warn(
        `Title response had no usable content (model may have spent the token budget on reasoning): ${describeTarget(url)}`,
      )
      return null
    }
    return text
  } catch (err) {
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

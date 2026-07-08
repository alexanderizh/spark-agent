/**
 * @module session-title-generator
 *
 * 异步会话标题生成：基于首轮 user/assistant 消息，调用 provider API
 * 生成简短中文标题（≤ 16 字符）。失败时返回 null，由调用方决定是否回退。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('session-title-generator')

const TITLE_MAX_CHARS = 16
const TITLE_PROMPT_USER_MAX_CHARS = 800
const TITLE_PROMPT_ASSISTANT_MAX_CHARS = 800
const REQUEST_TIMEOUT_MS = 15_000

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export interface GenerateTitleParams {
  /** Provider 类型，与 provider_profiles.provider_type 一致（'anthropic' | 'openai' | ...） */
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
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
    log.warn(`Failed to generate session title: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

function buildPrompt(userMessage: string, assistantMessage: string): string {
  const assistantPart = assistantMessage.length > 0
    ? `\n\n[Assistant 回复]\n${assistantMessage}`
    : ''
  return [
    '为下面这段对话生成一个尽量简短、能体现主题的中文标题。',
    '要求：',
    '- 8 到 16 个字符之间',
    '- 不要包含引号、标点、表情符号或前缀（如"标题："）',
    '- 直接输出标题，不要任何解释',
    '',
    `[用户首条消息]\n${userMessage}${assistantPart}`,
  ].join('\n')
}

async function callAnthropic(params: GenerateTitleParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  const url = `${endpoint}/v1/messages`
  const body = {
    model: params.model,
    max_tokens: 64,
    messages: [{ role: 'user', content: prompt }],
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    log.debug(`Anthropic title request failed: HTTP ${res.status}`)
    return null
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content?.find((item) => item.type === 'text')?.text
  return typeof text === 'string' ? text : null
}

async function callOpenAICompatible(params: GenerateTitleParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  const url = `${endpoint}/chat/completions`
  const body = {
    model: params.model,
    max_tokens: 64,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  }
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    log.debug(`OpenAI-compatible title request failed: HTTP ${res.status}`)
    return null
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  return typeof text === 'string' ? text : null
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  const base = (custom?.trim() || fallback).replace(/\/+$/, '')
  return base
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return normalized.slice(0, maxChars)
}

function sanitizeTitle(raw: string): string {
  const firstLine = raw
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

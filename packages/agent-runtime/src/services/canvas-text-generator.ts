/**
 * @module canvas-text-generator
 *
 * 无限画布文本生成：text_generate / text_rewrite / prompt_optimize 的真实文本模型调用。
 * 一次性 completion（非多轮 agent 会话），支持 Anthropic Messages 与 OpenAI-compatible chat。
 * 失败返回 { error }，由调用方决定回退。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('canvas-text-generator')

const REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_MAX_TOKENS = 4096

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export interface GenerateCanvasTextParams {
  /** 'anthropic' | 'openai'（其余按 openai-compatible 处理） */
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  model: string
  /** 系统提示词（角色/约束） */
  system?: string
  /** 用户提示词 / 待处理文本 */
  prompt: string
  maxTokens?: number
  temperature?: number
}

export interface GenerateCanvasTextResult {
  text: string
}

export async function generateCanvasText(
  params: GenerateCanvasTextParams,
): Promise<GenerateCanvasTextResult> {
  const prompt = params.prompt.trim()
  if (prompt.length === 0) throw new Error('prompt is empty')
  const raw = isAnthropic(params.providerType)
    ? await callAnthropic(params, prompt)
    : await callOpenAICompatible(params, prompt)
  const text = (raw ?? '').trim()
  if (text.length === 0) throw new Error('empty completion')
  return { text }
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

async function callAnthropic(params: GenerateCanvasTextParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  const url = `${endpoint}/v1/messages`
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
    ...(params.system ? { system: params.system } : {}),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
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
    const detail = await safeText(res)
    log.warn(`Anthropic text request failed: HTTP ${res.status} ${detail}`)
    throw new Error(`provider HTTP ${res.status}`)
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
  return typeof text === 'string' ? text : null
}

async function callOpenAICompatible(
  params: GenerateCanvasTextParams,
  prompt: string,
): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  const url = `${endpoint}/chat/completions`
  const messages: Array<{ role: string; content: string }> = []
  if (params.system) messages.push({ role: 'system', content: params.system })
  messages.push({ role: 'user', content: prompt })
  const body = {
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: params.temperature ?? 0.7,
    messages,
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
    const detail = await safeText(res)
    log.warn(`OpenAI-compatible text request failed: HTTP ${res.status} ${detail}`)
    throw new Error(`provider HTTP ${res.status}`)
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  return typeof text === 'string' ? text : null
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  return (custom?.trim() || fallback).replace(/\/+$/, '')
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}

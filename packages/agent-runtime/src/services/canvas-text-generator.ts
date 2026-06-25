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

/** 随用户消息一起发送的图片（vision 输入），用于「提取风格」等需要看图的文本任务。 */
export interface CanvasTextImageInput {
  /** 公网可访问的图片 URL（优先） */
  url?: string | undefined
  /** base64 data URL（data:image/...;base64,...），无公网 URL 时使用 */
  dataUrl?: string | undefined
  mimeType?: string | undefined
}

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
  /**
   * 上游图片输入（vision）。非空时随用户消息一并发送，使「请分析输入图片的视觉风格」
   * 之类的提示词真正看到图片。模型需具备多模态能力，否则 provider 会报错。
   */
  images?: CanvasTextImageInput[] | undefined
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

type AnthropicImageBlock = {
  type: 'image'
  source:
    | { type: 'url'; url: string }
    | { type: 'base64'; media_type: string; data: string }
}
type AnthropicContentBlock = { type: 'text'; text: string } | AnthropicImageBlock

/** 把图片输入转成 Anthropic image block；优先公网 URL，其次 base64 dataUrl。 */
function toAnthropicImageBlock(image: CanvasTextImageInput): AnthropicImageBlock | null {
  if (image.url && /^https?:\/\//i.test(image.url)) {
    return { type: 'image', source: { type: 'url', url: image.url } }
  }
  const dataUrl = image.dataUrl ?? (image.url?.startsWith('data:') ? image.url : undefined)
  if (dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
    if (match) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: image.mimeType ?? match[1]!, data: match[2]! },
      }
    }
  }
  return null
}

/** 把图片输入转成 OpenAI image_url；优先公网 URL，其次 base64 dataUrl。 */
function toOpenAiImageUrl(image: CanvasTextImageInput): string | null {
  if (image.url && image.url.length > 0) return image.url
  if (image.dataUrl && image.dataUrl.length > 0) return image.dataUrl
  return null
}

async function callAnthropic(params: GenerateCanvasTextParams, prompt: string): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  const url = `${endpoint}/v1/messages`
  const imageBlocks = (params.images ?? [])
    .map(toAnthropicImageBlock)
    .filter((block): block is AnthropicImageBlock => block !== null)
  // Anthropic 建议图片放在文本之前。无图时退回纯字符串 content。
  const userContent: string | AnthropicContentBlock[] =
    imageBlocks.length > 0 ? [...imageBlocks, { type: 'text', text: prompt }] : prompt
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: userContent }],
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
  type OpenAiContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
  const imageUrls = (params.images ?? [])
    .map(toOpenAiImageUrl)
    .filter((value): value is string => value !== null)
  // 有图时用 OpenAI vision 的 content 数组（文本 + image_url）；无图时退回纯字符串。
  const userContent: string | OpenAiContentPart[] =
    imageUrls.length > 0
      ? [
          { type: 'text', text: prompt },
          ...imageUrls.map((url): OpenAiContentPart => ({ type: 'image_url', image_url: { url } })),
        ]
      : prompt
  const messages: Array<{ role: string; content: string | OpenAiContentPart[] }> = []
  if (params.system) messages.push({ role: 'system', content: params.system })
  messages.push({ role: 'user', content: userContent })
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

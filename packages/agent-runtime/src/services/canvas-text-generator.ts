/**
 * @module canvas-text-generator
 *
 * 无限画布文本生成：text_generate / text_rewrite / prompt_optimize 的真实文本模型调用。
 * 一次性 completion（非多轮 agent 会话），支持 Anthropic Messages 与 OpenAI-compatible chat。
 * 失败返回 { error }，由调用方决定回退。
 */

import { createLogger } from '@spark/shared'
import type { MediaRequestCall } from '@spark/protocol'
import { toOpenAIResponsesReasoningEffort, type SparkReasoningEffort } from '../sdk/reasoning-effort.js'

const log = createLogger('canvas-text-generator')

const REQUEST_TIMEOUT_MS = 120_000
const DEFAULT_MAX_TOKENS = 4096
const ERROR_DETAIL_MAX_LENGTH = 2_000
const REQUEST_TEXT_MAX_LENGTH = 4_000

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export class CanvasTextProviderError extends Error {
  readonly code = 'provider_http_error'
  readonly statusCode: number
  readonly responseBody: string
  readonly requestCall: MediaRequestCall

  constructor(statusCode: number, responseBody: string, requestCall: MediaRequestCall) {
    const suffix = responseBody.trim().length > 0 ? `: ${responseBody.trim()}` : ''
    super(`provider HTTP ${statusCode}${suffix}`)
    this.name = 'CanvasTextProviderError'
    this.statusCode = statusCode
    this.responseBody = responseBody
    this.requestCall = requestCall
  }
}

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
  /** OpenAI-compatible provider 调用方式：chat.completions 或 Responses API。 */
  apiKind?: 'chat' | 'responses' | undefined
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
  reasoningEffort?: SparkReasoningEffort
  disableThinking?: boolean
  responseFormat?: 'json' | 'text'
}

export interface CanvasTextTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export interface GenerateCanvasTextResult {
  text: string
  requestCall?: MediaRequestCall | undefined
  finishReason?: string | undefined
  usage?: CanvasTextTokenUsage | undefined
  reasoningContentChars?: number | undefined
}

export async function generateCanvasText(
  params: GenerateCanvasTextParams,
): Promise<GenerateCanvasTextResult> {
  const prompt = params.prompt.trim()
  if (prompt.length === 0) throw new Error('prompt is empty')
  const result = isAnthropic(params.providerType)
    ? await callAnthropic(params, prompt)
    : await callOpenAICompatible(params, prompt)
  const text = (result.text ?? '').trim()
  if (text.length === 0) throw new Error('empty completion')
  return {
    text,
    requestCall: result.requestCall,
    ...(result.finishReason !== undefined ? { finishReason: result.finishReason } : {}),
    ...(result.usage !== undefined ? { usage: result.usage } : {}),
    ...(result.reasoningContentChars !== undefined
      ? { reasoningContentChars: result.reasoningContentChars }
      : {}),
  }
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

type AnthropicImageBlock = {
  type: 'image'
  source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string }
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

type ProviderCallResult = {
  text: string | null
  requestCall: MediaRequestCall
  finishReason?: string
  usage?: CanvasTextTokenUsage
  reasoningContentChars?: number
}

async function callAnthropic(
  params: GenerateCanvasTextParams,
  prompt: string,
): Promise<ProviderCallResult> {
  const url = getAnthropicMessagesEndpoint(params.apiEndpoint)
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
  const requestCall = buildRequestCall('POST', url, body)
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
    throw new CanvasTextProviderError(res.status, detail, requestCall)
  }
  const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> }
  const text = data.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
  return { text: typeof text === 'string' ? text : null, requestCall }
}

async function callOpenAICompatible(
  params: GenerateCanvasTextParams,
  prompt: string,
): Promise<ProviderCallResult> {
  return params.apiKind === 'responses'
    ? callOpenAIResponses(params, prompt)
    : callOpenAIChatCompletions(params, prompt)
}

async function callOpenAIChatCompletions(
  params: GenerateCanvasTextParams,
  prompt: string,
): Promise<ProviderCallResult> {
  const url = getOpenAiChatCompletionsEndpoint(params.apiEndpoint)
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
    ...(params.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
    ...(shouldSendThinkingToggle(params) && params.disableThinking === true
      ? { thinking: { type: 'disabled' } }
      : {}),
  }
  const requestCall = buildRequestCall('POST', url, body)
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
    throw new CanvasTextProviderError(res.status, detail, requestCall)
  }
  const data = (await res.json()) as {
    choices?: Array<{
      finish_reason?: string
      message?: { content?: string; reasoning_content?: string | null }
    }>
    usage?: {
      prompt_tokens?: number
      completion_tokens?: number
      total_tokens?: number
    }
  }
  const choice = data.choices?.[0]
  const text = choice?.message?.content
  const reasoningContent = choice?.message?.reasoning_content
  return {
    text: typeof text === 'string' ? text : null,
    requestCall,
    ...(typeof choice?.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
    ...(data.usage ? { usage: normalizeTokenUsage(data.usage) } : {}),
    ...(typeof reasoningContent === 'string' && reasoningContent.length > 0
      ? { reasoningContentChars: reasoningContent.length }
      : {}),
  }
}

async function callOpenAIResponses(
  params: GenerateCanvasTextParams,
  prompt: string,
): Promise<ProviderCallResult> {
  const url = getOpenAiResponsesEndpoint(params.apiEndpoint)
  const reasoningEffort = toOpenAIResponsesReasoningEffort(params.reasoningEffort)
  const body: Record<string, unknown> = {
    model: params.model,
    input: buildResponsesInput(prompt, params.images),
    stream: false,
    ...(params.system ? { instructions: params.system } : {}),
    ...(params.maxTokens != null
      ? { max_output_tokens: params.maxTokens }
      : { max_output_tokens: DEFAULT_MAX_TOKENS }),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(reasoningEffort != null ? { reasoning: { effort: reasoningEffort } } : {}),
  }
  const requestCall = buildRequestCall('POST', url, body)
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
    log.warn(`OpenAI Responses text request failed: HTTP ${res.status} ${detail}`)
    throw new CanvasTextProviderError(res.status, detail, requestCall)
  }
  const data = (await res.json()) as {
    output_text?: string
    output?: Array<{
      content?: Array<{
        type?: string
        text?: string
      }>
    }>
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
    }
  }
  return {
    text: extractResponsesText(data),
    requestCall,
    ...(data.usage ? { usage: normalizeResponsesUsage(data.usage) } : {}),
  }
}

function buildResponsesInput(prompt: string, images: CanvasTextImageInput[] | undefined): unknown {
  const imageUrls = (images ?? [])
    .map(toOpenAiImageUrl)
    .filter((value): value is string => value !== null)
  if (imageUrls.length === 0) return prompt
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...imageUrls.map((url) => ({ type: 'input_image', image_url: url })),
      ],
    },
  ]
}

function extractResponsesText(data: {
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}): string | null {
  if (typeof data.output_text === 'string') return data.output_text
  const text = data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text' || item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
  return typeof text === 'string' ? text : null
}

function getAnthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function getOpenAiChatCompletionsEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function getOpenAiResponsesEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions'))
    return `${base.slice(0, -'/chat/completions'.length)}/responses`
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  return (custom?.trim() || fallback).replace(/\/+$/, '')
}

function shouldSendThinkingToggle(params: GenerateCanvasTextParams): boolean {
  const providerType = params.providerType.trim().toLowerCase()
  if (providerType === 'deepseek') return true
  const modelId = params.model.trim().toLowerCase()
  if (modelId.startsWith('deepseek-')) return true
  if (modelId.startsWith('glm-')) return true
  const endpoint = params.apiEndpoint?.trim().toLowerCase() ?? ''
  return endpoint.includes('api.deepseek.com') || endpoint.includes('bigmodel.cn')
}

function buildRequestCall(method: string, url: string, body: unknown): MediaRequestCall {
  return { method, url, body: sanitizeRequestBody(body) }
}

function sanitizeRequestBody(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const [header = 'data:', payload = ''] = value.split(',', 2)
      return `[${header}, ${payload.length} base64 chars]`
    }
    return value.length > REQUEST_TEXT_MAX_LENGTH
      ? `${value.slice(0, REQUEST_TEXT_MAX_LENGTH)}...[truncated ${value.length - REQUEST_TEXT_MAX_LENGTH} chars]`
      : value
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeRequestBody(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeRequestBody(item),
      ]),
    )
  }
  return value
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
    return (await res.text()).slice(0, ERROR_DETAIL_MAX_LENGTH)
  } catch {
    return ''
  }
}

function normalizeTokenUsage(usage: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}): CanvasTextTokenUsage {
  return {
    ...(typeof usage.prompt_tokens === 'number' ? { promptTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === 'number' ? { completionTokens: usage.completion_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
  }
}

function normalizeResponsesUsage(usage: {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}): CanvasTextTokenUsage {
  return {
    ...(typeof usage.input_tokens === 'number' ? { promptTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === 'number' ? { completionTokens: usage.output_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
  }
}

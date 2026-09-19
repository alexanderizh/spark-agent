/**
 * @module canvas-text-generator
 *
 * 无限画布文本生成：text_generate / text_rewrite / prompt_optimize 的真实文本模型调用。
 * 一次性 completion（非多轮 agent 会话），支持 Anthropic Messages 与 OpenAI-compatible chat。
 * 失败返回 { error }，由调用方决定回退。
 */

import { createLogger } from '@spark/shared'
import type { MediaRequestCall } from '@spark/protocol'
import {
  toOpenAIResponsesReasoningEffort,
  type SparkReasoningEffort,
} from '../sdk/reasoning-effort.js'

const log = createLogger('canvas-text-generator')

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000
const MIN_CONFIGURED_REQUEST_TIMEOUT_MS = 10_000
const MAX_CONFIGURED_REQUEST_TIMEOUT_MS = 30 * 60_000
const DEFAULT_MAX_TOKENS = 16_384
const ERROR_DETAIL_MAX_LENGTH = 2_000
// Keep normal long-form screenplay/storyboard requests intact in diagnostics. Only
// pathological payloads are bounded; base64/data URLs are still summarized separately.
const REQUEST_TEXT_MAX_LENGTH = 100_000

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

export class CanvasTextTimeoutError extends Error {
  readonly code = 'request_timeout'
  readonly timeoutMs: number
  readonly requestCall?: MediaRequestCall | undefined

  constructor(timeoutMs: number, requestCall?: MediaRequestCall) {
    const timeoutSeconds = Math.ceil(timeoutMs / 1000)
    super(
      `画布文本请求超时（超过 ${timeoutSeconds} 秒）。模型或代理未在时限内完成响应，请降低最大输出长度、减少输入内容，或检查代理性能后重试。`,
    )
    this.name = 'CanvasTextTimeoutError'
    this.timeoutMs = timeoutMs
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
   * 跨请求稳定的前缀文本（如目标/成功标准）。仅在 promptCache 为 true 时生效：
   * Anthropic 通道拆成独立 text block 并打 cache_control；OpenAI 兼容通道拆成
   * 独立 user 消息，保证前缀逐字节相同以命中自动前缀缓存。
   */
  stablePrompt?: string | undefined
  /**
   * 对同一任务内跨步复用的稳定内容启用 provider 侧 prompt caching
   * （Anthropic cache_control / OpenAI 自动前缀缓存）。缺省关闭，不影响既有调用方。
   */
  promptCache?: boolean | undefined
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
  /** 单次 HTTP 请求超时；缺省读取 SPARK_CANVAS_TEXT_TIMEOUT_MS，默认 10 分钟。 */
  timeoutMs?: number
}

export interface CanvasTextTokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  /** 缓存命中的输入 token（Anthropic cache_read_input_tokens / OpenAI cached_tokens）。 */
  cachedPromptTokens?: number
  /** 本次写入缓存的输入 token（Anthropic cache_creation_input_tokens，仅首次请求产生）。 */
  cacheWriteTokens?: number
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
  // promptCache 关闭或 stablePrompt 为空时归一化为 undefined，保证关闭路径与旧行为一致。
  const effective: GenerateCanvasTextParams =
    params.promptCache === true &&
    typeof params.stablePrompt === 'string' &&
    params.stablePrompt.trim().length > 0
      ? params
      : { ...params, stablePrompt: undefined }
  const result = isAnthropic(params.providerType)
    ? await callAnthropic(effective, prompt)
    : await callOpenAICompatible(effective, prompt)
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

export function resolveCanvasTextRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number.parseInt(env.SPARK_CANVAS_TEXT_TIMEOUT_MS ?? '', 10)
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_REQUEST_TIMEOUT_MS
  return Math.min(
    MAX_CONFIGURED_REQUEST_TIMEOUT_MS,
    Math.max(MIN_CONFIGURED_REQUEST_TIMEOUT_MS, configured),
  )
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

type AnthropicImageBlock = {
  type: 'image'
  source: { type: 'url'; url: string } | { type: 'base64'; media_type: string; data: string }
}
type AnthropicTextBlock = {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock

/** Anthropic 默认 5 分钟 ephemeral 缓存标记；computer use 步进间隔远小于 TTL，命中率高。 */
const ANTHROPIC_CACHE_CONTROL = { type: 'ephemeral' } as const
/** 严格校验请求体的第三方 Anthropic 兼容网关可能拒绝 cache_control 字段时的降级状态码。 */
const ANTHROPIC_CACHE_DEGRADE_STATUSES = new Set([400, 404, 422])

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
  const cacheEnabled = params.promptCache === true
  const buildBody = (withCache: boolean): Record<string, unknown> => {
    // 缓存开启时 system 用 block 数组并打 cache_control：系统提示词跨任务稳定，命中率最高。
    const system: string | AnthropicTextBlock[] =
      withCache && params.system
        ? [{ type: 'text', text: params.system, cache_control: ANTHROPIC_CACHE_CONTROL }]
        : (params.system ?? '')
    // 稳定前缀（目标/成功标准）必须排在每步变化的截图与观测文本之前，才能作为缓存前缀；
    // 因此缓存模式下图片排在稳定文本之后（放弃旧的“图片在前”建议以换取前缀缓存命中）。
    const userContent: string | AnthropicContentBlock[] =
      withCache && params.stablePrompt
        ? [
            { type: 'text', text: params.stablePrompt, cache_control: ANTHROPIC_CACHE_CONTROL },
            ...imageBlocks,
            { type: 'text', text: prompt },
          ]
        : imageBlocks.length > 0
          ? [...imageBlocks, { type: 'text', text: prompt }]
          : prompt
    return {
      model: params.model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [{ role: 'user', content: userContent }],
      ...(params.system ? { system } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
    }
  }
  const requestCall = buildRequestCall('POST', url, buildBody(cacheEnabled))
  const sendOnce = (body: Record<string, unknown>): Promise<Response> =>
    fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': params.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      },
      params.timeoutMs,
      requestCall,
    )
  let res = await sendOnce(buildBody(cacheEnabled))
  if (cacheEnabled && ANTHROPIC_CACHE_DEGRADE_STATUSES.has(res.status)) {
    // 网关不认 cache_control 时降级为无缓存标记重发一次，避免缓存优化阻断整条链路。
    const rejectedDetail = await safeText(res)
    log.warn(
      `Anthropic prompt-cache request rejected (HTTP ${res.status}); retrying without cache_control: ${rejectedDetail}`,
    )
    const fallbackBody = buildBody(false)
    requestCall.body = sanitizeRequestBody(fallbackBody)
    res = await sendOnce(fallbackBody)
  }
  attachResponseMetadata(requestCall, res)
  if (!res.ok) {
    const detail = await safeText(res)
    attachErrorResponseBody(requestCall, detail)
    log.warn(`Anthropic text request failed: HTTP ${res.status} ${detail}`)
    throw new CanvasTextProviderError(res.status, detail, requestCall)
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>
    stop_reason?: string | null
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
  const text = data.content
    ?.filter((item) => item.type === 'text')
    .map((item) => item.text ?? '')
    .join('')
  const normalizedText = typeof text === 'string' ? text : null
  const usage = data.usage ? normalizeAnthropicUsage(data.usage) : undefined
  log.info(
    [
      'event=response',
      'provider=anthropic',
      `model=${JSON.stringify(params.model)}`,
      `maxTokens=${params.maxTokens ?? '(provider-default)'}`,
      `textChars=${normalizedText?.length ?? 0}`,
      `stopReason=${JSON.stringify(data.stop_reason ?? '(n/a)')}`,
      usage?.promptTokens != null ? `promptTokens=${usage.promptTokens}` : null,
      usage?.completionTokens != null ? `completionTokens=${usage.completionTokens}` : null,
      usage?.totalTokens != null ? `totalTokens=${usage.totalTokens}` : null,
      usage?.cachedPromptTokens != null ? `cachedPromptTokens=${usage.cachedPromptTokens}` : null,
      usage?.cacheWriteTokens != null ? `cacheWriteTokens=${usage.cacheWriteTokens}` : null,
    ]
      .filter((part): part is string => part != null)
      .join(' '),
  )
  return {
    text: normalizedText,
    requestCall,
    ...(typeof data.stop_reason === 'string' ? { finishReason: data.stop_reason } : {}),
    ...(usage ? { usage } : {}),
  }
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
  // 稳定前缀独立成消息且排在变化内容之前：跨步逐字节相同的前缀命中 provider 自动前缀缓存
  // （DeepSeek/Qwen/Kimi 等对 ≥1024 token 前缀自动生效，无需显式标记）。
  if (params.stablePrompt) messages.push({ role: 'user', content: params.stablePrompt })
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
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    params.timeoutMs,
    requestCall,
  )
  attachResponseMetadata(requestCall, res)
  if (!res.ok) {
    const detail = await safeText(res)
    attachErrorResponseBody(requestCall, detail)
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
      prompt_tokens_details?: { cached_tokens?: number }
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
    input: buildResponsesInput(prompt, params.images, params.stablePrompt),
    stream: false,
    ...(params.system ? { instructions: params.system } : {}),
    ...(params.maxTokens != null
      ? { max_output_tokens: params.maxTokens }
      : { max_output_tokens: DEFAULT_MAX_TOKENS }),
    ...(params.temperature != null ? { temperature: params.temperature } : {}),
    ...(reasoningEffort != null ? { reasoning: { effort: reasoningEffort } } : {}),
  }
  const requestCall = buildRequestCall('POST', url, body)
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
    },
    params.timeoutMs,
    requestCall,
  )
  attachResponseMetadata(requestCall, res)
  if (!res.ok) {
    const detail = await safeText(res)
    attachErrorResponseBody(requestCall, detail)
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
      input_tokens_details?: { cached_tokens?: number }
    }
  }
  return {
    text: extractResponsesText(data),
    requestCall,
    ...(data.usage ? { usage: normalizeResponsesUsage(data.usage) } : {}),
  }
}

function buildResponsesInput(
  prompt: string,
  images: CanvasTextImageInput[] | undefined,
  stablePrompt: string | undefined,
): unknown {
  const imageUrls = (images ?? [])
    .map(toOpenAiImageUrl)
    .filter((value): value is string => value !== null)
  const variableItems: Array<{ role: string; content: unknown }> = []
  if (imageUrls.length > 0) {
    variableItems.push({
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...imageUrls.map((url) => ({ type: 'input_image', image_url: url })),
      ],
    })
  }
  // 无稳定前缀时保持旧行为：无图为纯字符串，有图为单条 user 输入。
  if (!stablePrompt) return imageUrls.length > 0 ? variableItems : prompt
  // 稳定前缀独立成首条 user 输入，保证跨步前缀相同以命中 Responses API 自动缓存。
  return [{ role: 'user', content: stablePrompt }, ...variableItems]
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
  if (endsWithVersionSegment(base)) return `${base}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function getOpenAiResponsesEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions'))
    return `${base.slice(0, -'/chat/completions'.length)}/responses`
  if (endsWithVersionSegment(base)) return `${base}/responses`
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

/** 与 provider.service.ts 的同名判定对齐：末段已是 /vN 的端点直接补后缀，不再追加 /v1。 */
function endsWithVersionSegment(value: string): boolean {
  const last = value.split('/').pop() ?? ''
  return /^v\d+$/iu.test(last)
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
  return {
    method,
    url,
    headers: {
      'content-type': 'application/json',
      authorization: '[redacted]',
    },
    body: sanitizeRequestBody(body),
  }
}

function attachResponseMetadata(requestCall: MediaRequestCall, response: Response): void {
  const headers: Record<string, string> = {}
  for (const name of ['content-type', 'request-id', 'x-request-id']) {
    const value = response.headers.get(name)
    if (value) headers[name] = value
  }
  requestCall.response = {
    status: response.status,
    ...(response.statusText ? { statusText: response.statusText } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

function attachErrorResponseBody(requestCall: MediaRequestCall, detail: string): void {
  if (!requestCall.response || !detail) return
  let body: unknown = detail
  try {
    body = JSON.parse(detail)
  } catch {
    // Keep the bounded text returned by safeText.
  }
  requestCall.response.body = sanitizeRequestBody(body)
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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  requestedTimeoutMs: number | undefined,
  requestCall: MediaRequestCall,
): Promise<Response> {
  const timeoutMs =
    typeof requestedTimeoutMs === 'number' &&
    Number.isFinite(requestedTimeoutMs) &&
    requestedTimeoutMs > 0
      ? Math.floor(requestedTimeoutMs)
      : resolveCanvasTextRequestTimeoutMs()
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (timedOut) throw new CanvasTextTimeoutError(timeoutMs, requestCall)
    throw err
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
  prompt_tokens_details?: { cached_tokens?: number }
}): CanvasTextTokenUsage {
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens
  return {
    ...(typeof usage.prompt_tokens === 'number' ? { promptTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === 'number'
      ? { completionTokens: usage.completion_tokens }
      : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
    ...(typeof cachedTokens === 'number' ? { cachedPromptTokens: cachedTokens } : {}),
  }
}

function normalizeAnthropicUsage(usage: {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}): CanvasTextTokenUsage {
  return {
    ...(typeof usage.input_tokens === 'number' ? { promptTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === 'number' ? { completionTokens: usage.output_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
    ...(typeof usage.cache_read_input_tokens === 'number'
      ? { cachedPromptTokens: usage.cache_read_input_tokens }
      : {}),
    ...(typeof usage.cache_creation_input_tokens === 'number'
      ? { cacheWriteTokens: usage.cache_creation_input_tokens }
      : {}),
  }
}

function normalizeResponsesUsage(usage: {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: { cached_tokens?: number }
}): CanvasTextTokenUsage {
  const cachedTokens = usage.input_tokens_details?.cached_tokens
  return {
    ...(typeof usage.input_tokens === 'number' ? { promptTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === 'number' ? { completionTokens: usage.output_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
    ...(typeof cachedTokens === 'number' ? { cachedPromptTokens: cachedTokens } : {}),
  }
}

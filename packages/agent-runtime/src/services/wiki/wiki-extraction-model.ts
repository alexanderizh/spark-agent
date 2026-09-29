/**
 * @module wiki-extraction-model
 *
 * 抽取模型调用（S2）—— 用便宜档小模型把对话片段归纳成结构化知识候选。
 *
 * 设计约束（方案 §9）：
 *   - **绝不在主对话链路上同步抽取**：本模块只被抽取管道（用户显式沉淀 /
 *     里程碑 / idle / 定时批处理）调用，Agent 主循环不会触达。
 *   - 与主对话模型分离：渠道由 `extract/modelProfile` 或会话自身渠道解析而来
 *     （`resolveSessionTitleTarget` 同款链路，含智能路由回退）。
 *   - 输出走「prompt 约束 + 本地严格解析」：不依赖服务端 JSON mode（兼容网关
 *     普遍不支持），解析失败一律作废，绝不猜内容。
 *   - 端点与凭据归一化复用 `@spark/shared`（anthropic 三种合法写法 / 第三方
 *     双头投放），不另写一套判断。
 */

import {
  buildAnthropicAuthHeaders,
  createLogger,
  fetchJson,
  HttpError,
  resolveAnthropicMessagesUrl,
} from '@spark/shared'

const log = createLogger('wiki:extraction-model')

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

const REQUEST_TIMEOUT_MS = 60_000
/** 抽取输出预算：候选 JSON 可能较长，给足余量避免思考 token 吃光正文。 */
const MAX_OUTPUT_TOKENS = 4096

export interface WikiExtractionModelParams {
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  /** 渠道声明的 apiEndpoint 是完整请求地址：原样请求，不做自动拼裁 */
  apiEndpointFullUrl?: boolean | undefined
  model: string
  /** system 提示词（角色与输出契约） */
  system: string
  /** user 提示词（采样片段） */
  prompt: string
}

/** 模型原始文本输出；失败返回 null（调用方决定降级，不抛到主链路） */
export async function callWikiExtractionModel(
  params: WikiExtractionModelParams,
): Promise<string | null> {
  const target = isAnthropic(params.providerType) ? 'anthropic' : 'openai-compatible'
  try {
    return isAnthropic(params.providerType)
      ? await callAnthropic(params)
      : await callOpenAICompatible(params)
  } catch (err) {
    if (err instanceof HttpError) {
      log.warn(
        `extraction request failed (${target}): HTTP ${err.statusCode} ${normalizeEndpoint(params.apiEndpoint, isAnthropic(params.providerType) ? ANTHROPIC_DEFAULT_ENDPOINT : OPENAI_DEFAULT_ENDPOINT)}`,
      )
    } else {
      log.warn(
        `extraction request failed (${target}): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return null
  }
}

function isAnthropic(providerType: string): boolean {
  return providerType.toLowerCase() === 'anthropic'
}

function describeTarget(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return 'provider'
  }
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  return (custom?.trim() || fallback).replace(/\/+$/, '')
}

async function callAnthropic(params: WikiExtractionModelParams): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  const url = resolveAnthropicMessagesUrl(endpoint, {
    fullUrl: params.apiEndpointFullUrl === true,
  })
  const body = {
    model: params.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  }
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
  return typeof text === 'string' && text.length > 0 ? text : null
}

async function callOpenAICompatible(params: WikiExtractionModelParams): Promise<string | null> {
  const endpoint = normalizeEndpoint(params.apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  const url = params.apiEndpointFullUrl === true ? endpoint : `${endpoint}/chat/completions`
  const baseBody = {
    model: params.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: params.system },
      { role: 'user', content: params.prompt },
    ],
  }
  // 兼容面优先：先按 max_tokens 发，仅在 400 且服务端明确要求时换
  // max_completion_tokens 重发一次（OpenAI 官方 reasoning 模型的硬要求）。
  const request = async (tokenField: 'max_tokens' | 'max_completion_tokens') =>
    fetchJson<{ choices?: Array<{ message?: { content?: string } }> }>(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({ ...baseBody, [tokenField]: MAX_OUTPUT_TOKENS }),
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    })

  let data: { choices?: Array<{ message?: { content?: string } }> }
  try {
    data = await request('max_tokens')
  } catch (err) {
    if (
      err instanceof HttpError &&
      err.statusCode === 400 &&
      /max_completion_tokens/i.test(err.message)
    ) {
      log.warn('extraction retrying with max_completion_tokens')
      data = await request('max_completion_tokens')
    } else {
      throw err
    }
  }
  const text = data.choices?.[0]?.message?.content
  return typeof text === 'string' && text.length > 0 ? text : null
}

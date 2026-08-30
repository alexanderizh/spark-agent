import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { CustomToolRecord, ProviderVisionToolSpec } from '@spark/protocol'
import { ProviderProfileRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { clipTextHeadTail } from '@spark/shared'
import { resolveProviderApiKey } from '../provider-credential-resolver.js'
import { validateToolInput } from './custom-tool-input-validator.js'
import { CustomToolError } from './custom-tool-errors.js'
import type { ExecutorContext, ExecutorResult } from './custom-tool-executor.js'

type ProviderVisionRecord = Extract<CustomToolRecord, { type: 'provider-vision' }>

interface ProviderVisionExecutorContext extends ExecutorContext {
  database: SparkDatabase
}

interface ProviderVisionConfig {
  apiEndpoint?: string
  defaultModel?: string
  modelIds?: string[]
  modelType?: string
  codexApiKind?: 'chat' | 'responses'
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_PROVIDER_RESPONSE_BYTES = 1_048_576

function chatCompletionsEndpoint(apiEndpoint: string): string {
  const base = apiEndpoint.trim().replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (/\/v\d+$/i.test(base)) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

async function imagePathToDataUrl(filePath: string): Promise<{ dataUrl: string; bytes: number }> {
  if (!path.isAbsolute(filePath)) {
    throw new CustomToolError('INVALID_INPUT', '图像理解工具只接受本轮附件的绝对路径')
  }
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()]
  if (mime == null) {
    throw new CustomToolError(
      'INVALID_INPUT',
      `不支持的图片格式：${path.extname(filePath) || '未知'}`,
    )
  }
  let data: Buffer
  try {
    data = await readFile(filePath)
  } catch {
    throw new CustomToolError('INVALID_INPUT', `无法读取图片附件：${path.basename(filePath)}`)
  }
  if (data.byteLength === 0 || data.byteLength > MAX_IMAGE_BYTES) {
    throw new CustomToolError(
      'INVALID_INPUT',
      `图片 ${path.basename(filePath)} 大小必须在 1 字节到 20MB 之间`,
    )
  }
  return { dataUrl: `data:${mime};base64,${data.toString('base64')}`, bytes: data.byteLength }
}

function extractAssistantText(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const message = choices[0]
  if (message == null || typeof message !== 'object') return ''
  const content = (message as { message?: { content?: unknown } }).message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      part != null &&
      typeof part === 'object' &&
      typeof (part as { text?: unknown }).text === 'string'
        ? (part as { text: string }).text
        : '',
    )
    .filter(Boolean)
    .join('\n')
    .trim()
}

function resolveVisionModel(spec: ProviderVisionToolSpec, config: ProviderVisionConfig): string {
  const model = spec.model?.trim() || config.defaultModel?.trim() || ''
  if (!model) throw new CustomToolError('INVALID_INPUT', '图像理解 Provider 未配置默认模型')
  if (spec.model != null && Array.isArray(config.modelIds) && !config.modelIds.includes(model)) {
    throw new CustomToolError('INVALID_INPUT', `模型 ${model} 不在所选 Provider 的模型列表中`)
  }
  return model
}

async function readProviderResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader == null) return response.text()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value == null) continue
      total += value.byteLength
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel('provider response size limit reached')
        throw new CustomToolError('EXECUTION_FAILED', '图像理解 Provider 响应超过 1MB 上限')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

export async function executeProviderVisionTool(
  record: ProviderVisionRecord,
  input: Record<string, unknown>,
  ctx: ProviderVisionExecutorContext,
): Promise<ExecutorResult> {
  const validated = validateToolInput(record.inputSchema, input)
  const imagePaths = validated.images
  if (!Array.isArray(imagePaths) || imagePaths.length === 0) {
    throw new CustomToolError('INVALID_INPUT', '至少需要一张图片')
  }
  if (imagePaths.length > record.spec.maxImages) {
    throw new CustomToolError('INVALID_INPUT', `最多允许 ${record.spec.maxImages} 张图片`)
  }
  const question =
    typeof validated.question === 'string' && validated.question.trim().length > 0
      ? validated.question.trim()
      : '请完整描述图片内容，并回答用户与图片有关的问题。'

  const provider = new ProviderProfileRepository(ctx.database).get(record.spec.providerProfileId)
  if (provider == null) throw new CustomToolError('NOT_FOUND', '图像理解 Provider 不存在')
  if (provider.enabled !== 1) throw new CustomToolError('DENIED', '图像理解 Provider 已停用')
  const config = JSON.parse(provider.config_json) as ProviderVisionConfig
  if (config.modelType !== 'multimodal') {
    throw new CustomToolError('INVALID_INPUT', '所选 Provider 未声明图像输入能力')
  }
  if (config.codexApiKind === 'responses') {
    throw new CustomToolError(
      'NOT_IMPLEMENTED',
      '首版图像理解工具仅支持 OpenAI Chat Completions 兼容渠道',
    )
  }
  if (!config.apiEndpoint?.trim()) {
    throw new CustomToolError('INVALID_INPUT', '图像理解 Provider 未配置 API 地址')
  }
  const endpoint = chatCompletionsEndpoint(config.apiEndpoint)
  let targetOrigin: string
  try {
    targetOrigin = new URL(endpoint).origin
  } catch {
    throw new CustomToolError('INVALID_INPUT', '图像理解 Provider API 地址无效')
  }
  const apiKey = await resolveProviderApiKey(provider)
  if (!apiKey) throw new CustomToolError('SECRET_MISSING', '图像理解 Provider 缺少可用凭据')
  const model = resolveVisionModel(record.spec, config)

  const images: string[] = []
  let totalBytes = 0
  for (const imagePath of imagePaths) {
    if (typeof imagePath !== 'string')
      throw new CustomToolError('INVALID_INPUT', 'images 必须是路径数组')
    const image = await imagePathToDataUrl(imagePath)
    totalBytes += image.bytes
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new CustomToolError('INVALID_INPUT', '本次图片总大小不能超过 50MB')
    }
    images.push(image.dataUrl)
  }

  const startedAt = Date.now()
  let response: Response
  let responseText: string
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: record.spec.instructions },
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          },
        ],
        max_tokens: record.spec.maxTokens,
        ...(record.spec.temperature != null ? { temperature: record.spec.temperature } : {}),
      }),
      signal: ctx.signal,
    })
    responseText = await readProviderResponse(response)
  } catch (error) {
    if (error instanceof CustomToolError) throw error
    if (ctx.signal.aborted) throw new CustomToolError('TIMEOUT', '图像理解请求已超时或取消')
    throw new CustomToolError(
      'UNREACHABLE',
      `无法连接图像理解 Provider：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new CustomToolError(
      'HTTP_ERROR',
      `图像理解 Provider 返回 HTTP ${response.status}：${responseText.slice(0, 300)}`,
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(responseText)
  } catch {
    throw new CustomToolError('EXECUTION_FAILED', '图像理解 Provider 返回了无法解析的 JSON')
  }
  const text = extractAssistantText(payload)
  if (!text) throw new CustomToolError('EXECUTION_FAILED', '图像理解 Provider 未返回文本结果')
  const clipped = clipTextHeadTail(text, record.spec.maxTokens)
  return {
    text: clipped,
    meta: {
      durationMs: Date.now() - startedAt,
      bytes: Buffer.byteLength(text, 'utf8'),
      truncated: clipped !== text,
      targetOrigin,
      model,
    },
  }
}

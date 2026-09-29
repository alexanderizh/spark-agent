/**
 * 智谱音频渠道的公共 HTTP 能力（音色目录 / 音色复刻 / 音色删除共用）。
 *
 * 三类调用共享同一组前置约束：端点归一（标准 Base URL vs「完整 URL」渠道）、
 * Bearer 鉴权、超时与错误映射。集中在这里，避免各调用点各写一份后漂移。
 *
 * 接口事实核对自官方 OpenAPI（https://docs.bigmodel.cn/openapi/openapi.json）：
 *   - `GET  /paas/v4/voice/list`   音色列表
 *   - `POST /paas/v4/voice/clone`  音色复刻
 *   - `POST /paas/v4/voice/delete` 删除音色
 *   - `POST /paas/v4/files`        上传示例音频（purpose=voice-clone-input）
 *
 * 官方错误体统一为 `{ error: { code, message } }`。
 */

import { createLogger, describeNetworkError } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'

const log = createLogger('zhipu:voice-api')

const REQUEST_TIMEOUT_MS = 20_000

export interface ZhipuVoiceApiTarget {
  /** 渠道 API Base URL，通常为 `https://open.bigmodel.cn/api/paas/v4`。 */
  apiEndpoint: string
  apiKey: string
  /**
   * 渠道按「完整 URL」配置时，地址指向单个业务端点（如 /audio/speech），
   * 无法推导音色子端点；此时抛出可读错误而不是猜测拼接。
   */
  apiEndpointFullUrl?: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** 归一 Base URL（去尾斜杠）；「完整 URL」渠道直接拒绝，不做路径猜测。 */
export function resolveZhipuApiBase(target: ZhipuVoiceApiTarget, action: string): string {
  if (target.apiEndpointFullUrl === true) {
    log.warn(`refused 完整 URL channel, action=${action}`)
    throw new MediaProviderError(
      'invalid_input',
      `该渠道配置为「完整 URL」模式，无法推导${action}地址；请改用标准 API Base URL 后再操作`,
    )
  }
  const base = target.apiEndpoint.trim().replace(/\/+$/, '')
  if (!base) {
    throw new MediaProviderError('provider_not_configured', `渠道未配置 API 地址，无法${action}`)
  }
  return base
}

/** 提取智谱标准错误体 `{ error: { code, message } }` 的可读摘要。 */
export function zhipuErrorDetail(payload: unknown): string {
  if (payload == null || typeof payload !== 'object') return ''
  const error = (payload as { error?: unknown }).error
  if (error == null || typeof error !== 'object') return ''
  const record = error as { code?: unknown; message?: unknown }
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  return [code, message].filter(Boolean).join(' ')
}

async function readErrorDetail(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '')
  if (!raw) return ''
  try {
    return (zhipuErrorDetail(JSON.parse(raw)) || raw).slice(0, 200)
  } catch {
    // 非 JSON 错误体（网关 HTML 等）：直接回原文，便于用户看到真实原因。
    return raw.slice(0, 200)
  }
}

/**
 * 把 fetch 的传输层失败归一成 `MediaProviderError`。
 *
 * 这类失败不会经过非 2xx 分支（根本没有响应），若不在这里归一，
 * `AbortSignal.timeout` 抛出的 `DOMException: The operation was aborted due to timeout`
 * 与 Node fetch 的 `TypeError: fetch failed` 会原样冒到渠道页，对用户毫无信息量。
 * 网络原因复用 shared 的 `describeNetworkError`，与「测试连接」保持同一套措辞。
 */
function toZhipuTransportError(
  error: unknown,
  action: string,
  method: string,
  url: string,
  timeoutMs: number,
): MediaProviderError {
  // 已归一过的错误不重复包装。跨打包/模块实例时 instanceof 不可靠，
  // 按项目既有约定用 name 收窄。
  if (error instanceof Error && error.name === 'MediaProviderError') {
    return error as MediaProviderError
  }
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'TimeoutError' || /aborted due to timeout|timed out/i.test(message)) {
    const seconds = Math.ceil(timeoutMs / 1000)
    log.warn(`zhipu voice request timed out, action=${action}, timeoutMs=${timeoutMs}`)
    return new MediaProviderError(
      'task_timeout',
      `${action}超时（>${seconds}s），请检查网络、代理或接口地址后重试`,
    )
  }
  const detail = describeNetworkError(error, method, url) ?? message
  log.warn(`zhipu voice request transport failed, action=${action}, detail=${detail}`)
  return new MediaProviderError('provider_http_error', `${action}失败：${detail}`)
}

/**
 * 带 Bearer 鉴权与超时的请求；非 2xx 抛 `MediaProviderError`。
 *
 * 消息里保留厂商原文（`HTTP 400 · 1210 参数错误`），与 manifest 的
 * `error.codePaths/messagePaths` 口径一致；不做错误码映射，因为官方没有可核对的
 * 完整码表，臆造映射会把真实错误归一错。
 */
async function sendZhipuVoiceRequest(
  target: ZhipuVoiceApiTarget,
  action: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: RequestInit['body']; contentType?: string },
): Promise<Response> {
  const base = resolveZhipuApiBase(target, action)
  const url = `${base}${path}`
  const timeoutMs = target.timeoutMs ?? REQUEST_TIMEOUT_MS
  const doFetch = target.fetchImpl ?? fetch
  let response: Response
  try {
    response = await doFetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        ...(init.contentType ? { 'content-type': init.contentType } : {}),
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // 传输层失败（超时 / DNS / 连接被拒）不会走到下面的非 2xx 分支，
    // 归一成 MediaProviderError 才能让 IPC 层把可读原因透传出去：
    // DOMException 的 "The operation was aborted due to timeout"、fetch 的
    // "fetch failed" 对用户都没有信息量。
    throw toZhipuTransportError(error, action, init.method, url, timeoutMs)
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response)
    log.warn(
      `zhipu voice request failed, action=${action}, status=${response.status}, detail=${detail}`,
    )
    throw new MediaProviderError(
      'provider_http_error',
      `${action}失败：HTTP ${response.status}${detail ? ` · ${detail}` : ''}`,
      response.status,
    )
  }
  return response
}

async function parseZhipuJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new MediaProviderError(
      'provider_http_error',
      `${action}返回内容不是合法 JSON：${text.slice(0, 200)}`,
      response.status,
    )
  }
}

/** JSON 请求（`GET` 无体 / `POST` 带 JSON 体）。 */
export async function requestZhipuVoiceJson<T>(
  target: ZhipuVoiceApiTarget,
  action: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: string } = { method: 'GET' },
): Promise<T> {
  const startedAt = Date.now()
  const response = await sendZhipuVoiceRequest(target, action, path, {
    method: init.method,
    ...(init.body !== undefined ? { body: init.body, contentType: 'application/json' } : {}),
  })
  log.debug(`zhipu voice request ok, action=${action}, elapsedMs=${Date.now() - startedAt}`)
  return parseZhipuJson<T>(response, action)
}

/**
 * multipart 请求（文件上传）。
 *
 * 不手工设置 content-type：`FormData` 需要运行时自动补 boundary，写死会破坏请求。
 */
export async function requestZhipuVoiceMultipart<T>(
  target: ZhipuVoiceApiTarget,
  action: string,
  path: string,
  form: FormData,
): Promise<T> {
  const startedAt = Date.now()
  const response = await sendZhipuVoiceRequest(target, action, path, { method: 'POST', body: form })
  log.debug(`zhipu voice upload ok, action=${action}, elapsedMs=${Date.now() - startedAt}`)
  return parseZhipuJson<T>(response, action)
}

/**
 * 统一 HTTP + 响应解析工具，供 APIMart / xAI / openai-compatible adapter 共用。
 *
 * 响应解析（walkJson / extractImages / extractMediaUrls / extractText /
 * extractTaskId / extractStatus）下沉到 media-extract.mjs 作为单一事实源，
 * 同时被 spark_media MCP（stdio 子进程）复用，避免解析逻辑分叉。
 *
 * fetchJson / pollTask 留在本文件：它们与 TS 的 MediaProviderError 强耦合，
 * 且依赖 abort/buffer，不适合放进零依赖的纯 JS 共享模块。
 */

import type { MediaErrorContract } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'
import { normalizeMediaError } from './media-error-normalizer.js'

const pollLog = createLogger('media:task-poll')

// ─── 响应解析（re-export 自共享 .mjs 单一事实源） ─────────────────────────
export {
  walkJson,
  extractImages,
  extractMediaUrls,
  extractText,
  extractTaskId,
  extractStatus,
} from './media-extract.mjs'
export type { ExtractedImage } from './media-extract.mjs'

/**
 * Provider 专属错误消息提取器。
 *
 * 不同 provider 的错误响应结构各异（火山用 `{error:{code,message},RequestId}`，
 * xAI 用 `{error:{type,message}}`，Google 又是另一套）。fetchJson 默认只兜底
 * `HTTP <status>: <snippet>`；adapter 可注入此函数，把自家结构化错误字段
 * （code/message/requestId）解析成更友好的错误消息。
 *
 * 返回 undefined 表示未命中结构，由 fetchJson 退回默认兜底。
 */
export type ErrorExtractor = (status: number, body: unknown, rawText: string) => string | undefined

export interface FetchJsonOptions {
  method?: string | undefined
  headers?: Record<string, string> | undefined
  body?: string | Buffer | Uint8Array | undefined
  timeoutMs?: number | undefined
  /** 注入的 fetch（测试用） */
  fetchImpl?: typeof fetch | undefined
  /** 期望二进制响应时为 true，返回 Buffer */
  binary?: boolean | undefined
  /** Provider 专属错误消息提取器；命中结构时覆盖默认兜底消息 */
  errorExtractor?: ErrorExtractor | undefined
  /**
   * Contract V2 错误归一规则。命中时 fetchJson 把 provider 错误响应解析为
   * NormalizedMediaError 并挂到 MediaProviderError.normalized。
   * 与 errorExtractor 互补：errorExtractor 仍负责生成 message 文本，
   * errorContract 负责结构化字段（code/requestId/paramName/retryable）。
   */
  errorContract?: MediaErrorContract | undefined
}

/** JSON fetch + 统一错误码包装 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 30_000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    const init: RequestInit = { method: opts.method ?? 'GET', signal: controller.signal }
    if (opts.headers !== undefined) init.headers = opts.headers
    if (opts.body !== undefined) {
      init.body = typeof opts.body === 'string' ? opts.body : new Uint8Array(opts.body)
    }
    const res = await fetchImpl(url, init)
    if (opts.binary) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (!res.ok) {
        throw buildError(res.status, buf.toString('utf8'), null, opts, res.headers)
      }
      return buf as unknown as T
    }
    const text = await res.text()
    let body: unknown = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!res.ok) {
      throw buildError(res.status, text, body, opts, res.headers)
    }
    return body as T
  } catch (err) {
    if (err instanceof MediaProviderError) throw err
    if (timedOut || (controller.signal.aborted && isAbortError(err))) {
      throw new MediaProviderError(
        'provider_http_error',
        `${opts.method ?? 'GET'} ${sanitizeRequestUrl(url)} timed out after ${timeoutMs}ms`,
      )
    }
    const networkHint = describeNetworkError(err, opts.method ?? 'GET', url)
    throw new MediaProviderError(
      'provider_http_error',
      networkHint ?? (err instanceof Error ? err.message : String(err)),
    )
  } finally {
    clearTimeout(timer)
  }
}

function buildError(
  status: number,
  rawText: string,
  body: unknown,
  opts: FetchJsonOptions,
  headers?: Headers,
): MediaProviderError {
  // 优先用 provider 专属提取器解析错误消息文本；未命中则退回默认兜底。
  const extracted = opts.errorExtractor?.(status, body, rawText)
  const message = extracted ?? `HTTP ${status}: ${String(rawText).slice(0, 800)}`
  const err = new MediaProviderError('provider_http_error', message, status)
  if (opts.errorContract) {
    err.normalized = normalizeMediaError({
      statusCode: status,
      body,
      rawText,
      contract: opts.errorContract,
    })
  }
  const retryAfterMs = parseRetryAfter(headers?.get('retry-after'))
  if (retryAfterMs != null) err.retryAfterMs = retryAfterMs
  return err
}

export interface PollOptions {
  fetchImpl?: typeof fetch | undefined
  /** Default GET; V2 template polling can use POST/PUT/PATCH with a body. */
  method?: string | undefined
  body?: string | Buffer | Uint8Array | undefined
  intervalMs: number
  timeoutMs: number
  /** Hard upper bound for poll responses; timeout remains the second bound. */
  maxAttempts?: number | undefined
  /** 单次轮询 HTTP 请求超时；最终还会受任务剩余总时限约束。 */
  requestTimeoutMs?: number | undefined
  /** 检查响应：返回 'done' | 'pending' | 'failed' */
  inspect: (data: unknown) => 'done' | 'pending' | 'failed'
  /** Provider 专属错误消息提取器；轮询中非 ok 响应也走此提取器 */
  errorExtractor?: ErrorExtractor | undefined
  /** 与 fetchJson 同语义；轮询中遇到的 4xx/5xx 也会按 contract 归一 */
  errorContract?: MediaErrorContract | undefined
  /** 安全的结构化上下文，例如 provider/capability/requestId；不得包含密钥或签名 URL。 */
  logContext?: string | undefined
  /** 返回不含密钥和 URL 的响应摘要，供逐次轮询诊断。 */
  describeResponse?: ((data: unknown) => unknown) | undefined
  /**
   * 单次轮询请求遇到瞬时错误（底层网络错误 / 5xx / 请求超时）时的最大重试次数，默认 3。
   * GET 轮询幂等，重试无副作用；重试始终受任务总时限 timeoutMs 约束，不会无限挂起。
   * 确定性错误（4xx、inspect 判定的 task_failed）不会重试。
   */
  maxRetries?: number | undefined
  /** 瞬时错误重试退避基数（ms），默认 1000，每次 ×2、上限 8s。 */
  retryBackoffMs?: number | undefined
}

/** 轮询直到 inspect 返回 done/failed 或超时 */
export async function pollTask(
  url: string,
  headers: Record<string, string>,
  opts: PollOptions,
): Promise<unknown> {
  const startedAt = Date.now()
  const deadline = Date.now() + opts.timeoutMs
  const safeUrl = sanitizePollingUrl(url)
  const logContext = opts.logContext ? ` ${opts.logContext}` : ''
  // GET 轮询幂等：单次请求遇瞬时网络错误 / 5xx 在总时限内退避重试，避免一次抖动判死刑。
  const maxRetries = Math.max(0, opts.maxRetries ?? 3)
  const retryBackoffMs = Math.max(1, opts.retryBackoffMs ?? 1_000)
  let attempts = 0
  let retryCount = 0
  let nextBackoffMs = retryBackoffMs
  let lastResponseSummary = ''
  const messageOf = (error: unknown) =>
    JSON.stringify(error instanceof Error ? error.message : String(error))
  pollLog.info(
    `event=started url=${safeUrl} intervalMs=${opts.intervalMs} timeoutMs=${opts.timeoutMs} maxRetries=${maxRetries}${logContext}`,
  )
  // 允许调用方传小间隔（测试场景）；生产环境由 mediaDefaults.polling.intervalMs 控制（默认 5s）
  let interval = Math.max(1, opts.intervalMs)
  const fetchOpts: FetchJsonOptions = {
    headers,
    ...(opts.method ? { method: opts.method } : {}),
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  }
  if (opts.fetchImpl !== undefined) fetchOpts.fetchImpl = opts.fetchImpl
  if (opts.errorExtractor !== undefined) fetchOpts.errorExtractor = opts.errorExtractor
  if (opts.errorContract !== undefined) fetchOpts.errorContract = opts.errorContract
  while (Date.now() < deadline) {
    let data: unknown
    try {
      data = await fetchJson(url, {
        ...fetchOpts,
        timeoutMs: pollRequestTimeoutMs(deadline, opts.requestTimeoutMs),
      })
    } catch (error) {
      const elapsedMs = Date.now() - startedAt
      // 确定性错误（4xx、task_failed）不重试；task_failed/task_timeout 不走此分支。
      if (retryCount < maxRetries && isRetryableMediaError(error) && Date.now() < deadline) {
        retryCount += 1
        const retryAfterMs = error instanceof MediaProviderError ? error.retryAfterMs : undefined
        const backoff = Math.min(
          retryAfterMs != null ? Math.max(retryAfterMs, nextBackoffMs) : nextBackoffMs,
          MAX_RETRY_BACKOFF_MS,
        )
        nextBackoffMs = Math.min(nextBackoffMs * 2, MAX_RETRY_BACKOFF_MS)
        pollLog.warn(
          `event=request-failed-retryable url=${safeUrl} attempts=${attempts} retryCount=${retryCount}/${maxRetries} elapsedMs=${elapsedMs} backoffMs=${backoff}${retryAfterMs != null ? ` retryAfterMs=${retryAfterMs}` : ''} message=${messageOf(error)}${logContext}`,
        )
        await new Promise((resolve) => setTimeout(resolve, pollSleepIntervalMs(deadline, backoff)))
        continue
      }
      pollLog.warn(
        `event=request-failed url=${safeUrl} attempts=${attempts} retryCount=${retryCount} elapsedMs=${elapsedMs} message=${messageOf(error)}${logContext}`,
      )
      throw error
    }
    attempts += 1
    retryCount = 0
    nextBackoffMs = retryBackoffMs
    const state = opts.inspect(data)
    const responseSummary = describePollResponse(opts, data)
    lastResponseSummary = responseSummary
    if (state === 'done') {
      pollLog.info(
        `event=finished state=done attempts=${attempts} elapsedMs=${Date.now() - startedAt} url=${safeUrl}${logContext}${responseSummary}`,
      )
      return data
    }
    if (state === 'failed') {
      pollLog.warn(
        `event=finished state=failed attempts=${attempts} elapsedMs=${Date.now() - startedAt} url=${safeUrl}${logContext}${responseSummary}`,
      )
      throw new MediaProviderError(
        'task_failed',
        `Task failed: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    if (opts.maxAttempts != null && attempts >= opts.maxAttempts) {
      pollLog.warn(
        `event=finished state=max-attempts attempts=${attempts} elapsedMs=${Date.now() - startedAt} url=${safeUrl}${logContext}${responseSummary}`,
      )
      throw new MediaProviderError(
        'task_timeout',
        `Task exceeded maximum polling attempts (${opts.maxAttempts})`,
      )
    }
    pollLog.debug(
      `event=pending attempts=${attempts} elapsedMs=${Date.now() - startedAt} nextIntervalMs=${interval} url=${safeUrl}${logContext}${responseSummary}`,
    )
    await new Promise((resolve) => setTimeout(resolve, pollSleepIntervalMs(deadline, interval)))
    // 简单退避，上限 15s，避免长时间任务的高频轮询
    interval = Math.min(Math.max(interval * 1.3, interval), 15_000)
  }
  pollLog.warn(
    `event=finished state=timeout attempts=${attempts} elapsedMs=${Date.now() - startedAt} url=${safeUrl}${logContext}${lastResponseSummary}`,
  )
  throw new MediaProviderError('task_timeout', `Task timed out after ${opts.timeoutMs}ms`)
}

/** 单次轮询不能超过配置值，也不能越过任务的剩余总时限。 */
export function pollRequestTimeoutMs(
  deadlineMs: number,
  configuredRequestTimeoutMs: number | undefined,
  nowMs = Date.now(),
): number {
  const remainingMs = Math.max(1, deadlineMs - nowMs)
  return Math.min(configuredRequestTimeoutMs ?? 30_000, remainingMs)
}

/** 轮询退避等待同样不能越过任务总时限。 */
export function pollSleepIntervalMs(
  deadlineMs: number,
  intervalMs: number,
  nowMs = Date.now(),
): number {
  return Math.max(0, Math.min(intervalMs, deadlineMs - nowMs))
}

const MAX_RETRY_BACKOFF_MS = 8_000

/** Node fetch 底层网络错误（含 err.cause）的特征串，命中则视为可重试的瞬时错误。 */
const TRANSIENT_NETWORK_ERROR_MARKERS = [
  'fetch failed',
  'enotfound',
  'econnrefused',
  'econnreset',
  'econnaborted',
  'eai_again',
  'etimedout',
  'ehostunreach',
  'enetunreach',
  'und_err_connect_timeout',
  'und_err_socket',
  'other side closed',
  'hang up',
  'socket hang up',
] as const

/**
 * 判断 MediaProviderError 是否为可安全重试的瞬时错误：底层网络错误（statusCode 缺省）、
 * HTTP 5xx 或限流 429。其它 4xx、task_failed、task_timeout 不在此列。
 */
export function isRetryableMediaError(error: unknown): boolean {
  if (!(error instanceof MediaProviderError)) return false
  if (error.code !== 'provider_http_error') return false
  if (error.statusCode === undefined) return true
  return error.statusCode === 429 || error.statusCode >= 500
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), MAX_RETRY_BACKOFF_MS)
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return undefined
  return Math.min(Math.max(0, timestamp - Date.now()), MAX_RETRY_BACKOFF_MS)
}

/**
 * 识别 Node fetch 的 'fetch failed' 等对用户毫无信息量的网络错误，从 err.cause 提取
 * 具体原因并给出可读提示。命中返回提示文本，未命中返回 undefined（由调用方保留原 message）。
 */
export function describeNetworkError(
  error: unknown,
  method: string,
  url: string,
): string | undefined {
  if (!(error instanceof Error)) return undefined
  const msg = error.message ?? ''
  const cause = (error as { cause?: unknown }).cause
  const causeText =
    cause instanceof Error ? (cause.message ?? '') : typeof cause === 'string' ? cause : ''
  const haystack = `${msg} ${causeText}`.toLowerCase()
  if (!TRANSIENT_NETWORK_ERROR_MARKERS.some((marker) => haystack.includes(marker))) return undefined
  const detail = (causeText || msg || '连接失败').slice(0, 300)
  return `${method} ${sanitizeRequestUrl(url)} 网络请求失败：${detail}。可能原因：endpoint 不可达、网络中断、DNS 解析失败或 TLS 握手失败。`
}

function sanitizePollingUrl(url: string): string {
  return sanitizeRequestUrl(url)
}

export function sanitizeRequestUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url.split(/[?#]/, 1)[0] ?? '(invalid-url)'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function describePollResponse(opts: PollOptions, data: unknown): string {
  if (!opts.describeResponse) return ''
  try {
    const summary = JSON.stringify(opts.describeResponse(data))
    return summary ? ` response=${summary.slice(0, 800)}` : ''
  } catch {
    return ' response="[summary-failed]"'
  }
}

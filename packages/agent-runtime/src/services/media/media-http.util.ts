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

import { MediaProviderError } from './media-adapter.types.js'

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

export interface FetchJsonOptions {
  method?: string | undefined
  headers?: Record<string, string> | undefined
  body?: string | Buffer | Uint8Array | undefined
  timeoutMs?: number | undefined
  /** 注入的 fetch（测试用） */
  fetchImpl?: typeof fetch | undefined
  /** 期望二进制响应时为 true，返回 Buffer */
  binary?: boolean | undefined
}

/** JSON fetch + 统一错误码包装 */
export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000)
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
        throw new MediaProviderError('provider_http_error', `HTTP ${res.status}`, res.status)
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
      const snippet = String(text).slice(0, 800)
      throw new MediaProviderError('provider_http_error', `HTTP ${res.status}: ${snippet}`, res.status)
    }
    return body as T
  } catch (err) {
    if (err instanceof MediaProviderError) throw err
    throw new MediaProviderError('provider_http_error', err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}

export interface PollOptions {
  fetchImpl?: typeof fetch | undefined
  intervalMs: number
  timeoutMs: number
  /** 检查响应：返回 'done' | 'pending' | 'failed' */
  inspect: (data: unknown) => 'done' | 'pending' | 'failed'
}

/** 轮询直到 inspect 返回 done/failed 或超时 */
export async function pollTask(url: string, headers: Record<string, string>, opts: PollOptions): Promise<unknown> {
  const deadline = Date.now() + opts.timeoutMs
  // 允许调用方传小间隔（测试场景）；生产环境由 mediaDefaults.polling.intervalMs 控制（默认 5s）
  let interval = Math.max(1, opts.intervalMs)
  const fetchOpts: FetchJsonOptions = { headers, timeoutMs: 30_000 }
  if (opts.fetchImpl !== undefined) fetchOpts.fetchImpl = opts.fetchImpl
  while (Date.now() < deadline) {
    const data = await fetchJson(url, fetchOpts)
    const state = opts.inspect(data)
    if (state === 'done') return data
    if (state === 'failed') {
      throw new MediaProviderError('task_failed', `Task failed: ${JSON.stringify(data).slice(0, 800)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
    // 简单退避，上限 15s，避免长时间任务的高频轮询
    interval = Math.min(Math.max(interval * 1.3, interval), 15_000)
  }
  throw new MediaProviderError('task_timeout', `Task timed out after ${opts.timeoutMs}ms`)
}

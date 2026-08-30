import { MediaProviderError } from './media-adapter.types.js'
import { createLogger } from '@spark/shared'

export const XAI_MAX_FILE_BYTES = 48 * 1024 * 1024
const XAI_FILES_REQUEST_TIMEOUT_MS = 30_000
const log = createLogger('media:xai-files')

export interface XaiFileObject {
  id: string
  filename: string
  bytes: number
  created_at: number
  expires_at?: number
  object: 'file'
  purpose: string
}

export interface XaiFilesPage {
  data: XaiFileObject[]
  pagination_token?: string
}

export class XaiFilesClient {
  constructor(
    private readonly options: {
      apiKey: string
      apiEndpoint: string
      fetch?: typeof fetch
      timeoutMs?: number
    },
  ) {}

  async list(params: {
    limit?: number
    order?: 'asc' | 'desc'
    sortBy?: 'created_at' | 'filename' | 'size'
    paginationToken?: string
  } = {}): Promise<XaiFilesPage> {
    const query = new URLSearchParams()
    query.set('limit', String(Math.max(1, Math.min(100, params.limit ?? 50))))
    if (params.order) query.set('order', params.order)
    if (params.sortBy) query.set('sort_by', params.sortBy)
    if (params.paginationToken) query.set('pagination_token', params.paginationToken)
    return this.request<XaiFilesPage>(`/files?${query.toString()}`)
  }

  async delete(fileId: string): Promise<{ deleted: boolean; id: string }> {
    if (!fileId.trim()) throw new MediaProviderError('invalid_input', 'xAI file id is required')
    return this.request(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
  }

  async upload(input: {
    buffer: Buffer
    filename: string
    mimeType?: string
    expiresAfter?: number
  }): Promise<XaiFileObject> {
    if (input.buffer.byteLength > XAI_MAX_FILE_BYTES) {
      throw new MediaProviderError('invalid_input', 'xAI Files 单文件不能超过 48 MiB')
    }
    if (
      input.expiresAfter !== undefined
      && (input.expiresAfter < 3600 || input.expiresAfter > 2_592_000)
    ) {
      throw new MediaProviderError('invalid_input', 'xAI Files expires_after 必须在 3600–2592000 秒之间')
    }
    const form = new FormData()
    if (input.expiresAfter !== undefined) form.append('expires_after', String(input.expiresAfter))
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType ?? 'application/octet-stream' }),
      input.filename,
    )
    return this.request('/files', { method: 'POST', body: form })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? 'GET'
    const safePath = path.split('?', 1)[0] ?? path
    const timeoutMs = this.options.timeoutMs ?? XAI_FILES_REQUEST_TIMEOUT_MS
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    const startedAt = Date.now()
    log.debug(`event=request-started method=${method} path=${safePath} timeoutMs=${timeoutMs}`)
    try {
      const response = await (this.options.fetch ?? fetch)(
        `${this.options.apiEndpoint.replace(/\/+$/, '')}${path}`,
        {
          ...init,
          signal: controller.signal,
          headers: { authorization: `Bearer ${this.options.apiKey}`, ...(init.headers ?? {}) },
        },
      )
      const text = await response.text()
      log.debug(
        `event=request-finished method=${method} path=${safePath} status=${response.status} elapsedMs=${Date.now() - startedAt}`,
      )
      if (!response.ok) {
        throw new MediaProviderError(
          'provider_http_error',
          `xAI Files HTTP ${response.status}: ${text.slice(0, 800)}`,
          response.status,
        )
      }
      if (!text) return null as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new MediaProviderError(
          'provider_http_error',
          `xAI Files returned invalid JSON: ${text.slice(0, 800)}`,
          response.status,
        )
      }
    } catch (error) {
      if (timedOut) {
        log.warn(
          `event=request-timeout method=${method} path=${safePath} elapsedMs=${Date.now() - startedAt}`,
        )
        throw new MediaProviderError(
          'provider_http_error',
          `xAI Files ${method} ${safePath} timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

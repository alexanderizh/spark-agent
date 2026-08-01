/**
 * @module minimax-hailuo-files-client
 *
 * MiniMax 文件管理 client（仅用户素材上传 / 列出 / 检索 / 删除）。
 *
 * 职责边界（与火山 / xAI 一致）：
 *   - 仅负责"用户素材"经 `POST /v1/files/upload` 上传拿 file_id（V2 H3 用 mm_file://{file_id} 引用）；
 *   - 仅负责 v1 视频产物下载链路里的 `GET /v1/files/retrieve?file_id=` 拿 download_url；
 *   - **不**负责视频/图片产物二进制下载（产物下载归 adapter 内 MediaArtifactService）。
 *
 * 错误模型：MiniMax Files 接口与 v1 一样 HTTP 恒为 200，业务状态码在
 * `base_resp.status_code`（0=成功）。client 主动检测 base_resp 并抛 MediaProviderError。
 *
 * file_id 是 int64：JS number 无法精确表示 > 2^53-1。当前 MiniMax file_id（~1.7e14）
 * 在安全范围内，但接口层统一按 string 透传，避免未来 id 增长踩精度坑。
 * 来源：docs/integrations/minimax/files-api.md
 */

import { createLogger } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'
import { assertMinimaxBaseResp } from './minimax-hailuo-error.js'

const log = createLogger('media:minimax-files')
const MINIMAX_FILES_REQUEST_TIMEOUT_MS = 30_000

/** 上传接口 purpose 枚举（来源：files-api.md §2）。视频生成输入素材用 video_generation_input。 */
const UPLOAD_PURPOSES = [
  'voice_clone',
  'prompt_audio',
  't2a_async_input',
  'video_understanding',
  'video_generation_input',
] as const
const LIST_PURPOSES = ['voice_clone', 'prompt_audio', 't2a_async_input', 'video_generation_input'] as const
const DELETE_PURPOSES = [
  'voice_clone',
  'prompt_audio',
  't2a_async',
  't2a_async_input',
  'video_generation',
] as const

export type MinimaxUploadPurpose = (typeof UPLOAD_PURPOSES)[number]
export type MinimaxListPurpose = (typeof LIST_PURPOSES)[number]
export type MinimaxDeletePurpose = (typeof DELETE_PURPOSES)[number]

export interface MinimaxFileObject {
  /** int64，统一按 string 透传防精度丢失 */
  fileId: string
  bytes?: number | undefined
  createdAt?: number | undefined
  filename?: string | undefined
  purpose?: string | undefined
  /** 仅 retrieve example 可见，schema 未正式声明；v1 视频产物下载链路依赖它 */
  downloadUrl?: string | undefined
}

interface MinimaxFileObjectDto {
  file_id?: unknown
  bytes?: unknown
  created_at?: unknown
  filename?: unknown
  purpose?: unknown
  download_url?: unknown
}

export class MinimaxHailuoFilesClient {
  constructor(
    private readonly options: {
      apiKey: string
      apiEndpoint: string
      fetch?: typeof fetch
      timeoutMs?: number
    },
  ) {}

  /** 上传文件，返回 file_id（string）。POST /v1/files/upload（multipart）。 */
  async upload(input: {
    buffer: Buffer
    filename: string
    mimeType?: string
    purpose: MinimaxUploadPurpose
  }): Promise<MinimaxFileObject> {
    const form = new FormData()
    form.append('purpose', input.purpose)
    form.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: input.mimeType ?? 'application/octet-stream' }),
      input.filename,
    )
    const body = await this.request('/v1/files/upload', { method: 'POST', body: form })
    return readFileObject(body)
  }

  /** 列出指定 purpose 下的文件。GET /v1/files/list?purpose=（无分页）。 */
  async list(purpose: MinimaxListPurpose): Promise<MinimaxFileObject[]> {
    const body = await this.request(`/v1/files/list?purpose=${encodeURIComponent(purpose)}`)
    assertMinimaxBaseResp(body)
    const files = readField<unknown[]>(body, 'files') ?? []
    return (Array.isArray(files) ? files : []).map((item) => readFileObject(item, false))
  }

  /**
   * 检索单个文件元信息（含 download_url）。GET /v1/files/retrieve?file_id=。
   * v1 视频产物下载链路：query 拿 file_id → retrieve 拿 download_url（1h）→ adapter 下载。
   */
  async retrieve(fileId: string): Promise<MinimaxFileObject> {
    if (!fileId.trim()) throw new MediaProviderError('invalid_input', 'MiniMax file_id is required')
    const body = await this.request(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`)
    return readFileObject(body)
  }

  /** 删除单个文件。POST /v1/files/delete（JSON：file_id + purpose）。 */
  async delete(input: { fileId: string; purpose: MinimaxDeletePurpose }): Promise<void> {
    if (!input.fileId.trim()) throw new MediaProviderError('invalid_input', 'MiniMax file_id is required')
    const body = await this.request('/v1/files/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // file_id 虽在 delete OpenAPI 中声明为 int64，但必须按字符串透传，避免 JS Number
      // 在超过 2^53-1 时先发生不可逆精度丢失。服务端可按 int64 字符串解析。
      body: JSON.stringify({ file_id: input.fileId, purpose: input.purpose }),
    })
    assertMinimaxBaseResp(body)
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = init.method ?? 'GET'
    const safePath = path.split('?', 1)[0] ?? path
    const timeoutMs = this.options.timeoutMs ?? MINIMAX_FILES_REQUEST_TIMEOUT_MS
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
          `MiniMax Files HTTP ${response.status}: ${text.slice(0, 800)}`,
          response.status,
        )
      }
      if (!text) return null
      try {
        const parsed = parseMinimaxFilesJson(text)
        // Files 接口 HTTP 恒 200，业务码在 base_resp.status_code；非 0 视为失败。
        assertMinimaxBaseResp(parsed)
        return parsed
      } catch (error) {
        if (error instanceof MediaProviderError) throw error
        throw new MediaProviderError(
          'provider_http_error',
          `MiniMax Files returned invalid JSON: ${text.slice(0, 800)}`,
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
          `MiniMax Files ${method} ${safePath} timed out after ${timeoutMs}ms`,
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * MiniMax 的部分 Files OpenAPI 示例把 int64 file_id 写成 JSON number。
 * 原生 JSON.parse 会在值超过 Number.MAX_SAFE_INTEGER 时先发生不可逆舍入，因此只在
 * Files 响应边界把未加引号的 file_id 整数转成 JSON string，再交给标准解析器。
 */
function parseMinimaxFilesJson(text: string): unknown {
  const preserved = text.replace(
    /(\x22file_id\x22\s*:\s*)(-?\d+)(?=\s*[,}])/g,
    '$1\u0022$2\u0022',
  )
  return JSON.parse(preserved)
}

/** 读取响应体里的 file 对象（upload 响应）或顶层（retrieve 响应在 file 字段下）。 */
function readFileObject(body: unknown, nested = true): MinimaxFileObject {
  assertMinimaxBaseResp(body)
  const dto = (nested ? readField<MinimaxFileObjectDto>(body, 'file') : body) as
    | MinimaxFileObjectDto
    | undefined
  if (!dto) {
    throw new MediaProviderError('provider_http_error', 'MiniMax Files 响应缺少 file 对象')
  }
  return {
    fileId: stringifyFileId(dto.file_id),
    ...(dto.bytes != null ? { bytes: Number(dto.bytes) } : {}),
    ...(dto.created_at != null ? { createdAt: Number(dto.created_at) } : {}),
    ...(typeof dto.filename === 'string' ? { filename: dto.filename } : {}),
    ...(typeof dto.purpose === 'string' ? { purpose: dto.purpose } : {}),
    ...(typeof dto.download_url === 'string' && dto.download_url
      ? { downloadUrl: dto.download_url }
      : {}),
  }
}

// base_resp 归一见 minimax-hailuo-error.ts（assertMinimaxBaseResp），本文件顶部 import 复用。

function readField<T>(root: unknown, key: string): T | undefined {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return undefined
  const record = root as Record<string, unknown>
  return record[key] as T | undefined
}

/** file_id 是 int64：统一按 string 透传，避免 JS number 精度丢失。 */
function stringifyFileId(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new MediaProviderError('provider_http_error', `MiniMax Files 返回的 file_id 非法: ${String(value)}`)
}

import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  ProviderFileObject,
  ProviderFilesListResponse,
  VolcengineFileStatus,
  VolcengineVideoPreprocessInput,
} from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'

export const VOLCENGINE_ARK_PLATFORM_FILE_MAX_BYTES = 512 * 1024 * 1024
export const VOLCENGINE_ARK_TOS_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024
export const VOLCENGINE_ARK_FILES_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

const SUPPORTED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.ico',
  '.icns',
  '.sgi',
  '.jp2',
  '.heic',
  '.heif',
  '.mp4',
  '.avi',
  '.mov',
  '.pdf',
  '.mp3',
  '.wav',
  '.aac',
  '.m4a',
])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov'])

type RawVolcengineFile = {
  object?: string
  id?: string
  purpose?: string
  scope?: { type?: string; id?: string }
  filename?: string
  tos?: { bucket?: string; object_key?: string }
  bytes?: number
  created_at?: number
  expire_at?: number
  mime_type?: string
  status?: string
  error?: { code?: string; message?: string }
  preprocess_configs?: Record<string, unknown> | null
}

type RawVolcengineFileList = {
  object?: string
  data?: RawVolcengineFile[] | null
  first_id?: string
  last_id?: string
  has_more?: boolean
}

export function resolveVolcengineArkFilesBaseUrl(apiEndpoint?: string): string {
  const value = apiEndpoint?.trim()
  if (!value) return VOLCENGINE_ARK_FILES_DEFAULT_BASE_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol')
    }
    return `${url.origin}/api/v3`
  } catch {
    throw new MediaProviderError(
      'invalid_input',
      `火山方舟 BaseURL 无效，无法定位 Files API：${value}`,
    )
  }
}

export class VolcengineArkFilesClient {
  private readonly baseUrl: string

  constructor(
    private readonly options: {
      apiKey: string
      apiEndpoint?: string
      fetch?: typeof fetch
      now?: () => number
    },
  ) {
    this.baseUrl = resolveVolcengineArkFilesBaseUrl(options.apiEndpoint)
  }

  async list(
    params: {
      after?: string
      limit?: number
      purpose?: 'user_data'
      order?: 'asc' | 'desc'
      scopeId?: string
    } = {},
  ): Promise<ProviderFilesListResponse> {
    const query = new URLSearchParams()
    if (params.after) query.set('after', params.after)
    query.set('limit', String(Math.max(1, Math.min(100, params.limit ?? 100))))
    if (params.purpose) query.set('purpose', params.purpose)
    query.set('order', params.order === 'asc' ? 'asc' : 'desc')
    if (params.scopeId) query.set('scope_id', params.scopeId)
    const raw = await this.request<RawVolcengineFileList>(`/files?${query.toString()}`)
    return {
      providerKind: 'volcengine-ark',
      files: (raw.data ?? []).map(normalizeVolcengineFile),
      ...(raw.first_id ? { firstId: raw.first_id } : {}),
      ...(raw.last_id ? { lastId: raw.last_id } : {}),
      ...(raw.has_more !== undefined ? { hasMore: raw.has_more } : {}),
      ...(raw.has_more && raw.last_id ? { paginationToken: raw.last_id } : {}),
    }
  }

  async get(fileId: string): Promise<ProviderFileObject> {
    const id = requireFileId(fileId)
    return normalizeVolcengineFile(
      await this.request<RawVolcengineFile>(`/files/${encodeURIComponent(id)}`),
    )
  }

  async delete(fileId: string): Promise<{ deleted: boolean; id: string }> {
    const id = requireFileId(fileId)
    return this.request(`/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async upload(input: {
    filePath?: string
    url?: string
    purpose?: 'user_data'
    expireAt?: number
    tos?: { bucket: string; prefix: string }
    preprocessVideo?: VolcengineVideoPreprocessInput
    waitUntilActive?: boolean
  }): Promise<ProviderFileObject> {
    const filePath = input.filePath?.trim() ?? ''
    const url = input.url?.trim() ?? ''
    if (Boolean(filePath) === Boolean(url)) {
      throw new MediaProviderError('invalid_input', '本地文件与 URL 必须且只能填写一项')
    }
    if (url && !/^(?:https?:\/\/|tos:\/\/)/i.test(url)) {
      throw new MediaProviderError(
        'invalid_input',
        '火山方舟文件 URL 仅支持 HTTP、HTTPS 或 TOS URI',
      )
    }
    if (url.toLowerCase().startsWith('tos://') && !input.tos) {
      throw new MediaProviderError(
        'invalid_input',
        '使用 TOS URI 导入时必须填写目标 TOS bucket 和 prefix',
      )
    }
    validateExpireAt(input.expireAt, this.options.now?.() ?? Date.now())
    validateTos(input.tos)
    validateVideoPreprocess(input.preprocessVideo)

    const form = new FormData()
    form.append('purpose', input.purpose ?? 'user_data')
    if (filePath) {
      const info = await stat(filePath)
      if (!info.isFile()) {
        throw new MediaProviderError('invalid_input', `选择的路径不是文件：${filePath}`)
      }
      const extension = path.extname(filePath).toLowerCase()
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        throw new MediaProviderError(
          'invalid_input',
          `火山方舟 Files 不支持 ${extension || '无扩展名'} 文件`,
        )
      }
      if (input.preprocessVideo && !VIDEO_EXTENSIONS.has(extension)) {
        throw new MediaProviderError('invalid_input', '视频预处理参数只能用于 MP4、AVI 或 MOV 文件')
      }
      const maxBytes =
        input.tos && VIDEO_EXTENSIONS.has(extension)
          ? VOLCENGINE_ARK_TOS_VIDEO_MAX_BYTES
          : VOLCENGINE_ARK_PLATFORM_FILE_MAX_BYTES
      if (info.size > maxBytes) {
        throw new MediaProviderError(
          'invalid_input',
          `文件大小 ${formatBytes(info.size)} 超过当前存储方式上限 ${formatBytes(maxBytes)}`,
        )
      }
      const mimeType = mimeFromExtension(extension)
      const blob = await openAsBlob(filePath, { type: mimeType })
      form.append('file', blob, path.basename(filePath))
    } else {
      const extension = extensionFromRemoteUrl(url)
      if (input.preprocessVideo && extension && !VIDEO_EXTENSIONS.has(extension)) {
        throw new MediaProviderError('invalid_input', '视频预处理参数只能用于 MP4、AVI 或 MOV 文件')
      }
      form.append('url', url)
    }
    if (input.expireAt !== undefined) form.append('expire_at', String(input.expireAt))
    if (input.tos) {
      form.append('tos[bucket]', input.tos.bucket.trim())
      form.append('tos[prefix]', input.tos.prefix.trim())
    }
    appendVideoPreprocess(form, input.preprocessVideo)

    const uploaded = normalizeVolcengineFile(
      await this.request<RawVolcengineFile>('/files', { method: 'POST', body: form }, 300_000),
    )
    return input.waitUntilActive === true ? this.waitUntilActive(uploaded.id) : uploaded
  }

  async waitUntilActive(fileId: string, timeoutMs = 300_000): Promise<ProviderFileObject> {
    const deadline = Date.now() + timeoutMs
    let intervalMs = 1_000
    while (Date.now() < deadline) {
      const file = await this.get(fileId)
      if (file.status === 'active') return file
      if (file.status === 'failed') {
        const detail = [file.error?.code, file.error?.message].filter(Boolean).join(' ')
        throw new MediaProviderError(
          'provider_http_error',
          `火山方舟文件预处理失败${detail ? `：${detail}` : ''}`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
      intervalMs = Math.min(Math.ceil(intervalMs * 1.5), 5_000)
    }
    throw new MediaProviderError('task_timeout', `火山方舟文件 ${fileId} 在 5 分钟内未完成预处理`)
  }

  private async request<T>(
    pathName: string,
    init: RequestInit = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    let response: Response
    try {
      response = await (this.options.fetch ?? fetch)(`${this.baseUrl}${pathName}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const timedOut =
        error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      throw new MediaProviderError(
        timedOut ? 'task_timeout' : 'provider_http_error',
        timedOut
          ? `火山方舟 Files 请求超时（${Math.ceil(timeoutMs / 1_000)} 秒）`
          : `火山方舟 Files 网络请求失败：${detail}`,
      )
    }
    const text = await response.text()
    if (!response.ok) {
      const requestId = response.headers.get('x-request-id') ?? response.headers.get('x-tt-logid')
      throw new MediaProviderError(
        'provider_http_error',
        `火山方舟 Files HTTP ${response.status}${requestId ? `（RequestId: ${requestId}）` : ''}: ${text.slice(0, 800)}`,
        response.status,
      )
    }
    if (!text) return null as T
    try {
      return JSON.parse(text) as T
    } catch {
      throw new MediaProviderError(
        'provider_http_error',
        `火山方舟 Files 返回了无效 JSON：${text.slice(0, 800)}`,
        response.status,
      )
    }
  }
}

function normalizeVolcengineFile(raw: RawVolcengineFile): ProviderFileObject {
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) throw new MediaProviderError('provider_http_error', '火山方舟 Files 响应缺少文件 ID')
  const status = isVolcengineFileStatus(raw.status) ? raw.status : undefined
  return {
    id,
    filename: typeof raw.filename === 'string' && raw.filename ? raw.filename : id,
    bytes: typeof raw.bytes === 'number' && raw.bytes >= 0 ? raw.bytes : 0,
    createdAt: typeof raw.created_at === 'number' ? raw.created_at : 0,
    ...(typeof raw.expire_at === 'number' ? { expiresAt: raw.expire_at } : {}),
    purpose: typeof raw.purpose === 'string' && raw.purpose ? raw.purpose : 'user_data',
    object: 'file',
    providerKind: 'volcengine-ark',
    ...(typeof raw.mime_type === 'string' ? { mimeType: raw.mime_type } : {}),
    ...(status ? { status } : {}),
    ...(raw.error ? { error: raw.error } : {}),
    ...(raw.scope ? { scope: raw.scope } : {}),
    ...(raw.tos && (raw.tos.bucket || raw.tos.object_key)
      ? {
          tos: {
            ...(raw.tos.bucket ? { bucket: raw.tos.bucket } : {}),
            ...(raw.tos.object_key ? { objectKey: raw.tos.object_key } : {}),
          },
        }
      : {}),
    ...(raw.preprocess_configs !== undefined ? { preprocessConfigs: raw.preprocess_configs } : {}),
  }
}

function isVolcengineFileStatus(value: unknown): value is VolcengineFileStatus {
  return value === 'processing' || value === 'active' || value === 'failed'
}

function requireFileId(fileId: string): string {
  const value = fileId.trim()
  if (!value) throw new MediaProviderError('invalid_input', '火山方舟 file_id 不能为空')
  return value
}

function validateExpireAt(expireAt: number | undefined, nowMs: number): void {
  if (expireAt === undefined) return
  const nowSeconds = Math.floor(nowMs / 1_000)
  if (
    !Number.isInteger(expireAt) ||
    expireAt < nowSeconds + 86_400 ||
    expireAt > nowSeconds + 2_592_000
  ) {
    throw new MediaProviderError(
      'invalid_input',
      '火山方舟 expire_at 必须是当前时间后 1–30 天内的 UTC Unix 秒时间戳',
    )
  }
}

function validateTos(tos: { bucket: string; prefix: string } | undefined): void {
  if (!tos) return
  if (!tos.bucket.trim() || !tos.prefix.trim()) {
    throw new MediaProviderError('invalid_input', 'TOS bucket 和 prefix 均不能为空')
  }
  if (tos.prefix.startsWith('/')) {
    throw new MediaProviderError('invalid_input', 'TOS prefix 必须使用相对路径，不能以 / 开头')
  }
}

function validateVideoPreprocess(input: VolcengineVideoPreprocessInput | undefined): void {
  if (!input) return
  assertRange(input.fps, 'fps', 0.2, 5, false)
  assertRange(input.maxVideoTokens, 'maxVideoTokens', 10_240, 204_800, true)
  assertRange(input.minFrameTokens, 'minFrameTokens', 16, 128, true)
  assertRange(input.maxFrameTokens, 'maxFrameTokens', 128, 640, true)
  assertRange(input.minFrames, 'minFrames', 5, 16, true)
  if (input.model !== undefined && !input.model.trim()) {
    throw new MediaProviderError('invalid_input', '视频预处理模型 ID 不能为空')
  }
  if (
    input.minFrameTokens !== undefined &&
    input.maxFrameTokens !== undefined &&
    input.minFrameTokens > input.maxFrameTokens
  ) {
    throw new MediaProviderError('invalid_input', 'minFrameTokens 不能大于 maxFrameTokens')
  }
}

function assertRange(
  value: number | undefined,
  name: string,
  minimum: number,
  maximum: number,
  integer: boolean,
): void {
  if (value === undefined) return
  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < minimum ||
    value > maximum
  ) {
    throw new MediaProviderError(
      'invalid_input',
      `视频预处理 ${name} 必须${integer ? '为整数且' : ''}位于 ${minimum}–${maximum}`,
    )
  }
}

function appendVideoPreprocess(
  form: FormData,
  input: VolcengineVideoPreprocessInput | undefined,
): void {
  if (!input) return
  const values: Array<[string, number | undefined]> = [
    ['fps', input.fps],
    ['max_video_tokens', input.maxVideoTokens],
    ['min_frame_tokens', input.minFrameTokens],
    ['max_frame_tokens', input.maxFrameTokens],
    ['min_frames', input.minFrames],
  ]
  for (const [name, value] of values) {
    if (value !== undefined) form.append(`preprocess_configs[video][${name}]`, String(value))
  }
  if (input.model?.trim()) {
    form.append('preprocess_configs[video][model]', input.model.trim())
  }
}

function mimeFromExtension(extension: string): string {
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.ico': 'image/x-icon',
    '.icns': 'image/icns',
    '.sgi': 'image/sgi',
    '.jp2': 'image/jp2',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.pdf': 'application/pdf',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
  }
  return types[extension] ?? 'application/octet-stream'
}

function extensionFromRemoteUrl(value: string): string {
  try {
    if (value.toLowerCase().startsWith('tos://')) {
      return path.extname(value.slice('tos://'.length).split(/[?#]/, 1)[0] ?? '').toLowerCase()
    }
    return path.extname(new URL(value).pathname).toLowerCase()
  } catch {
    return ''
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`
}

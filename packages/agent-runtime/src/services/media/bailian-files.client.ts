import { openAsBlob } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { ProviderFileObject, ProviderFilesListResponse } from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'

export const BAILIAN_FILES_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

const MAX_FILE_BYTES_BY_PURPOSE = {
  'file-extract': 150 * 1024 * 1024,
  batch: 500 * 1024 * 1024,
  'fine-tune': 1024 * 1024 * 1024,
} as const

type BailianFilePurpose = keyof typeof MAX_FILE_BYTES_BY_PURPOSE

type RawBailianFile = {
  file_id?: string
  name?: string
  description?: string
  size?: number
  gmt_create?: string
  purpose?: string
}

type RawBailianResponse<T> = {
  request_id?: string
  code?: string
  message?: string
  data?: T
}

type RawBailianFileList = {
  total?: number
  page_size?: number
  page_no?: number
  files?: RawBailianFile[]
}

export function resolveBailianFilesBaseUrl(apiEndpoint?: string): string {
  if (!apiEndpoint?.trim()) return BAILIAN_FILES_DEFAULT_BASE_URL
  try {
    const url = new URL(apiEndpoint)
    if (url.hostname.toLowerCase() !== 'dashscope.aliyuncs.com') {
      throw new Error('unsupported hostname')
    }
    return `${url.origin}/api/v1`
  } catch {
    throw new MediaProviderError(
      'invalid_input',
      '百炼 Files 仅支持北京 Region 的公共 DashScope Base URL：https://dashscope.aliyuncs.com/api/v1',
    )
  }
}

export class BailianFilesClient {
  private readonly baseUrl: string

  constructor(
    private readonly options: {
      apiKey: string
      apiEndpoint?: string
      fetch?: typeof fetch
      stat?: typeof stat
      openAsBlob?: typeof openAsBlob
    },
  ) {
    this.baseUrl = resolveBailianFilesBaseUrl(options.apiEndpoint)
  }

  async list(
    params: { pageNo?: number; pageSize?: number } = {},
  ): Promise<ProviderFilesListResponse> {
    const pageNo = Math.max(1, Math.floor(params.pageNo ?? 1))
    const pageSize = Math.max(1, Math.min(100, Math.floor(params.pageSize ?? 20)))
    const result = await this.request<RawBailianResponse<RawBailianFileList>>(
      `/files?page_no=${pageNo}&page_size=${pageSize}`,
    )
    const data = result.data ?? {}
    const resolvedPageNo = positiveInteger(data.page_no, pageNo)
    const resolvedPageSize = positiveInteger(data.page_size, pageSize)
    const total = nonNegativeInteger(data.total, 0)
    const nextPage = resolvedPageNo * resolvedPageSize < total ? resolvedPageNo + 1 : undefined
    return {
      providerKind: 'bailian',
      files: (data.files ?? []).map(normalizeBailianFile),
      ...(nextPage ? { paginationToken: String(nextPage), hasMore: true } : { hasMore: false }),
    }
  }

  async get(fileId: string): Promise<ProviderFileObject> {
    const data = await this.request<RawBailianResponse<RawBailianFile>>(
      `/files/${encodeURIComponent(requireFileId(fileId))}`,
    )
    return normalizeBailianFile(data.data)
  }

  async delete(fileId: string): Promise<{ deleted: boolean; id: string }> {
    const id = requireFileId(fileId)
    await this.request<RawBailianResponse<unknown>>(`/files/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return { deleted: true, id }
  }

  async upload(input: {
    filePath: string
    purpose: BailianFilePurpose
    description?: string
  }): Promise<ProviderFileObject> {
    const filePath = input.filePath.trim()
    if (!filePath) throw new MediaProviderError('invalid_input', '百炼 Files 需要本地文件路径')
    const info = await (this.options.stat ?? stat)(filePath)
    if (!info.isFile())
      throw new MediaProviderError('invalid_input', `选择的路径不是文件：${filePath}`)
    const maxBytes = maxBytesForPurpose(input.purpose, filePath)
    if (info.size > maxBytes) {
      throw new MediaProviderError(
        'invalid_input',
        `百炼 Files ${input.purpose} 单文件上限为 ${formatBytes(maxBytes)}；图像/视频模型微调 ZIP 的 1 GiB 特例请确认后使用。`,
      )
    }
    const form = new FormData()
    form.append(
      'files',
      await (this.options.openAsBlob ?? openAsBlob)(filePath),
      path.basename(filePath),
    )
    form.append('purpose', input.purpose)
    if (input.description?.trim()) form.append('descriptions', input.description.trim())
    const result = await this.request<
      RawBailianResponse<{
        uploaded_files?: RawBailianFile[]
        failed_uploads?: Array<{ name?: string; code?: string; message?: string }>
      }>
    >('/files', { method: 'POST', body: form }, 300_000)
    const failed = result.data?.failed_uploads?.[0]
    const uploaded = result.data?.uploaded_files?.[0]
    if (!uploaded?.file_id) {
      const detail = [failed?.code, failed?.message].filter(Boolean).join('：')
      throw new MediaProviderError(
        'provider_http_error',
        `百炼 Files 未返回上传成功的文件${detail ? `（${detail}）` : ''}${requestIdSuffix(result.request_id)}`,
      )
    }
    return normalizeBailianFile({ ...uploaded, purpose: input.purpose })
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
          accept: 'application/json',
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
          ? `百炼 Files 请求超时（${Math.ceil(timeoutMs / 1_000)} 秒）`
          : `百炼 Files 网络请求失败：${detail}`,
      )
    }
    const text = await response.text()
    const parsed = parseJson<RawBailianResponse<unknown>>(text)
    const errorDetail = parsed
      ? [parsed.code, parsed.message].filter(Boolean).join('：')
      : text.slice(0, 800)
    if (!response.ok) {
      throw new MediaProviderError(
        'provider_http_error',
        `百炼 Files HTTP ${response.status}${errorDetail ? `：${errorDetail}` : ''}${requestIdSuffix(parsed?.request_id)}`,
        response.status,
      )
    }
    if (!parsed) {
      throw new MediaProviderError(
        'provider_http_error',
        `百炼 Files 返回了无效 JSON：${text.slice(0, 800)}`,
      )
    }
    if (parsed.code || parsed.message) {
      throw new MediaProviderError(
        'provider_http_error',
        `百炼 Files 请求失败：${[parsed.code, parsed.message].filter(Boolean).join('：')}${requestIdSuffix(parsed.request_id)}`,
      )
    }
    return parsed as T
  }
}

function normalizeBailianFile(raw: RawBailianFile | undefined): ProviderFileObject {
  const id = raw?.file_id?.trim() ?? ''
  if (!id) throw new MediaProviderError('provider_http_error', '百炼 Files 响应缺少 file_id')
  return {
    id,
    filename: raw?.name?.trim() || id,
    bytes: nonNegativeInteger(raw?.size, 0),
    createdAt: parseCreatedAt(raw?.gmt_create),
    purpose: raw?.purpose?.trim() || 'unknown',
    object: 'file',
    providerKind: 'bailian',
  }
}

function requireFileId(fileId: string): string {
  const value = fileId.trim()
  if (!value) throw new MediaProviderError('invalid_input', '百炼 file_id 不能为空')
  return value
}

function parseCreatedAt(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0
  const timestamp = Date.parse(value.replace(' ', 'T'))
  return Number.isFinite(timestamp) ? timestamp : 0
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

function parseJson<T>(value: string): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

function requestIdSuffix(requestId: string | undefined): string {
  return requestId ? `（RequestId: ${requestId}）` : ''
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MiB`
}

function maxBytesForPurpose(purpose: BailianFilePurpose, filePath: string): number {
  if (purpose !== 'fine-tune') return MAX_FILE_BYTES_BY_PURPOSE[purpose]
  // 百炼仅对图像/视频微调数据的 ZIP 明确给出 1 GiB 特例；普通微调文件仍为 300 MiB。
  return path.extname(filePath).toLowerCase() === '.zip'
    ? MAX_FILE_BYTES_BY_PURPOSE[purpose]
    : 300 * 1024 * 1024
}

import type {
  VideoChannelTask,
  VideoChannelTaskDeleteResponse,
  VideoChannelTasksListRequest,
  VideoChannelTasksListResponse,
  VideoChannelTaskStatus,
} from '@spark/protocol'
import { fetchJson } from './media-http.util.js'
import { MediaProviderError } from './media-adapter.types.js'

export const MINIMAX_VIDEO_TASKS_DEFAULT_BASE_URL = 'https://api.minimaxi.com'

type RawMinimaxV2Task = Record<string, unknown>

type RawMinimaxV2ListResponse = {
  items?: unknown
  total?: unknown
}

type RawMinimaxV2DetailResponse = {
  task?: unknown
}

type RawMinimaxV1TaskResponse = Record<string, unknown>

export function resolveMinimaxVideoTasksBaseUrl(apiEndpoint?: string): string {
  const value = apiEndpoint?.trim()
  if (!value) return MINIMAX_VIDEO_TASKS_DEFAULT_BASE_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('unsupported protocol')
    if (url.hostname.toLowerCase() !== 'api.minimaxi.com') throw new Error('unsupported hostname')
    return url.origin
  } catch {
    throw new MediaProviderError(
      'invalid_input',
      `MiniMax Endpoint 无效，需使用官方 api.minimaxi.com 域名：${value}`,
    )
  }
}

export class MinimaxVideoTaskClient {
  readonly kind = 'minimax-hailuo' as const
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(
    private readonly options: {
      apiKey: string
      apiEndpoint?: string
      fetch?: typeof fetch
      timeoutMs?: number
    },
  ) {
    if (!options.apiKey.trim())
      throw new MediaProviderError('api_key_missing', 'MiniMax API Key 未配置')
    this.baseUrl = resolveMinimaxVideoTasksBaseUrl(options.apiEndpoint)
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = Math.max(3_000, options.timeoutMs ?? 30_000)
  }

  async list(request: VideoChannelTasksListRequest): Promise<VideoChannelTasksListResponse> {
    const pageNum = Math.max(1, Math.floor(request.pageNum ?? 1))
    const pageSize = Math.max(1, Math.min(100, Math.floor(request.pageSize ?? 20)))
    const query = new URLSearchParams({ page_num: String(pageNum), page_size: String(pageSize) })
    if (request.status) query.set('filter.status', toMinimaxStatus(request.status))
    if (request.model?.trim()) query.set('filter.model', request.model.trim())
    for (const taskId of request.taskIds ?? []) {
      if (taskId.trim()) query.append('filter.task_ids', taskId.trim())
    }

    const raw = await this.request<RawMinimaxV2ListResponse>(
      `/v2/query/video_generation?${query.toString()}`,
    )
    const tasks = asArray(raw.items)
      .map((item) => normalizeV2Task(item, request.providerProfileId, request.model))
      .filter((item): item is VideoChannelTask => item != null)
    const total = numberValue(raw.total)
    return {
      providerKind: this.kind,
      providerProfileId: request.providerProfileId,
      providerName: request.providerProfileId,
      tasks,
      pageNum,
      pageSize,
      ...(total !== undefined ? { hasMore: pageNum * pageSize < total } : {}),
    }
  }

  async get(
    taskId: string,
    context: Omit<VideoChannelTasksListRequest, 'pageNum' | 'pageSize'>,
  ): Promise<VideoChannelTask> {
    const id = requireTaskId(taskId)
    try {
      const raw = await this.request<RawMinimaxV2DetailResponse>(
        `/v2/query/video_generation/${encodeURIComponent(id)}`,
      )
      const task = normalizeV2Task(asRecord(raw.task), context.providerProfileId, context.model)
      if (!task)
        throw new MediaProviderError('provider_http_error', `MiniMax 任务 ${id} 响应缺少任务 ID`)
      return task
    } catch (error) {
      // Hailuo 2.3 等旧版任务没有 V2 详情接口，兼容官方历史查询接口。
      if (!(error instanceof MediaProviderError) || ![400, 404].includes(error.statusCode ?? 0))
        throw error
      const legacy = await this.request<RawMinimaxV1TaskResponse>(
        `/v1/query/video_generation?task_id=${encodeURIComponent(id)}`,
      )
      const task = normalizeV1Task(legacy, context.providerProfileId, context.model)
      if (!task)
        throw new MediaProviderError('provider_http_error', `MiniMax 任务 ${id} 响应缺少任务 ID`)
      return task
    }
  }

  async delete(
    taskId: string,
    _providerProfileId: string,
  ): Promise<VideoChannelTaskDeleteResponse> {
    const id = requireTaskId(taskId)
    const raw = await this.request<Record<string, unknown> | null>(
      `/v2/video_generation/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    )
    const action = stringValue(raw?.action) ?? stringValue(raw?.status)
    return {
      deleted: true,
      id,
      ...(action?.toLowerCase() === 'cancelled' || action?.toLowerCase() === 'canceled'
        ? { action: 'cancelled' as const }
        : { action: 'deleted' as const }),
    }
  }

  private request<T>(path: string, init: { method?: string } = {}): Promise<T> {
    return fetchJson<T>(`${this.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        accept: 'application/json',
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      errorExtractor: minimaxVideoTaskErrorExtractor,
    })
  }
}

function normalizeV2Task(
  raw: RawMinimaxV2Task | undefined,
  providerProfileId: string,
  fallbackModel?: string,
): VideoChannelTask | null {
  if (!raw) return null
  const id = stringValue(raw.id)
  if (!id) return null
  const content = asRecord(raw.content)
  const error = asRecord(raw.error)
  const usage = asRecord(raw.usage)
  const rawStatus = stringValue(raw.status)
  const model = stringValue(raw.model) ?? fallbackModel
  const videoUrl = stringValue(content?.url) ?? stringValue(content?.video_url)
  const duration = numberValue(raw.duration)
  const resolution = stringValue(raw.resolution)
  const ratio = stringValue(raw.ratio)
  const errorCode = stringValue(error?.code)
  const errorMessage = stringValue(error?.message)
  const createdAt = timestampValue(raw.created_at)
  const updatedAt = timestampValue(raw.updated_at)
  const completionTokens = numberValue(usage?.output_tokens)
  const totalTokens = numberValue(usage?.total_tokens)
  return {
    id,
    providerKind: 'minimax-hailuo',
    providerProfileId,
    providerName: providerProfileId,
    ...(model ? { model } : {}),
    status: normalizeV2Status(rawStatus),
    ...(rawStatus ? { rawStatus } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(resolution ? { resolution } : {}),
    ...(ratio ? { ratio } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(errorCode || errorMessage
      ? {
          error: {
            ...(errorCode ? { code: errorCode } : {}),
            ...(errorMessage ? { message: errorMessage } : {}),
          },
        }
      : {}),
    ...(completionTokens !== undefined || totalTokens !== undefined
      ? {
          usage: {
            ...(completionTokens !== undefined ? { completionTokens } : {}),
            ...(totalTokens !== undefined ? { totalTokens } : {}),
          },
        }
      : {}),
  }
}

function normalizeV1Task(
  raw: RawMinimaxV1TaskResponse,
  providerProfileId: string,
  fallbackModel?: string,
): VideoChannelTask | null {
  const id = stringValue(raw.task_id)
  if (!id) return null
  const width = numberValue(raw.video_width)
  const height = numberValue(raw.video_height)
  const rawStatus = stringValue(raw.status)
  const baseResp = asRecord(raw.base_resp)
  const errorCode = stringValue(baseResp?.status_code)
  const errorMessage = stringValue(baseResp?.status_msg)
  return {
    id,
    providerKind: 'minimax-hailuo',
    providerProfileId,
    providerName: providerProfileId,
    ...(fallbackModel ? { model: fallbackModel } : {}),
    status: normalizeV1Status(rawStatus),
    ...(rawStatus ? { rawStatus } : {}),
    ...(width !== undefined && height !== undefined ? { resolution: `${width}×${height}` } : {}),
    ...((errorCode && errorCode !== '0') ||
    (errorMessage && errorMessage.toLowerCase() !== 'success')
      ? {
          error: {
            ...(errorCode ? { code: errorCode } : {}),
            ...(errorMessage ? { message: errorMessage } : {}),
          },
        }
      : {}),
  }
}

function toMinimaxStatus(status: Exclude<VideoChannelTaskStatus, 'unknown'>): string {
  if (status === 'expired') {
    throw new MediaProviderError('invalid_input', 'MiniMax V2 不支持按已过期状态筛选任务')
  }
  if (status === 'submitted' || status === 'queued') return 'queued'
  if (status === 'running') return 'running'
  if (status === 'succeeded') return 'succeeded'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  return status
}

function normalizeV2Status(value: string | undefined): VideoChannelTaskStatus {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled'
  )
    return value
  return 'unknown'
}

function normalizeV1Status(value: string | undefined): VideoChannelTaskStatus {
  if (value === 'Preparing') return 'submitted'
  if (value === 'Queueing') return 'queued'
  if (value === 'Processing') return 'running'
  if (value === 'Success') return 'succeeded'
  if (value === 'Fail') return 'failed'
  return 'unknown'
}

function requireTaskId(value: string): string {
  const id = value.trim()
  if (!id || id.length > 300) throw new MediaProviderError('invalid_input', '视频任务 ID 无效')
  return id
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asArray(value: unknown): RawMinimaxV2Task[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawMinimaxV2Task => asRecord(item) != null)
    : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}

export function minimaxVideoTaskErrorExtractor(status: number, body: unknown): string | undefined {
  const root = asRecord(body)
  const error = asRecord(root?.error)
  const baseResp = asRecord(root?.base_resp)
  const code =
    stringValue(error?.code) ?? stringValue(root?.code) ?? stringValue(baseResp?.status_code)
  const message =
    stringValue(error?.message) ?? stringValue(root?.message) ?? stringValue(baseResp?.status_msg)
  const requestId = stringValue(root?.request_id) ?? stringValue(root?.requestId)
  if (!code && !message) return undefined
  return `${code ? `MiniMax ${code}` : `MiniMax HTTP ${status}`}: ${message ?? '请求失败'}${requestId ? `（RequestId: ${requestId}）` : ''}`
}

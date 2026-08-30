import type {
  VideoChannelTask,
  VideoChannelTaskStatus,
  VideoChannelTaskDeleteResponse,
  VideoChannelTasksListRequest,
  VideoChannelTasksListResponse,
} from '@spark/protocol'
import { resolveVideoChannelTaskProviderKind } from '@spark/protocol'
import { fetchJson } from './media-http.util.js'
import { MediaProviderError } from './media-adapter.types.js'

export const BAILIAN_VIDEO_TASKS_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'

type RawBailianTask = Record<string, unknown>

type RawBailianTaskListResponse = {
  data?: unknown
  page_no?: unknown
  page_size?: unknown
  total_page?: unknown
}

type RawBailianTaskDetailResponse = RawBailianTask & {
  output?: unknown
}

export function resolveBailianVideoTasksBaseUrl(apiEndpoint?: string): string {
  const value = apiEndpoint?.trim()
  if (!value) return BAILIAN_VIDEO_TASKS_DEFAULT_BASE_URL
  try {
    const url = new URL(value)
    if (resolveVideoChannelTaskProviderKind(url.toString()) !== 'bailian') {
      throw new Error('unsupported hostname')
    }
    return `${url.origin}/api/v1`
  } catch {
    throw new MediaProviderError(
      'invalid_input',
      `阿里云百炼 Endpoint 无效，需使用 dashscope.aliyuncs.com 或官方 maas.aliyuncs.com 域名：${value}`,
    )
  }
}

export class BailianVideoTaskClient {
  readonly kind = 'bailian' as const
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
      throw new MediaProviderError('api_key_missing', '阿里云百炼 API Key 未配置')
    this.baseUrl = resolveBailianVideoTasksBaseUrl(options.apiEndpoint)
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = Math.max(3_000, options.timeoutMs ?? 30_000)
  }

  async list(request: VideoChannelTasksListRequest): Promise<VideoChannelTasksListResponse> {
    const pageNum = Math.max(1, Math.floor(request.pageNum ?? 1))
    const pageSize = Math.max(1, Math.min(100, Math.floor(request.pageSize ?? 20)))
    const query = new URLSearchParams({ page_no: String(pageNum), page_size: String(pageSize) })
    if (request.status) query.set('status', toBailianStatus(request.status))
    if (request.model?.trim()) query.set('model_name', request.model.trim())
    const taskId = request.taskIds?.find((value) => value.trim())?.trim()
    if (taskId) query.set('task_id', taskId)

    const raw = await this.request<RawBailianTaskListResponse>(`/tasks/?${query.toString()}`)
    const tasks = asArray(raw.data)
      .map((item) => normalizeBailianTask(item, request.providerProfileId))
      .filter((item): item is VideoChannelTask => item != null)
    const resolvedPageNum = positiveInteger(raw.page_no, pageNum) ?? pageNum
    const resolvedPageSize = positiveInteger(raw.page_size, pageSize) ?? pageSize
    const totalPage = positiveInteger(raw.total_page, undefined)
    return {
      providerKind: this.kind,
      providerProfileId: request.providerProfileId,
      providerName: request.providerProfileId,
      tasks,
      pageNum: resolvedPageNum,
      pageSize: resolvedPageSize,
      ...(totalPage !== undefined ? { hasMore: resolvedPageNum < totalPage } : {}),
    }
  }

  async get(
    taskId: string,
    context: Omit<VideoChannelTasksListRequest, 'pageNum' | 'pageSize'>,
  ): Promise<VideoChannelTask> {
    const id = requireTaskId(taskId)
    const raw = await this.request<RawBailianTaskDetailResponse>(`/tasks/${encodeURIComponent(id)}`)
    const task = normalizeBailianTask(raw, context.providerProfileId)
    if (!task) throw new MediaProviderError('provider_http_error', `百炼任务 ${id} 响应缺少任务 ID`)
    return task
  }

  async delete(
    taskId: string,
    _providerProfileId: string,
  ): Promise<VideoChannelTaskDeleteResponse> {
    const id = requireTaskId(taskId)
    await this.request<unknown>(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
    return { deleted: true, id, action: 'cancelled' }
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
      errorExtractor: bailianVideoTaskErrorExtractor,
    })
  }
}

function normalizeBailianTask(
  raw: RawBailianTask,
  providerProfileId: string,
): VideoChannelTask | null {
  const output = asRecord(raw.output) ?? raw
  const id = stringValue(raw.task_id) ?? stringValue(output.task_id)
  if (!id) return null
  const rawStatus = stringValue(raw.status) ?? stringValue(output.task_status)
  const model = stringValue(raw.model_name) ?? stringValue(output.model_name)
  const code = stringValue(raw.code) ?? stringValue(output.code)
  const message = stringValue(raw.message) ?? stringValue(output.message)
  const usage = asRecord(raw.usage) ?? asRecord(output.usage)
  const videoUrl =
    stringValue(output.video_url) ??
    asArray(output.results)
      .map((result) => stringValue(result.url))
      .find((url): url is string => url != null)
  const duration = numberValue(usage?.duration ?? usage?.output_video_duration)
  const fps = numberValue(usage?.fps)
  const status = normalizeStatus(rawStatus)
  const createdAt = timestampValue(
    raw.gmt_create ?? raw.submit_time ?? output.submit_time ?? output.create_time,
  )
  const updatedAt = timestampValue(raw.end_time ?? output.end_time)
  return {
    id,
    providerKind: 'bailian',
    providerProfileId,
    providerName: providerProfileId,
    ...(model ? { model } : {}),
    status,
    ...(rawStatus ? { rawStatus } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(fps !== undefined ? { framesPerSecond: fps } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(code || message
      ? {
          error: {
            ...(code ? { code } : {}),
            ...(message ? { message } : {}),
          },
        }
      : {}),
  }
}

function toBailianStatus(status: Exclude<VideoChannelTaskStatus, 'unknown'>): string {
  if (status === 'expired') {
    throw new MediaProviderError('invalid_input', '阿里云百炼不支持按已过期状态筛选任务')
  }
  if (status === 'queued' || status === 'submitted') return 'PENDING'
  if (status === 'running') return 'RUNNING'
  if (status === 'succeeded') return 'SUCCEEDED'
  if (status === 'failed') return 'FAILED'
  if (status === 'cancelled') return 'CANCELED'
  return String(status).toUpperCase()
}

function normalizeStatus(value: string | undefined): VideoChannelTaskStatus {
  if (value === 'PENDING') return 'queued'
  if (value === 'RUNNING') return 'running'
  if (value === 'SUCCEEDED') return 'succeeded'
  if (value === 'FAILED') return 'failed'
  if (value === 'CANCELED' || value === 'CANCELLED') return 'cancelled'
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

function asArray(value: unknown): RawBailianTask[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawBailianTask => asRecord(item) != null)
    : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveInteger(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}

export function bailianVideoTaskErrorExtractor(status: number, body: unknown): string | undefined {
  const root = asRecord(body)
  const output = asRecord(root?.output)
  const code = stringValue(root?.code) ?? stringValue(output?.code)
  const message = stringValue(root?.message) ?? stringValue(output?.message)
  const requestId = stringValue(root?.request_id) ?? stringValue(root?.requestId)
  if (!code && !message) return undefined
  return `${code ? `Bailian ${code}` : `Bailian HTTP ${status}`}: ${message ?? '请求失败'}${requestId ? `（RequestId: ${requestId}）` : ''}`
}

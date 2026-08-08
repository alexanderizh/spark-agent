import type {
  VideoChannelTask,
  VideoChannelTaskProviderKind,
  VideoChannelTaskStatus,
  VideoChannelTasksListRequest,
  VideoChannelTasksListResponse,
  VideoChannelTaskDeleteResponse,
} from '@spark/protocol'
import { fetchJson } from './media-http.util.js'
import { MediaProviderError } from './media-adapter.types.js'

export const VOLCENGINE_ARK_VIDEO_TASKS_DEFAULT_BASE_URL =
  'https://ark.cn-beijing.volces.com/api/v3'

export interface VideoChannelTaskProvider {
  readonly kind: VideoChannelTaskProviderKind
  list(request: VideoChannelTasksListRequest): Promise<VideoChannelTasksListResponse>
  get(
    taskId: string,
    context: Omit<VideoChannelTasksListRequest, 'pageNum' | 'pageSize'>,
  ): Promise<VideoChannelTask>
  delete(taskId: string, providerProfileId: string): Promise<VideoChannelTaskDeleteResponse>
}

type RawVideoTask = {
  id?: unknown
  model?: unknown
  status?: unknown
  content?: unknown
  error?: unknown
  resolution?: unknown
  ratio?: unknown
  duration?: unknown
  framespersecond?: unknown
  fps?: unknown
  generate_audio?: unknown
  created_at?: unknown
  updated_at?: unknown
  usage?: unknown
}

type RawVideoTaskList = {
  data?: unknown
  has_more?: unknown
}

export function resolveVolcengineArkVideoTasksBaseUrl(apiEndpoint?: string): string {
  const value = apiEndpoint?.trim()
  if (!value) return VOLCENGINE_ARK_VIDEO_TASKS_DEFAULT_BASE_URL
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') throw new Error('unsupported protocol')
    const pathname = url.pathname.replace(/\/+$/, '')
    // 火山聊天、Coding Plan 和多媒体可能共用一个 Provider。视频任务固定走
    // 官方 /api/v3，避免把请求误发到 /api/coding/v3。
    if (/\/api\/v3$/i.test(pathname)) return `${url.origin}${pathname}`
    return `${url.origin}/api/v3`
  } catch {
    throw new MediaProviderError('invalid_input', `火山方舟 Endpoint 无效：${value}`)
  }
}

export class VolcengineArkVideoTaskClient implements VideoChannelTaskProvider {
  readonly kind = 'volcengine-ark' as const
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
      throw new MediaProviderError('api_key_missing', '火山方舟 API Key 未配置')
    this.baseUrl = resolveVolcengineArkVideoTasksBaseUrl(options.apiEndpoint)
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = Math.max(3_000, options.timeoutMs ?? 30_000)
  }

  async list(request: VideoChannelTasksListRequest): Promise<VideoChannelTasksListResponse> {
    const pageNum = Math.max(1, request.pageNum ?? 1)
    const pageSize = Math.max(1, Math.min(100, request.pageSize ?? 20))
    const query = new URLSearchParams({ page_num: String(pageNum), page_size: String(pageSize) })
    if (request.status) query.set('filter.status', request.status)
    if (request.model?.trim()) query.set('filter.model', request.model.trim())
    for (const taskId of request.taskIds ?? []) {
      if (taskId.trim()) query.append('filter.task_ids', taskId.trim())
    }

    const raw = await this.request<RawVideoTaskList | RawVideoTask[] | null>(
      `/contents/generations/tasks?${query.toString()}`,
    )
    const data = Array.isArray(raw) ? raw : asArray(raw?.data)
    const tasks = data
      .map((item) => normalizeVideoTask(item, request.providerProfileId, request.providerProfileId))
      .filter((item): item is VideoChannelTask => item != null)
    const rawHasMore =
      !Array.isArray(raw) && typeof raw?.has_more === 'boolean' ? raw.has_more : undefined
    return {
      providerKind: this.kind,
      providerProfileId: request.providerProfileId,
      providerName: request.providerProfileId,
      tasks,
      pageNum,
      pageSize,
      ...(rawHasMore !== undefined ? { hasMore: rawHasMore } : {}),
    }
  }

  async get(
    taskId: string,
    context: Omit<VideoChannelTasksListRequest, 'pageNum' | 'pageSize'>,
  ): Promise<VideoChannelTask> {
    const id = requireTaskId(taskId)
    const raw = await this.request<RawVideoTask>(
      `/contents/generations/tasks/${encodeURIComponent(id)}`,
    )
    const task = normalizeVideoTask(raw, context.providerProfileId, context.providerProfileId)
    if (!task)
      throw new MediaProviderError('provider_http_error', `火山方舟任务 ${id} 响应缺少任务 ID`)
    return task
  }

  async delete(
    taskId: string,
    _providerProfileId: string,
  ): Promise<VideoChannelTaskDeleteResponse> {
    const id = requireTaskId(taskId)
    await this.request<null>(`/contents/generations/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    return { deleted: true, id }
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
      errorExtractor: volcengineVideoTaskErrorExtractor,
    })
  }
}

function normalizeVideoTask(
  raw: RawVideoTask,
  providerProfileId: string,
  providerName: string,
): VideoChannelTask | null {
  const id = stringValue(raw.id)
  if (!id) return null
  const content = asRecord(raw.content)
  const error = asRecord(raw.error)
  const usage = asRecord(raw.usage)
  const rawStatus = stringValue(raw.status)
  const status = normalizeStatus(rawStatus)
  const model = stringValue(raw.model)
  const duration = numberValue(raw.duration)
  const fps = numberValue(raw.framespersecond ?? raw.fps)
  const createdAt = timestampValue(raw.created_at)
  const updatedAt = timestampValue(raw.updated_at)
  const errorCode = stringValue(error?.code) ?? stringValue(error?.Code)
  const errorMessage = stringValue(error?.message) ?? stringValue(error?.Message)
  const completionTokens = numberValue(usage?.completion_tokens)
  const totalTokens = numberValue(usage?.total_tokens)
  const videoUrl = stringValue(content?.video_url)
  const lastFrameUrl = stringValue(content?.last_frame_url)
  const resolution = stringValue(raw.resolution)
  const ratio = stringValue(raw.ratio)
  return {
    id,
    providerKind: 'volcengine-ark',
    providerProfileId,
    providerName,
    ...(model ? { model } : {}),
    status,
    ...(rawStatus ? { rawStatus } : {}),
    ...(videoUrl ? { videoUrl } : {}),
    ...(lastFrameUrl ? { lastFrameUrl } : {}),
    ...(resolution ? { resolution } : {}),
    ...(ratio ? { ratio } : {}),
    ...(duration !== undefined ? { durationSeconds: duration } : {}),
    ...(fps !== undefined ? { framesPerSecond: fps } : {}),
    ...(typeof raw.generate_audio === 'boolean' ? { generateAudio: raw.generate_audio } : {}),
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

function normalizeStatus(value: string | undefined): VideoChannelTaskStatus {
  if (
    value === 'submitted' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'expired' ||
    value === 'cancelled'
  )
    return value
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

function asArray(value: unknown): RawVideoTask[] {
  return Array.isArray(value)
    ? value.filter((item): item is RawVideoTask => asRecord(item) != null)
    : []
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function timestampValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value))
    return new Date(value * 1000).toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}

export function volcengineVideoTaskErrorExtractor(
  status: number,
  body: unknown,
): string | undefined {
  const root = asRecord(body)
  const error = asRecord(root?.error)
  const code = stringValue(error?.code) ?? stringValue(error?.Code)
  const message = stringValue(error?.message) ?? stringValue(error?.Message)
  const requestId =
    stringValue(root?.RequestId) ?? stringValue(root?.request_id) ?? stringValue(root?.requestId)
  if (!code && !message) return undefined
  return `${code ? `Volcengine ${code}` : `Volcengine HTTP ${status}`}: ${message ?? '请求失败'}${requestId ? `（RequestId: ${requestId}）` : ''}`
}

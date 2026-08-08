import { z } from 'zod'

/**
 * 渠道视频任务查询的公共契约。
 *
 * 页面只消费归一后的字段；各渠道的原始响应、鉴权和 URL 拼接留在主进程
 * 的 provider client 中，后续新增渠道只需要实现同一组 list/get/delete 操作。
 */
export const VideoChannelTaskProviderKindSchema = z.enum([
  'volcengine-ark',
  'bailian',
  'minimax-hailuo',
])
export type VideoChannelTaskProviderKind = z.infer<typeof VideoChannelTaskProviderKindSchema>

/**
 * 根据 Provider 的基础 Endpoint 主机名识别任务渠道。
 * 代理地址或请求参数里的官方域名不会被当成官方渠道。
 */
export function resolveVideoChannelTaskProviderKind(
  endpoint?: string | null,
): VideoChannelTaskProviderKind | null {
  if (!endpoint?.trim()) return null
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:') return null
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'ark.cn-beijing.volces.com') return 'volcengine-ark'
    if (
      hostname === 'dashscope.aliyuncs.com' ||
      /^[a-z0-9-]+\.[a-z0-9-]+\.maas\.aliyuncs\.com$/.test(hostname)
    ) {
      return 'bailian'
    }
    if (hostname === 'api.minimaxi.com') return 'minimax-hailuo'
    return null
  } catch {
    return null
  }
}

/**
 * 判断 Provider 是否有当前任务页可用的列表接口。
 * MiniMax 的 V2 列表接口对应 H3；Hailuo V1 和 Video Agent 只有独立查询接口，
 * 不能伪装成同一个分页任务列表展示。
 */
export function isVideoChannelTaskQueryableProvider(
  profile: { defaultModel?: string; modelIds?: readonly string[] },
  endpoint?: string | null,
): boolean {
  const kind = resolveVideoChannelTaskProviderKind(endpoint)
  if (!kind) return false
  if (kind !== 'minimax-hailuo') return true
  return profile.defaultModel === 'MiniMax-H3' || profile.modelIds?.includes('MiniMax-H3') === true
}

export function isVideoChannelTaskStatusSupported(
  providerKind: VideoChannelTaskProviderKind,
  status: Exclude<VideoChannelTaskStatus, 'unknown'>,
): boolean {
  if (providerKind === 'bailian' || providerKind === 'minimax-hailuo') {
    return status !== 'expired'
  }
  return true
}

export function isOfficialVolcengineArkEndpoint(endpoint?: string | null): boolean {
  return resolveVideoChannelTaskProviderKind(endpoint) === 'volcengine-ark'
}

export function isOfficialBailianEndpoint(endpoint?: string | null): boolean {
  return resolveVideoChannelTaskProviderKind(endpoint) === 'bailian'
}

export function isOfficialMinimaxEndpoint(endpoint?: string | null): boolean {
  return resolveVideoChannelTaskProviderKind(endpoint) === 'minimax-hailuo'
}

export const VideoChannelTaskStatusSchema = z.enum([
  'submitted',
  'queued',
  'running',
  'succeeded',
  'failed',
  'expired',
  'cancelled',
  'unknown',
])
export type VideoChannelTaskStatus = z.infer<typeof VideoChannelTaskStatusSchema>

export interface VideoChannelTaskError {
  code?: string
  message?: string
}

export interface VideoChannelTaskUsage {
  completionTokens?: number
  totalTokens?: number
}

export interface VideoChannelTask {
  id: string
  providerKind: VideoChannelTaskProviderKind
  providerProfileId: string
  providerName: string
  model?: string
  status: VideoChannelTaskStatus
  rawStatus?: string
  videoUrl?: string
  lastFrameUrl?: string
  resolution?: string
  ratio?: string
  durationSeconds?: number
  framesPerSecond?: number
  generateAudio?: boolean
  createdAt?: string
  updatedAt?: string
  error?: VideoChannelTaskError
  usage?: VideoChannelTaskUsage
}

export interface VideoChannelTasksListRequest {
  providerProfileId: string
  pageNum?: number
  pageSize?: number
  status?: Exclude<VideoChannelTaskStatus, 'unknown'>
  model?: string
  taskIds?: string[]
}

export interface VideoChannelTasksListResponse {
  providerKind: VideoChannelTaskProviderKind
  providerProfileId: string
  providerName: string
  tasks: VideoChannelTask[]
  pageNum: number
  pageSize: number
  hasMore?: boolean
}

export interface VideoChannelTaskGetRequest {
  providerProfileId: string
  taskId: string
}

export interface VideoChannelTaskGetResponse {
  providerKind: VideoChannelTaskProviderKind
  task: VideoChannelTask
}

export interface VideoChannelTaskDeleteRequest {
  providerProfileId: string
  taskId: string
}

export interface VideoChannelTaskDeleteResponse {
  deleted: true
  id: string
  /** 百炼没有删除接口，删除操作在其任务 API 中对应取消排队任务。 */
  action?: 'deleted' | 'cancelled'
}

export interface VideoChannelTasksIpcChannelMap {
  'canvas:video-tasks:list': [VideoChannelTasksListRequest, VideoChannelTasksListResponse]
  'canvas:video-tasks:get': [VideoChannelTaskGetRequest, VideoChannelTaskGetResponse]
  'canvas:video-tasks:delete': [VideoChannelTaskDeleteRequest, VideoChannelTaskDeleteResponse]
}

const ProviderProfileIdSchema = z.string().trim().min(1).max(200)
const VideoTaskIdSchema = z.string().trim().min(1).max(300)

export const VideoChannelTasksIpcSchemaRegistry = {
  'canvas:video-tasks:list': z.object({
    providerProfileId: ProviderProfileIdSchema,
    pageNum: z.number().int().min(1).max(10_000).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    status: VideoChannelTaskStatusSchema.exclude(['unknown']).optional(),
    model: z.string().trim().max(200).optional(),
    taskIds: z.array(VideoTaskIdSchema).max(20).optional(),
  }),
  'canvas:video-tasks:get': z.object({
    providerProfileId: ProviderProfileIdSchema,
    taskId: VideoTaskIdSchema,
  }),
  'canvas:video-tasks:delete': z.object({
    providerProfileId: ProviderProfileIdSchema,
    taskId: VideoTaskIdSchema,
  }),
} as const

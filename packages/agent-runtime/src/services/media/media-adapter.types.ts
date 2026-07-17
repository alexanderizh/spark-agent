/**
 * @module media-adapter.types
 *
 * 统一多媒体 provider adapter 接口。
 * 见 docs/multimedia-model-platform-adapters-design.md §6。
 *
 * 设计要点：
 *   - adapter 接口同时服务于 spark_media MCP 与无限画布 canvas media runtime，
 *     避免图片/语音/视频 provider 适配逻辑分叉。
 *   - 异步任务（VEO / Sora / xAI video）的差异封装在 adapter 内部，
 *     调用方只关心最终的 assets 列表。
 */

import type {
  CanvasOperationType,
  MediaApiType,
  MediaCapabilityId,
  MediaContractIssue,
  MediaContractWarning,
  MediaDroppedParam,
  MediaErrorContract,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaNormalizedErrorCode,
  MediaProviderKind,
  MediaRequestCall,
  MediaInputMetadata,
  ProviderMediaDefaults,
} from '@spark/protocol'
import type { MediaUploader } from './media-uploader.js'

/** adapter 调用上下文：由 router 从 ProviderProfile + keystore 解析后注入 */
export interface MediaProviderContext {
  apiKey: string
  apiEndpoint: string
  defaultModel: string
  modelIds?: string[]
  mediaProvider: MediaProviderKind
  mediaApiType: MediaApiType
  mediaDefaults?: ProviderMediaDefaults
  /** 当前调用命中的 manifest；存在时 adapter 可按 requestTemplate/response 组装调用。 */
  mediaManifest?: MediaModelManifest
  /** 当前 capability 在 manifest 中的配置。 */
  mediaManifestCapability?: MediaModelCapabilityManifest
  /** 透传的 provider-level extra params（来自 modelParams 的非标量字段） */
  extraParams?: Record<string, unknown>
  /** 用户已确认画布参数预校验提醒；适配器不得重复阻断同一类参数问题。 */
  skipParameterValidation?: boolean
  /** 可注入的 fetch（测试用 mock）；缺省走全局 fetch */
  fetch?: typeof fetch
  /** 桌面主进程可注入的 Spark 公开文件上传回退；agent-runtime 不反向依赖 desktop。 */
  fallbackUploader?: MediaUploader
  /** 轮询任务拿到渠道任务 ID 后立即上报提交响应，不必等待最终产物。 */
  onTaskSubmitted?: (submission: MediaTaskSubmission) => void
}

export interface MediaTaskSubmission {
  requestId: string
  response: unknown
  /** Router 捕获的提交 HTTP 请求/响应摘要。 */
  requestCall?: MediaRequestCall
}

export type MediaArtifactType = 'image' | 'audio' | 'video' | 'text'

export interface MediaInputFile extends MediaInputMetadata {
  fileId?: string
  path?: string
  url?: string
  dataUrl?: string
  mimeType?: string
  type: 'image' | 'audio' | 'video' | 'file'
  role?: 'input' | 'first_frame' | 'last_frame' | 'reference' | 'mask'
}

export interface MediaGenerateInput {
  operation: CanvasOperationType
  /** 所需能力；缺省时由 router 按 operation 推导 */
  capability?: MediaCapabilityId | undefined
  prompt?: string | undefined
  negativePrompt?: string | undefined
  inputFiles?: MediaInputFile[] | undefined
  modelParams?: Record<string, unknown> | undefined
  /** 产物落盘根目录（adapter 按 capability 分子目录） */
  outputDir: string
}

export interface MediaGeneratedAsset {
  type: MediaArtifactType
  filePath?: string | undefined
  url?: string | undefined
  mimeType?: string | undefined
  width?: number | undefined
  height?: number | undefined
  durationMs?: number | undefined
  contentText?: string | undefined
  raw?: unknown
}

export interface MediaGenerateOutput {
  provider: string
  model: string
  mode: 'sync' | 'async'
  requestId?: string | undefined
  assets: MediaGeneratedAsset[]
  rawResponse?: unknown
  /** 实际发给 provider 的请求摘要（method + url + 已截断的 body），供任务详情展示。 */
  requestCall?: MediaRequestCall | undefined
  /** Contract V2 编译产物：被丢弃的参数及原因，供任务详情与 agent 自我纠正使用。 */
  droppedParams?: MediaDroppedParam[] | undefined
  /** Contract V2 编译产物：兼容透传 / missing_param_policy 等非阻断性提示。 */
  contractWarnings?: MediaContractWarning[] | undefined
  /** Contract V2 编译产物：schema 校验失败的 issue 摘要（severity=error 已在调用前抛错）。 */
  contractIssues?: MediaContractIssue[] | undefined
}

export type MediaErrorCode =
  | 'provider_not_configured'
  | 'capability_not_supported'
  | 'api_key_missing'
  | 'invalid_input'
  | 'provider_http_error'
  | 'task_failed'
  | 'task_timeout'
  | 'artifact_download_failed'
  | 'auth_required'

export class MediaProviderError extends Error {
  readonly code: MediaErrorCode
  readonly statusCode?: number
  /** 失败请求的摘要（method + url + 已截断 body）：router 在抛错前挂上，便于任务详情排查。 */
  requestCall?: MediaRequestCall
  /**
   * Contract V2 错误归一摘要。fetchJson 在抛错前根据 manifest.error contract
   * 解析 provider 错误响应并挂到这里；任务详情 / agent 反馈按 normalized.code
   * 决定提示文案、自动重试和 paramName 引导。缺省时为 undefined（保留旧兜底行为）。
   */
  normalized?: NormalizedMediaErrorSummary
  constructor(code: MediaErrorCode, message: string, statusCode?: number) {
    super(message)
    this.name = 'MediaProviderError'
    this.code = code
    if (statusCode !== undefined) this.statusCode = statusCode
  }
}

/** MediaProviderError 上挂的归一错误摘要（与 NormalizedMediaError 同构，独立类型避免循环依赖）。 */
export interface NormalizedMediaErrorSummary {
  code: MediaNormalizedErrorCode
  providerCode?: string | undefined
  message: string
  requestId?: string | undefined
  paramName?: string | undefined
  retryable: boolean
  rawSnippet?: string | undefined
}

/** 把 MediaErrorContract 转成 fetchJson 可消费的简化结构（避免 protocol 类型反向依赖）。 */
export type { MediaErrorContract }

export interface MediaProviderAdapter {
  readonly id: MediaProviderKind
  supports(capability: MediaCapabilityId): boolean
  invoke(input: MediaGenerateInput, context: MediaProviderContext): Promise<MediaGenerateOutput>
}

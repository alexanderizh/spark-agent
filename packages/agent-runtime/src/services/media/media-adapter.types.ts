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
  MediaProviderKind,
  ProviderMediaDefaults,
} from '@spark/protocol'

/** adapter 调用上下文：由 router 从 ProviderProfile + keystore 解析后注入 */
export interface MediaProviderContext {
  apiKey: string
  apiEndpoint: string
  defaultModel: string
  modelIds?: string[]
  mediaProvider: MediaProviderKind
  mediaApiType: MediaApiType
  mediaDefaults?: ProviderMediaDefaults
  /** 透传的 provider-level extra params（来自 modelParams 的非标量字段） */
  extraParams?: Record<string, unknown>
  /** 可注入的 fetch（测试用 mock）；缺省走全局 fetch */
  fetch?: typeof fetch
}

export type MediaArtifactType = 'image' | 'audio' | 'video' | 'text'

export interface MediaInputFile {
  path?: string
  url?: string
  dataUrl?: string
  mimeType?: string
  type: 'image' | 'audio' | 'video' | 'file'
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

export class MediaProviderError extends Error {
  readonly code: MediaErrorCode
  readonly statusCode?: number
  constructor(code: MediaErrorCode, message: string, statusCode?: number) {
    super(message)
    this.name = 'MediaProviderError'
    this.code = code
    if (statusCode !== undefined) this.statusCode = statusCode
  }
}

export interface MediaProviderAdapter {
  readonly id: MediaProviderKind
  supports(capability: MediaCapabilityId): boolean
  invoke(
    input: MediaGenerateInput,
    context: MediaProviderContext,
  ): Promise<MediaGenerateOutput>
}

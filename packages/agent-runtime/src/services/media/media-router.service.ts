/**
 * MediaRouterService —— 统一多媒体能力入口。
 *
 * 职责（design doc §4 §8）：
 *   - 维护 capability → 可用 provider profile 的注册表。
 *   - 接收 (operation/capability + providerProfileId?) 请求，选择 adapter 并调用。
 *   - 旧 spark_image 的同步逻辑可逐步委托到这里，避免图片/语音/视频 provider 适配分叉。
 *
 * 调用方：
 *   - spark_media MCP server（agent 技能，stdio 子进程）
 *   - 无限画布 canvas media runtime（main process IPC）
 */

import type {
  CanvasOperationType,
  MediaCapabilityId,
  MediaProviderKind,
  ProviderMediaDefaults,
  MediaModelManifest,
  MediaModelCapabilityManifest,
  MediaRequestCall,
} from '@spark/protocol'
import {
  capabilityForOperation,
  isMediaCapabilityId,
  isMediaProviderKind,
  mediaManifestCapabilities,
} from '@spark/protocol'
import { MediaProviderError } from './media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderAdapter,
  MediaProviderContext,
  MediaTaskSubmission,
} from './media-adapter.types.js'
import type { MediaUploader } from './media-uploader.js'
import { ApimartMediaAdapter } from './adapters/apimart-media.adapter.js'
import { AgnesMediaAdapter } from './adapters/agnes-media.adapter.js'
import { VolcengineArkMediaAdapter } from './adapters/volcengine-ark-media.adapter.js'
import { BailianMediaAdapter } from './adapters/bailian-media.adapter.js'
import { XaiMediaAdapter } from './adapters/xai-media.adapter.js'
import { TemplateMediaAdapter } from './adapters/template-media.adapter.js'
import { GoogleGenerativeAiMediaAdapter } from './adapters/google-generative-ai-media.adapter.js'
import { OpenAiOfficialMediaAdapter } from './adapters/openai-official-media.adapter.js'
import { MidjourneyMediaAdapter } from './adapters/midjourney-media.adapter.js'
import { TencentTokenhubMediaAdapter } from './adapters/tencent-tokenhub-media.adapter.js'
import { compactForLog } from './media-debug-log.js'
import {
  logCanvasBlockEnd,
  logCanvasBlockStart,
  logCanvasModelFailure,
  logCanvasModelRequest,
  logCanvasModelResponse,
} from './canvas-model-logger.js'
import { validateMediaRequest } from './media-request-validator.js'

/**
 * 最小化 provider profile 视图：router 只关心调用所需的字段，
 * 调用方负责从 DB row + keystore 解析后传入（避免 router 直接耦合 storage）。
 */
export interface MediaProviderProfile {
  id: string
  name: string
  defaultModel: string
  modelIds?: string[]
  apiEndpoint?: string
  mediaProvider?: MediaProviderKind | null
  mediaApiType?: 'sync' | 'async' | 'auto' | null
  mediaCapabilities?: MediaCapabilityId[]
  mediaModelManifests?: MediaModelManifest[]
  mediaDefaults?: ProviderMediaDefaults
  apiKey: string
  modelParams?: Record<string, unknown>
  /** 平台受管渠道允许按模型 manifest 间接选择已有适配器。 */
  managedType?: 'newapi'
}

export interface InvokeOptions {
  /** 用户指定 provider；优先 */
  providerProfileId?: string | null
  /** 候选 provider 列表（按优先级排序） */
  providers: MediaProviderProfile[]
  /** 显式覆盖 capability（不传则由 operation 推导） */
  capability?: MediaCapabilityId
  /** 指定 provider 内实际调用的模型；用于匹配 manifest 并覆盖 defaultModel。 */
  modelId?: string | null
  /** 指定 manifest；优先级高于 modelId 自动匹配。 */
  manifestId?: string | null
  /** 透传给 adapter 的 extra params（如 voice/aspect_ratio 等） */
  extraParams?: Record<string, unknown>
  /** 注入 fetch（测试用） */
  fetch?: typeof fetch
  /** User explicitly accepted renderer preflight warnings and chose to continue. */
  skipValidation?: boolean
  /** xAI Files 不可用时的公开文件上传回退，由桌面主进程按登录态注入。 */
  fallbackUploader?: MediaUploader
  /** 异步 provider 返回渠道任务 ID 后立即通知调用方。 */
  onTaskSubmitted?: (submission: MediaTaskSubmission) => void
}

export class MediaRouterService {
  private readonly adapters = new Map<MediaProviderKind, MediaProviderAdapter>()
  private readonly templateAdapter = new TemplateMediaAdapter()

  constructor() {
    this.register(new ApimartMediaAdapter())
    this.register(new AgnesMediaAdapter())
    this.register(new XaiMediaAdapter())
    // 火山方舟（Seedance 视频 / Seedream 图片）：真实 API 需嵌套 content[] 数组，
    // 模板适配器无法表达，故用专用 adapter；supports(capability) 时优先于模板适配器。
    this.register(new VolcengineArkMediaAdapter())
    this.register(new BailianMediaAdapter())
    this.register(new OpenAiOfficialMediaAdapter())
    this.register(new GoogleGenerativeAiMediaAdapter('google-generative-ai'))
    this.register(new GoogleGenerativeAiMediaAdapter('omni'))
    this.register(new MidjourneyMediaAdapter())
    // 腾讯云 TokenHub（图片 + 视频）：query 是 POST + body {model, id}，
    // 模板适配器 pollTask 写死 GET 无法表达，故用专用 adapter。
    this.register(new TencentTokenhubMediaAdapter())
  }

  register(adapter: MediaProviderAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  /** 暴露内置 adapter id（用于诊断 / capability 列举） */
  listAdapters(): MediaProviderKind[] {
    return [...this.adapters.keys()]
  }

  getAdapter(kind: MediaProviderKind): MediaProviderAdapter | undefined {
    return this.adapters.get(kind)
  }

  /**
   * 解析 operation → 所需 capability（取首个候选 provider 支持的）。
   * 用于 canvas runtime 在不显式指定 capability 时推导。
   */
  resolveCapability(
    operation: CanvasOperationType,
    providers: MediaProviderProfile[],
  ): MediaCapabilityId | null {
    const candidates = capabilityForOperation(operation)
    for (const cap of candidates) {
      if (providers.some((provider) => this.supports(provider, cap))) return cap
    }
    return candidates[0] ?? null
  }

  resolveCapabilityForInput(
    input: MediaGenerateInput,
    options: Pick<InvokeOptions, 'providers' | 'providerProfileId' | 'modelId' | 'manifestId'>,
  ): MediaCapabilityId | null {
    if (
      (input.operation === 'text_to_video' || input.operation === 'image_to_video') &&
      this.prefersReferenceCapability(input)
    ) {
      const selectedProviders = options.providerProfileId
        ? options.providers.filter((provider) => provider.id === options.providerProfileId)
        : options.manifestId
          ? options.providers.filter((provider) =>
              provider.mediaModelManifests?.some((manifest) => manifest.id === options.manifestId),
            )
          : options.modelId
            ? options.providers.filter(
                (provider) =>
                  provider.defaultModel === options.modelId ||
                  provider.modelIds?.includes(options.modelId ?? '') === true ||
                  provider.mediaModelManifests?.some(
                    (manifest) => manifest.modelId === options.modelId,
                  ),
              )
            : options.providers
      const supportsReferenceInput = selectedProviders.some((provider) => {
        const manifests = provider.mediaModelManifests ?? []
        const selectedManifest = options.manifestId
          ? manifests.find((manifest) => manifest.id === options.manifestId)
          : options.modelId
            ? manifests.find((manifest) => manifest.modelId === options.modelId)
            : manifests.find((manifest) => manifest.modelId === provider.defaultModel)
        if (selectedManifest) {
          return selectedManifest.capabilities.some(
            (capability) => capability.id === 'video.reference_to_video',
          )
        }
        if (options.manifestId || options.modelId) return false
        return this.supports(provider, 'video.reference_to_video')
      })
      if (supportsReferenceInput) return 'video.reference_to_video'
    }
    return this.resolveCapability(input.operation, options.providers)
  }

  /** 检查某 provider profile 是否声明支持某 capability（且 adapter 也支持） */
  private prefersReferenceCapability(input: MediaGenerateInput): boolean {
    const files = input.inputFiles ?? []
    if (input.operation === 'text_to_video') {
      return files.some(
        (file) => file.type === 'image' || file.type === 'video' || file.type === 'audio',
      )
    }
    if (files.some((file) => file.type === 'video' || file.type === 'audio')) return true
    const images = files.filter((file) => file.type === 'image')
    if (images.some((file) => file.role === 'reference')) return true
    return (
      images.length > 1 &&
      !images.some((file) => file.role === 'first_frame' || file.role === 'last_frame')
    )
  }

  supports(profile: MediaProviderProfile, capability: MediaCapabilityId): boolean {
    const kind = effectiveProviderKind(profile)
    const adapter = kind ? this.adapters.get(kind) : undefined
    const declared = mediaCapabilitiesForProfile(profile)
    // 声明了能力列表就以列表为准；未声明则信任 adapter
    if (declared.length > 0) {
      return (
        declared.includes(capability) &&
        (Boolean(adapter?.supports(capability)) || hasManifestCapability(profile, capability))
      )
    }
    return Boolean(adapter?.supports(capability))
  }

  /**
   * 主入口：选择 provider + adapter 执行 invoke。
   *
   * 选择顺序（design doc §8 step 3）：
   *   1. providerProfileId 命中且支持 capability
   *   2. providers 列表中首个支持 capability 的（按传入顺序，调用方可排好优先级）
   *   3. capability registry 中第一个 enabled provider 兜底
   */
  async invoke(
    input: MediaGenerateInput,
    options: InvokeOptions,
  ): Promise<{
    output: MediaGenerateOutput
    providerProfileId: string
  }> {
    const providers = options.providers
    if (providers.length === 0) {
      throw new MediaProviderError('provider_not_configured', 'No media provider configured')
    }
    // 优先用显式传入的 capability，否则按 operation 推导
    const capability =
      options.capability ?? input.capability ?? this.resolveCapabilityForInput(input, options)
    if (!capability) {
      throw new MediaProviderError(
        'capability_not_supported',
        `No capability for operation ${input.operation}`,
      )
    }

    let chosen: MediaProviderProfile | undefined
    if (options.providerProfileId) {
      chosen = providers.find((provider) => provider.id === options.providerProfileId)
    }
    if (!chosen) {
      chosen = providers.find((provider) => this.supports(provider, capability))
    }
    if (!chosen) {
      throw new MediaProviderError(
        'capability_not_supported',
        `No provider supports capability ${capability}`,
      )
    }
    if (!chosen.apiKey) {
      throw new MediaProviderError('api_key_missing', `Provider ${chosen.name} has no API key`)
    }

    const manifestOptions: { manifestId?: string | null; modelId?: string | null } = {}
    if (options.manifestId !== undefined) manifestOptions.manifestId = options.manifestId
    if (options.modelId !== undefined) manifestOptions.modelId = options.modelId
    const explicitModelManifest = options.modelId
      ? chosen.mediaModelManifests?.find((manifest) => manifest.modelId === options.modelId)
      : undefined
    if (
      explicitModelManifest &&
      !explicitModelManifest.capabilities.some((item) => item.id === capability)
    ) {
      throw new MediaProviderError(
        'capability_not_supported',
        `Model ${options.modelId} does not support capability ${capability}`,
      )
    }
    const manifestMatch = resolveManifestMatch(chosen, capability, manifestOptions)
    const effectiveModelId =
      options.modelId ?? manifestMatch?.manifest.modelId ?? chosen.defaultModel
    const adapterModelId = manifestMatch?.manifest.adapterModelId ?? effectiveModelId
    const kind = invocationProviderKind(chosen, manifestMatch?.manifest)
    if (!options.skipValidation) {
      const validation = validateMediaRequest({
        input: { ...input, capability },
        providerKind: kind ?? 'custom',
        modelId: adapterModelId,
        capability,
        ...(manifestMatch?.manifest ? { manifest: manifestMatch.manifest } : {}),
        ...(manifestMatch?.capability ? { manifestCapability: manifestMatch.capability } : {}),
        ...(chosen.mediaDefaults ? { providerDefaults: chosen.mediaDefaults } : {}),
        mode: 'adapter',
      })
      const blockingIssue = validation.blockingIssues[0]
      if (blockingIssue) {
        throw new MediaProviderError('invalid_input', blockingIssue.message)
      }
    }
    const adapter = kind ? this.adapters.get(kind) : undefined
    // An inline custom manifest is an explicit per-model protocol override. A
    // synthesized `custom:*` manifest keeps the native provider kind and is
    // intentionally handled by that provider's adapter (it is only a UI
    // compatibility contract, not a complete wire protocol).
    const isCustomManifest = manifestMatch?.manifest.providerKind === 'custom'
    const shouldUseManifestAdapter = Boolean(
      manifestMatch &&
      (isCustomManifest || !adapter || !adapter.supports(capability) || kind === 'custom'),
    )
    // 包装 fetch，捕获发给 provider 的请求（method + url + body），用于任务详情展示。
    // 只取最后一个带 body 的 POST：adapter 内部对单次能力调用只发一个主请求；
    // APIMart 编辑会先 POST /uploads/images 再 POST /images/generations，取后者即主请求。
    const capture = createRequestCapture(options.fetch)
    const onTaskSubmitted = options.onTaskSubmitted
      ? (submission: MediaTaskSubmission): void => {
          try {
            const requestCall = capture.getCaptured()
            options.onTaskSubmitted?.({
              requestId: submission.requestId,
              response: compactForLog(submission.response),
              ...(requestCall ? { requestCall } : {}),
            })
          } catch {
            // 诊断回调失败不能中断已经成功提交的 provider 任务及后续轮询。
          }
        }
      : undefined
    if (manifestMatch && shouldUseManifestAdapter) {
      const ctx: MediaProviderContext = {
        apiKey: chosen.apiKey,
        apiEndpoint: chosen.apiEndpoint ?? '',
        defaultModel: effectiveModelId,
        adapterModelId,
        ...(chosen.mediaDefaults ? { mediaDefaults: chosen.mediaDefaults } : {}),
        ...(chosen.modelIds ? { modelIds: chosen.modelIds } : {}),
        mediaProvider: kind ?? 'custom',
        mediaApiType: chosen.mediaApiType ?? 'auto',
        mediaManifest: manifestMatch.manifest,
        mediaManifestCapability: manifestMatch.capability,
        ...(options.extraParams ? { extraParams: options.extraParams } : {}),
        ...(options.skipValidation === true ? { skipParameterValidation: true } : {}),
        fetch: capture.fetch,
        ...(options.fallbackUploader ? { fallbackUploader: options.fallbackUploader } : {}),
        ...(onTaskSubmitted ? { onTaskSubmitted } : {}),
      }
      const providerKind = kind ?? 'custom'
      logCanvasBlockStart({
        label: `${effectiveModelId ?? '(model)'} · ${capability}`,
        kind: 'media',
      })
      logCanvasModelRequest({
        provider: providerKind,
        capability,
        model: effectiveModelId,
        method: 'POST',
        url: chosen.apiEndpoint ?? '',
        extra: { manifestId: manifestMatch.manifest.id },
      })
      const startedAt = Date.now()
      try {
        const output = await this.templateAdapter.invoke({ ...input, capability }, ctx)
        const captured = output.requestCall ?? capture.getCaptured()
        if (captured) {
          logCanvasModelResponse({
            provider: providerKind,
            capability,
            model: effectiveModelId,
            status: captured.response?.status,
            body: captured.response?.body ?? captured.body,
            durationMs: Date.now() - startedAt,
            ...(output.assets?.length != null ? { assetCount: output.assets.length } : {}),
          })
        }
        logCanvasBlockEnd({
          label: `${effectiveModelId ?? '(model)'} · ${capability}`,
          kind: 'media',
        })
        return {
          output: { ...output, requestCall: output.requestCall ?? capture.getCaptured() },
          providerProfileId: chosen.id,
        }
      } catch (err) {
        const captured = capture.getCaptured()
        logCanvasModelFailure({
          provider: providerKind,
          capability,
          model: effectiveModelId,
          code: (err as { code?: string })?.code,
          message: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
        })
        if (captured?.body !== undefined) {
          logCanvasModelRequest({
            provider: providerKind,
            capability,
            model: effectiveModelId,
            method: captured.method,
            url: captured.url,
            body: captured.body,
          })
        }
        logCanvasBlockEnd({
          label: `${effectiveModelId ?? '(model)'} · ${capability}`,
          kind: 'media',
        })
        attachCapturedRequest(err, capture)
        throw err
      }
    }

    if (!adapter) {
      throw new MediaProviderError(
        'provider_not_configured',
        `No adapter for provider kind ${kind ?? '(unknown)'}`,
      )
    }

    const ctx: MediaProviderContext = {
      apiKey: chosen.apiKey,
      apiEndpoint: chosen.apiEndpoint ?? '',
      defaultModel: effectiveModelId,
      adapterModelId,
      ...(chosen.mediaDefaults ? { mediaDefaults: chosen.mediaDefaults } : {}),
      ...(chosen.modelIds ? { modelIds: chosen.modelIds } : {}),
      mediaProvider: kind ?? 'custom',
      mediaApiType: chosen.mediaApiType ?? 'auto',
      ...(manifestMatch?.manifest ? { mediaManifest: manifestMatch.manifest } : {}),
      ...(manifestMatch?.capability ? { mediaManifestCapability: manifestMatch.capability } : {}),
      ...(options.extraParams ? { extraParams: options.extraParams } : {}),
      ...(options.skipValidation === true ? { skipParameterValidation: true } : {}),
      fetch: capture.fetch,
      ...(options.fallbackUploader ? { fallbackUploader: options.fallbackUploader } : {}),
      ...(onTaskSubmitted ? { onTaskSubmitted } : {}),
    }
    try {
      logCanvasBlockStart({
        label: `${effectiveModelId ?? '(model)'} · ${capability}`,
        kind: 'media',
      })
      logCanvasModelRequest({
        provider: kind ?? 'custom',
        capability,
        model: effectiveModelId,
        method: 'POST',
        url: chosen.apiEndpoint ?? '',
      })
      const startedAt = Date.now()
      const output = await adapter.invoke({ ...input, capability }, ctx)
      const captured = output.requestCall ?? capture.getCaptured()
      if (captured) {
        logCanvasModelResponse({
          provider: kind ?? 'custom',
          capability,
          model: effectiveModelId,
          status: captured.response?.status,
          body: captured.response?.body ?? captured.body,
          durationMs: Date.now() - startedAt,
          ...(output.assets?.length != null ? { assetCount: output.assets.length } : {}),
        })
      }
      logCanvasBlockEnd({
        label: `${effectiveModelId ?? '(model)'} · ${capability}`,
        kind: 'media',
      })
      return {
        output: { ...output, requestCall: output.requestCall ?? capture.getCaptured() },
        providerProfileId: chosen.id,
      }
    } catch (err) {
      const captured = capture.getCaptured()
      logCanvasModelFailure({
        provider: kind ?? 'custom',
        capability,
        model: effectiveModelId,
        code: (err as { code?: string })?.code,
        message: err instanceof Error ? err.message : String(err),
      })
      if (captured?.body !== undefined) {
        logCanvasModelRequest({
          provider: kind ?? 'custom',
          capability,
          model: effectiveModelId,
          method: captured.method,
          url: captured.url,
          body: captured.body,
        })
      }
      logCanvasBlockEnd({
        label: `${effectiveModelId ?? '(model)'} · ${capability}`,
        kind: 'media',
      })
      attachCapturedRequest(err, capture)
      throw err
    }
  }
}

/**
 * 包装 fetch，捕获「带 body 的 POST 请求」摘要（最后一个胜出），供任务详情展示请求地址与参数。
 * body 中的 base64 / data: URI 会被截断（复用 compactForLog），避免大图刷屏/落库。
 */
function createRequestCapture(fetchImpl?: typeof fetch): {
  fetch: typeof fetch
  getCaptured: () => MediaRequestCall | undefined
} {
  const baseFetch = fetchImpl ?? fetch
  let captured: MediaRequestCall | undefined
  const wrappedFetch: typeof fetch = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const requestHeaders = summarizeHeaders(init?.headers)
    if (method === 'POST' && init?.body != null) {
      captured = {
        method,
        url: String(input),
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        body: summarizeRequestBody(init.body, requestHeaders),
      }
    }
    const response = await baseFetch(input, init)
    if (captured && captured.url === String(input) && captured.method === method) {
      captured = {
        ...captured,
        response: await summarizeResponse(response),
      }
    }
    return response
  }
  return { fetch: wrappedFetch, getCaptured: () => captured }
}

/** 把请求体归一为可展示形式：JSON 解析后截断 base64；非 JSON 字符串整体截断；二进制给字节占位。 */
function summarizeRequestBody(body: unknown, headers?: Record<string, string>): unknown {
  const contentType = headers?.['content-type']?.toLowerCase() ?? ''
  if (typeof body === 'string') {
    const trimmed = body.trimStart()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return compactForLog(JSON.parse(body))
      } catch {
        return truncateLongString(body)
      }
    }
    return truncateLongString(body)
  }
  if (body instanceof Uint8Array) {
    if (contentType.includes('multipart/form-data')) {
      return `[multipart/form-data ${body.byteLength} bytes]`
    }
    return `[binary ${body.byteLength} bytes]`
  }
  return '[non-string body]'
}

function truncateLongString(value: string): string {
  return value.length <= 200 ? value : `${value.slice(0, 120)}…<truncated, len=${value.length}>`
}

async function summarizeResponse(
  response: Response,
): Promise<NonNullable<MediaRequestCall['response']>> {
  const headers = summarizeHeaders(response.headers)
  const contentType = headers?.['content-type']?.toLowerCase() ?? ''
  const summary: NonNullable<MediaRequestCall['response']> = {
    status: response.status,
    ...(response.statusText ? { statusText: response.statusText } : {}),
    ...(headers ? { headers } : {}),
  }
  try {
    const text = await response.clone().text()
    if (isTextualContentType(contentType) || looksLikeTextPayload(text)) {
      return {
        ...summary,
        ...(text.length > 0 ? { body: summarizeTextPayload(text, contentType) } : {}),
      }
    }
    const buffer = Buffer.from(await response.clone().arrayBuffer())
    return {
      ...summary,
      body: `[binary${contentType ? ` ${contentType}` : ''} ${buffer.byteLength} bytes]`,
    }
  } catch (error) {
    return {
      ...summary,
      body: `[response summary unavailable: ${error instanceof Error ? error.message : String(error)}]`,
    }
  }
}

function summarizeTextPayload(text: string, contentType: string): unknown {
  if (contentType.includes('json')) {
    try {
      return compactForLog(JSON.parse(text))
    } catch {
      return truncateLargeText(text)
    }
  }
  return truncateLargeText(text)
}

function truncateLargeText(value: string): string {
  return value.length <= 4000
    ? value
    : `${value.slice(0, 2000)}\n…<truncated, len=${value.length}>\n${value.slice(-1000)}`
}

function isTextualContentType(contentType: string): boolean {
  return (
    contentType.includes('json') ||
    contentType.startsWith('text/') ||
    contentType.includes('xml') ||
    contentType.includes('html') ||
    contentType.includes('javascript') ||
    contentType.includes('x-www-form-urlencoded')
  )
}

function looksLikeTextPayload(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) return true
  const sample = trimmed.slice(0, 200)
  let readable = 0
  for (const char of sample) {
    const code = char.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126)) readable += 1
  }
  return readable / sample.length > 0.85
}

function summarizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers) return undefined
  const entries = normalizeHeaders(headers)
  if (entries.length === 0) return undefined
  const summarized = Object.fromEntries(
    entries.map(([key, value]) => [
      key,
      SECRET_HEADER_PATTERN.test(key) ? '[REDACTED]' : truncateHeaderValue(value),
    ]),
  )
  return Object.keys(summarized).length > 0 ? summarized : undefined
}

function normalizeHeaders(headers: unknown): Array<[string, string]> {
  if (headers instanceof Headers) return Array.from(headers.entries())
  if (Array.isArray(headers)) {
    return headers.flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return []
      const [key, value] = entry
      return [[String(key).toLowerCase(), String(value)]]
    })
  }
  if (headers && typeof headers === 'object') {
    return Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)])
  }
  return []
}

function truncateHeaderValue(value: string): string {
  return value.length <= 300 ? value : `${value.slice(0, 180)}…<truncated, len=${value.length}>`
}

const SECRET_HEADER_PATTERN = /^(authorization|x-api-key|api-key)$/i

/** 失败的 provider 调用：把 fetch 捕获到的请求摘要挂到 MediaProviderError 上，便于任务详情排查。 */
function attachCapturedRequest(
  err: unknown,
  capture: { getCaptured: () => MediaRequestCall | undefined },
): void {
  if (!(err instanceof MediaProviderError)) return
  const captured = capture.getCaptured()
  if (captured && !err.requestCall) err.requestCall = captured
}

function mediaCapabilitiesForProfile(
  profile: Pick<MediaProviderProfile, 'mediaCapabilities' | 'mediaModelManifests'>,
): MediaCapabilityId[] {
  const declared = profile.mediaCapabilities ?? []
  const fromManifests = (profile.mediaModelManifests ?? [])
    .flatMap((manifest) => mediaManifestCapabilities(manifest))
    .filter(isMediaCapabilityId)
  return Array.from(new Set([...declared, ...fromManifests]))
}

function hasManifestCapability(
  profile: Pick<MediaProviderProfile, 'mediaModelManifests'>,
  capability: MediaCapabilityId,
): boolean {
  return (profile.mediaModelManifests ?? []).some((manifest) =>
    manifest.capabilities.some((item) => item.id === capability),
  )
}

function resolveManifestMatch(
  profile: Pick<MediaProviderProfile, 'mediaModelManifests'>,
  capability: MediaCapabilityId,
  options: { manifestId?: string | null; modelId?: string | null },
): { manifest: MediaModelManifest; capability: MediaModelCapabilityManifest } | null {
  const manifests = profile.mediaModelManifests ?? []
  const candidates = manifests
    .map((manifest) => ({
      manifest,
      capability: manifest.capabilities.find((item) => item.id === capability),
    }))
    .filter(
      (item): item is { manifest: MediaModelManifest; capability: MediaModelCapabilityManifest } =>
        item.capability != null,
    )
  if (candidates.length === 0) return null
  if (options.manifestId) {
    const exact = candidates.find((item) => item.manifest.id === options.manifestId)
    if (exact) return exact
  }
  if (options.modelId) {
    const byModel = candidates.find((item) => item.manifest.modelId === options.modelId)
    if (byModel) return byModel
  }
  return candidates[0] ?? null
}

/** 解析 provider profile 的有效 mediaProvider：优先显式字段，其次由 imageProvider 推断 */
export function effectiveProviderKind(
  profile: Pick<MediaProviderProfile, 'mediaProvider'>,
): MediaProviderKind | null {
  if (profile.mediaProvider && isMediaProviderKind(profile.mediaProvider)) {
    return profile.mediaProvider
  }
  return null
}

/**
 * Platform-managed models are an indirect routing layer: their manifest selects
 * an existing application adapter, while the managed profile still supplies the
 * platform endpoint and credential. Ordinary providers retain the legacy
 * profile-level adapter decision unchanged.
 */
export function invocationProviderKind(
  profile: Pick<MediaProviderProfile, 'mediaProvider' | 'managedType'>,
  manifest?: Pick<MediaModelManifest, 'providerKind'>,
): MediaProviderKind | null {
  if (
    profile.managedType === 'newapi' &&
    manifest != null &&
    isMediaProviderKind(manifest.providerKind)
  ) {
    return manifest.providerKind
  }
  return effectiveProviderKind(profile)
}

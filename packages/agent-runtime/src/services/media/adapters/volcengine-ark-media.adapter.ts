/**
 * 火山方舟（Volcengine Ark）多媒体 adapter。
 *
 * 覆盖两类模型：
 *
 * 1. 视频生成 —— Doubao Seedance 2.0 / 2.0 Fast / 2.0 Mini
 *    见 model-api-doc/seedance2.0.md：
 *      - 文生视频 / 图生视频（首帧/首尾帧）/ 多模态参考 / 视频编辑 / 视频延长
 *      - POST {base}/contents/generations/tasks，请求体为 model + content[] + 顶层参数
 *      - content[] 元素：{type:'text'} / {type:'image_url',image_url,role} /
 *        {type:'video_url',video_url,role} / {type:'audio_url',audio_url,role}
 *        role ∈ first_frame | last_frame | reference_image | reference_video | reference_audio
 *      - 响应：异步任务，取 id 轮询 GET {base}/contents/generations/tasks/{id}
 *        → content.video_url（成功）/ error（失败）
 *
 * 2. 图片生成 —— Doubao Seedream 4.5 / 5.0 lite
 *    见 model-api-doc/seedream4.5.md：
 *      - 文生图 / 图文生图（单图）/ 多图融合（多图）/ 组图生成
 *      - POST {base}/images/generations，OpenAI 兼容风格
 *      - image 字段单图为 string、多图为 string[]；size 取 2K/4K 等；
 *        sequential_image_generation=auto + sequential_image_generation_options.max_images
 *        控制组图；tools:[{type:'web_search'}] 开启联网搜索
 *      - 响应：同步，data[].url / data[].b64_json
 *
 * 为何需要专用 adapter：Seedance 真实 API 要求嵌套 content[] 数组（type+role 对象），
 * 模板适配器的 {{var}} 插值无法表达对象数组结构，会导致每个请求结构错误被平台 400。
 * 本 adapter 注册后，当 supports(capability) 为真，MediaRouterService.invoke
 * （media-router.service.ts:164 shouldUseManifestAdapter）会优先走本 adapter，
 * manifest 的 requestTemplate 不再生效，但 paramSchema/defaults/aliases 仍驱动 UI 表单
 * 与参数归一化。
 *
 * base endpoint 由 ProviderProfile.apiEndpoint 派生：去除尾部斜杠即可。manifest 内
 * 的 endpoint 路径（/contents/generations/tasks、/images/generations）在此拼接。
 */

import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaInputFile,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  extractImages,
  extractMediaUrls,
  extractStatus,
  extractTaskId,
  fetchJson,
  pollTask,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import {
  clampInt,
  filenameHelper,
  mediaInputRef,
} from './openai-compatible-media.adapter.js'

const VIDEO_CAPABILITIES: readonly MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.edit',
  'video.extend',
]
const IMAGE_CAPABILITIES: readonly MediaCapabilityId[] = ['image.generate', 'image.edit']

/** Seedance content[] 元素（简化类型，仅描述发送给平台的形状） */
type SeedanceContentItem =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: string }
  | { type: 'video_url'; video_url: { url: string }; role: string }
  | { type: 'audio_url'; audio_url: { url: string }; role: string }

const SUCCEEDED_STATUS = 'succeeded'
const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled']

export class VolcengineArkMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'volcengine-ark'
  private readonly capabilities = new Set<MediaCapabilityId>([
    ...VIDEO_CAPABILITIES,
    ...IMAGE_CAPABILITIES,
  ])
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing Volcengine API key')
    const capability = input.capability
    if (!capability) {
      throw new MediaProviderError('capability_not_supported', 'No capability resolved for volcengine-ark invoke')
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError('capability_not_supported', `volcengine-ark does not support ${capability}`)
    }
    if (VIDEO_CAPABILITIES.includes(capability)) {
      return this.generateVideo(input, ctx)
    }
    return this.generateImage(input, ctx)
  }

  // ─── 视频路径（Seedance）───────────────────────────────────────────────────

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const content = buildSeedanceContent(input, ctx, capability, prompt)
    if (content.length === 0) {
      throw new MediaProviderError('invalid_input', `Volcengine ${capability} requires a prompt or input media`)
    }
    const params = buildSeedanceParams(input, ctx)
    const body: Record<string, unknown> = {
      model,
      content,
      ...params,
    }

    const url = `${base}/contents/generations/tasks`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: {
        prompt: prompt.slice(0, 120),
        contentItems: content.length,
        roles: content.map((item) => ('role' in item ? item.role : item.type)).join(','),
      },
    })

    const createResp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 60_000,
    })

    // 少数情况会同步直出视频；否则取任务 id 轮询。
    let videoUrls = extractMediaUrls(createResp, { kind: 'video' })
    let requestId: string | undefined
    let mode: 'sync' | 'async' = 'sync'
    let raw: unknown = createResp

    if (videoUrls.length === 0) {
      const taskId = extractTaskId(createResp)
      if (!taskId) {
        logMediaResult({ provider: this.id, capability, ok: false, error: 'No task id in create response' })
        throw new MediaProviderError('provider_http_error', `No task id in Volcengine response: ${JSON.stringify(createResp).slice(0, 800)}`)
      }
      requestId = taskId
      mode = 'async'
      const pollUrl = `${base}/contents/generations/tasks/${encodeURIComponent(taskId)}`
      raw = await pollTask(pollUrl, authHeaders(ctx), {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 172_800_000,
        inspect: (data) => {
          const urls = extractMediaUrls(data, { kind: 'video' })
          if (urls.length > 0) return 'done'
          const status = extractStatus(data)
          if (status === SUCCEEDED_STATUS) return 'done'
          return FAILED_STATUSES.includes(status) ? 'failed' : 'pending'
        },
      })
      videoUrls = extractMediaUrls(raw, { kind: 'video' })
    }

    if (videoUrls.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No video produced' })
      throw new MediaProviderError('provider_http_error', `No video produced: ${JSON.stringify(raw).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: videoUrls.length, requestId })
    const assets = await Promise.all(
      videoUrls.map((u, i) =>
        this.artifact.downloadMediaAsset('video', u, input.outputDir, filenameHelper(input, videoPrefix(capability), i, videoUrls.length), ctx.fetch),
      ),
    )
    return {
      provider: this.id,
      model,
      mode,
      ...(requestId ? { requestId } : {}),
      assets,
      rawResponse: raw,
    }
  }

  // ─── 图片路径（Seedream）───────────────────────────────────────────────────

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', `Volcengine ${capability} requires a prompt`)
    }
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const params = buildSeedreamParams(input, ctx)
    const body: Record<string, unknown> = {
      model,
      prompt,
      ...params,
    }

    const url = `${base}/images/generations`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), imageCount: params.image ? (Array.isArray(params.image) ? params.image.length : 1) : 0 },
    })

    const data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
    })
    const images = extractImages(data)
    if (images.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No images in response' })
      throw new MediaProviderError('provider_http_error', `No images in Volcengine Seedream response: ${JSON.stringify(data).slice(0, 800)}`)
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: images.length })
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(image, input.outputDir, filenameHelper(input, 'seedream', index, images.length), ctx.fetch),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: data }
  }
}

// ─── Seedance content[] 构造 ──────────────────────────────────────────────────

/**
 * 按 inputFiles 的 role 聚合成 Seedance content[] 数组。
 * 严格按文档示例顺序：text → 首帧 → 尾帧 → 参考图 → 参考视频 → 参考音频。
 * 空 url 自动跳过，避免渲染出畸形元素导致平台 400。
 *
 * capability 决定默认 role 推断：
 *   - video.image_to_video：第一张图默认 first_frame（图生视频-首帧）
 *   - video.edit / video.extend：输入视频为 reference_video
 *   - 其它：无显式 role 的图作 reference_image
 */
function buildSeedanceContent(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
  capability: MediaCapabilityId,
  prompt: string,
): SeedanceContentItem[] {
  const files = input.inputFiles ?? []
  const imageFiles = files.filter((file) => file.type === 'image' || file.type === 'file')
  const videoFiles = files.filter((file) => file.type === 'video' || (file.type === 'file' && file.role === 'input'))
  const audioFiles = files.filter((file) => file.type === 'audio')

  const content: SeedanceContentItem[] = []
  if (prompt) content.push({ type: 'text', text: prompt })

  const firstFrameFile = imageFiles.find((file) => file.role === 'first_frame')
  const lastFrameFile = imageFiles.find((file) => file.role === 'last_frame')
  // 显式标注 reference 的优先；否则未被首/尾帧占用的图作为参考图。
  const hasExplicitRef = imageFiles.some((file) => file.role === 'reference')
  const referenceImageFiles = hasExplicitRef
    ? imageFiles.filter((file) => file.role === 'reference')
    : imageFiles.filter((file) => file !== firstFrameFile && file !== lastFrameFile)

  // 图生视频（i2v）无显式 role 时的兜底推断：对齐「图生视频-首帧/首尾帧」语义。
  //   - 第 1 张无 role 图 → first_frame
  //   - 第 2 张无 role 图 → last_frame（首尾帧是 Seedance 核心能力，需成对识别）
  //   - 其余 → reference_image
  // 有显式 role（first_frame/last_frame/reference）时尊重标注，不走兜底。
  const i2vImplicit = capability === 'video.image_to_video' && !firstFrameFile && !lastFrameFile && !hasExplicitRef
  if (i2vImplicit && referenceImageFiles[0]) {
    const ref = resolveRef(referenceImageFiles[0], ctx.mediaProvider)
    if (ref) content.push({ type: 'image_url', image_url: { url: ref }, role: 'first_frame' })
    if (referenceImageFiles[1]) {
      const ref2 = resolveRef(referenceImageFiles[1], ctx.mediaProvider)
      if (ref2) content.push({ type: 'image_url', image_url: { url: ref2 }, role: 'last_frame' })
    }
  } else {
    const ref = resolveRef(firstFrameFile, ctx.mediaProvider)
    if (ref) content.push({ type: 'image_url', image_url: { url: ref }, role: 'first_frame' })
    const lref = resolveRef(lastFrameFile, ctx.mediaProvider)
    if (lref) content.push({ type: 'image_url', image_url: { url: lref }, role: 'last_frame' })
  }
  // 参考图：i2v 兜底模式下跳过已被首/尾帧占用的前两张。
  for (const file of referenceImageFiles) {
    if (i2vImplicit && (file === referenceImageFiles[0] || file === referenceImageFiles[1])) continue
    const ref = resolveRef(file, ctx.mediaProvider)
    if (ref) content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' })
  }
  for (const file of videoFiles) {
    const ref = resolveRef(file, ctx.mediaProvider)
    if (ref) content.push({ type: 'video_url', video_url: { url: ref }, role: 'reference_video' })
  }
  for (const file of audioFiles) {
    const ref = resolveRef(file, ctx.mediaProvider)
    if (ref) content.push({ type: 'audio_url', audio_url: { url: ref }, role: 'reference_audio' })
  }
  return content
}

/**
 * Seedance 顶层参数：从 modelParams（按 manifest aliases 已归一化）取值，
 * 仅透传平台支持的字段。camelCase → snake_case 在此完成。
 */
function buildSeedanceParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const raw = removeBlankParams(input.modelParams)
  const aliases = ctx.mediaManifestCapability?.aliases
  // 先按 alias 把 camelCase 映射成平台原生 snake_case key。
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const nativeKey = aliases?.[key] ?? key
    normalized[nativeKey] = value
  }
  const videoDefaults = ctx.mediaDefaults?.video
  const params: Record<string, unknown> = {}

  // ratio：schema 用中文 label "智能比例" 提升用户可读性，发送给平台时翻译为
  // 文档要求的 "adaptive"。其它选项原样透传（16:9 / 9:16 等已是平台值）。
  const ratioRaw = stringVal(normalized.ratio) ?? stringVal(normalized.aspect_ratio) ?? stringVal(normalized.aspectRatio)
  const ratio = normalizeSeedanceRatio(ratioRaw)
  if (ratio) params.ratio = ratio

  // duration 范围：Seedance 2.0 系列 [4,15]；1.x 系列 [2,12]。
  // manifest 已通过 schema enum/minimum 在 UI 层把 1.x 限到 [2,12]，adapter 层
  // 这里取并集 [2,15] 兜底，避免误把合法的 1.x 短时长（如 3s）钳到 4s。
  const duration = numberVal(normalized.duration) ?? numberVal(normalized.durationSeconds)
  if (duration != null) params.duration = clampInt(duration, undefined, 5, 2, 15)

  const resolution = stringVal(normalized.resolution) ?? videoDefaults?.resolution
  if (resolution) params.resolution = resolution

  const seed = numberVal(normalized.seed)
  if (seed != null) params.seed = seed

  const generateAudio = boolVal(normalized.generate_audio) ?? boolVal(normalized.generateAudio)
  if (generateAudio != null) params.generate_audio = generateAudio

  const watermark = boolVal(normalized.watermark)
  if (watermark != null) params.watermark = watermark

  const returnLastFrame = boolVal(normalized.return_last_frame) ?? boolVal(normalized.returnLastFrame)
  if (returnLastFrame != null) params.return_last_frame = returnLastFrame

  // 离线推理（service_tier=flex）：仅当显式开启时透传。
  const serviceTier = stringVal(normalized.service_tier) ?? stringVal(normalized.serviceTier)
  if (serviceTier) params.service_tier = serviceTier

  // 固定摄像头（Seedance 1.x，参考图场景不支持；2.x 不支持此参数）。
  const cameraFixed = boolVal(normalized.camera_fixed) ?? boolVal(normalized.cameraFixed)
  if (cameraFixed != null) params.camera_fixed = cameraFixed

  // 样片模式（Seedance 1.5 pro 支持 draft）。
  const draft = boolVal(normalized.draft)
  if (draft != null) params.draft = draft

  // 帧数（Seedance 1.0 系列支持 frames，1.5/2.x 不支持；仅显式给出时透传）。
  const frames = numberVal(normalized.frames)
  if (frames != null) params.frames = frames

  // 联网搜索：tools:[{type:'web_search'}]。
  // Seedance 2.0 新增能力，仅适用于纯文本输入；adapter 层不再二次校验
  // （图/视频文件存在与否的判断已由 UI 层 capability/输入面板限制），开启时透传即可。
  const searchEnabled = boolVal(normalized.searchEnabled) ?? boolVal(normalized.search_enabled) ?? boolVal(normalized.enable_search)
  if (searchEnabled) params.tools = [{ type: 'web_search' }]

  return params
}

/**
 * Seedance ratio 值归一化：schema 默认/枚举里的中文 label 翻译为平台值。
 * - "智能比例" → "adaptive"（火山方舟文档要求）
 * 其它值（16:9 / 9:16 / 21:9 / 4:3 / 1:1 / 3:4）已是平台合法值，原样返回。
 */
function normalizeSeedanceRatio(value: string | undefined): string | undefined {
  if (!value) return value
  if (value === '智能比例') return 'adaptive'
  return value
}

// ─── Seedream 图片参数 ────────────────────────────────────────────────────────

function buildSeedreamParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const raw = removeBlankParams(input.modelParams)
  const imageDefaults = ctx.mediaDefaults?.image
  const params: Record<string, unknown> = {}

  const size = stringVal(raw.size) ?? imageDefaults?.resolution ?? stringVal(raw.resolution)
  if (size) params.size = size

  const outputFormat = stringVal(raw.output_format) ?? stringVal(raw.outputFormat) ?? imageDefaults?.outputFormat
  if (outputFormat) params.output_format = outputFormat

  const responseFormat = stringVal(raw.response_format) ?? stringVal(raw.responseFormat) ?? imageDefaults?.responseFormat
  if (responseFormat) params.response_format = responseFormat

  const watermark = boolVal(raw.watermark)
  if (watermark != null) params.watermark = watermark

  const seed = numberVal(raw.seed)
  if (seed != null) params.seed = seed

  // 联网搜索：tools:[{type:'web_search'}]。
  // 兼容 schema 字段名 searchEnabled、manifest alias enable_search、以及 snake_case 三种写法。
  const searchEnabled = boolVal(raw.searchEnabled) ?? boolVal(raw.search_enabled) ?? boolVal(raw.enable_search)
  if (searchEnabled) params.tools = [{ type: 'web_search' }]

  // 组图生成：sequential_image_generation=auto + max_images
  const sequential = stringVal(raw.sequential_image_generation) ?? stringVal(raw.sequentialImageGeneration)
  if (sequential) {
    params.sequential_image_generation = sequential
    const maxImages = numberVal(raw.max_images) ?? numberVal(raw.maxImages)
    if (maxImages != null) {
      params.sequential_image_generation_options = { max_images: clampInt(maxImages, undefined, 4, 1, 15) }
    }
  }

  // 提示词优化模式（Seedream 4.0 独有：standard / fast）。
  // 4.5 / 5.0 文档仅"标准模式"，schema 不会暴露该字段，但 adapter 容忍透传。
  const promptMode = stringVal(raw.prompt_optimization_mode) ?? stringVal(raw.promptOptimizationMode)
  if (promptMode) params.prompt_optimization_mode = promptMode

  // 参考图：image 字段单图为 string、多图为 string[]（与官方示例一致）。
  // safe-file:// 本地协议第三方 API 无法访问，必须过滤；优先 base64 dataUrl。
  const imageFiles = (input.inputFiles ?? []).filter((file) => file.type === 'image' || file.type === 'file')
  const imageRefs = imageFiles
    .map((file) => mediaInputRef(file, ctx.mediaProvider))
    .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
  if (imageRefs.length === 1) {
    params.image = imageRefs[0]
  } else if (imageRefs.length > 1) {
    params.image = imageRefs
  }

  return params
}

// ─── helpers ────────────────────────────────────────────────────────────────

function baseEndpoint(ctx: MediaProviderContext): string {
  // ProviderProfile.apiEndpoint 形如 https://ark.cn-beijing.volces.com/api/v3
  // （预设已修正为含 /api/v3）。去尾部斜杠即可，子路径在此拼接。
  return (ctx.apiEndpoint ?? '').replace(/\/+$/, '')
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}

/** 解析输入文件为可发送给平台的引用（过滤 safe-file://，优先 http/base64） */
function resolveRef(file: MediaInputFile | undefined, provider: MediaProviderKind): string | undefined {
  if (!file) return undefined
  return mediaInputRef(file, provider)
}

function videoPrefix(capability: MediaCapabilityId): string {
  switch (capability) {
    case 'video.image_to_video':
      return 'i2v'
    case 'video.edit':
      return 'edit'
    case 'video.extend':
      return 'extend'
    default:
      return 'seedance'
  }
}

function removeBlankParams(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  return next
}

function stringVal(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numberVal(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function boolVal(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
  }
  return undefined
}

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { isMediaProviderKind, type MediaCapabilityId, type MediaProviderKind } from '@spark/protocol'
import { MediaArtifactService } from '../media-artifact.service.js'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaInputFile,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import {
  extractImages,
  extractMediaUrls,
  extractStatus,
  extractTaskId,
  fetchJson,
  pollTask,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const CAPABILITIES: readonly MediaCapabilityId[] = [
  'image.generate',
  'image.edit',
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
]

type BailianMediaType =
  | 'first_frame'
  | 'last_frame'
  | 'driving_audio'
  | 'first_clip'
  | 'reference_image'
  | 'reference_video'
  | 'reference_voice'
  | 'video'

type BailianMedia = { type: BailianMediaType; url: string }

export class BailianMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'bailian'
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return CAPABILITIES.includes(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `bailian does not support ${capability ?? 'this operation'}`,
      )
    }
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing Bailian API key')
    return capability.startsWith('image.')
      ? this.generateImage(input, ctx, capability)
      : this.generateVideo(input, ctx, capability)
  }

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
    capability: MediaCapabilityId,
  ): Promise<MediaGenerateOutput> {
    const prompt = requiredPrompt(input, capability)
    const images = await Promise.all(
      (input.inputFiles ?? [])
        .filter((file) => file.type === 'image' || file.type === 'file')
        .map((file) => resolveImageReference(file)),
    )
    if (capability === 'image.edit' && images.length === 0) {
      throw new MediaProviderError('invalid_input', '图像编辑至少需要一张参考图')
    }
    const qwenModel = isQwenImageModel(ctx.defaultModel)
    const maxInputImages = qwenModel ? 3 : 9
    if (images.length > maxInputImages && !ctx.skipParameterValidation) {
      throw new MediaProviderError(
        'invalid_input',
        qwenModel
          ? 'Qwen-Image 2.0 图像编辑最多支持 3 张输入图片'
          : '万相 2.7 图像生成最多支持 9 张输入图片',
      )
    }

    const modelParams = mergeNegativePrompt(input.modelParams, input.negativePrompt)
    const params = isSynthesizedCustomImageManifest(ctx)
      ? customImageParameters(modelParams)
      : qwenModel
        ? qwenImageParameters(modelParams, ctx.skipParameterValidation)
        : imageParameters(
            modelParams,
            ctx.defaultModel,
            images.length,
            ctx.skipParameterValidation,
          )
    const body = {
      model: ctx.defaultModel,
      input: {
        messages: [
          { role: 'user', content: [...images.map((image) => ({ image })), { text: prompt }] },
        ],
      },
      ...(Object.keys(params).length > 0 ? { parameters: params } : {}),
    }
    const url = `${aigcBaseUrl(ctx)}/multimodal-generation/generation`
    logMediaCall({
      provider: this.id,
      capability,
      model: ctx.defaultModel,
      method: 'POST',
      url,
      body,
    })
    const data = await fetchJson(url, {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 180_000,
      errorExtractor: bailianError,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const imagesOut = extractImages(data).filter(
      (image, index, all) =>
        all.findIndex(
          (item) =>
            item.kind === image.kind &&
            normalizeImageValue(item.value) === normalizeImageValue(image.value),
        ) === index,
    )
    if (imagesOut.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No image in Bailian response: ${JSON.stringify(data).slice(0, 800)}`,
      )
    }
    const assets = await Promise.all(
      imagesOut.map((image, index) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filenameHelper(
            input,
            qwenModel
              ? capability === 'image.edit'
                ? 'qwen-edit'
                : 'qwen-image'
              : capability === 'image.edit'
                ? 'wan-edit'
                : 'wan-image',
            index,
            imagesOut.length,
          ),
          ctx.fetch,
        ),
      ),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: assets.length })
    const id = requestId(data)
    return {
      provider: this.id,
      model: ctx.defaultModel,
      mode: 'sync',
      assets,
      rawResponse: data,
      ...(id ? { requestId: id } : {}),
    }
  }

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
    capability: MediaCapabilityId,
  ): Promise<MediaGenerateOutput> {
    const prompt = optionalPrompt(input, capability)
    const media = await buildVideoMedia(input, ctx, capability)
    const body = {
      model: ctx.defaultModel,
      input: {
        ...(prompt ? { prompt } : {}),
        ...(input.negativePrompt?.trim() ? { negative_prompt: input.negativePrompt.trim() } : {}),
        ...(media.length > 0 ? { media } : {}),
      },
      ...(Object.keys(videoParameters(input.modelParams, ctx)).length > 0
        ? { parameters: videoParameters(input.modelParams, ctx) }
        : {}),
    }
    const url = `${aigcBaseUrl(ctx)}/video-generation/video-synthesis`
    logMediaCall({
      provider: this.id,
      capability,
      model: ctx.defaultModel,
      method: 'POST',
      url,
      body,
    })
    const created = await fetchJson(url, {
      method: 'POST',
      headers: { ...headers(ctx), 'x-dashscope-async': 'enable' },
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: 120_000,
      errorExtractor: bailianError,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const taskId = extractTaskId(created)
    if (!taskId)
      throw new MediaProviderError(
        'provider_http_error',
        `No task_id in Bailian response: ${JSON.stringify(created).slice(0, 800)}`,
      )
    ctx.onTaskSubmitted?.({ requestId: taskId, response: created })
    const raw = await pollTask(
      `${apiV1BaseUrl(ctx)}/tasks/${encodeURIComponent(taskId)}`,
      headers(ctx),
      {
        fetchImpl: ctx.fetch,
        intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 15_000,
        timeoutMs: ctx.mediaDefaults?.polling?.timeoutMs ?? 1_800_000,
        errorExtractor: bailianError,
        ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
        inspect: (value) => {
          if (extractMediaUrls(value, { kind: 'video' }).length > 0) return 'done'
          const status = extractStatus(value).toUpperCase()
          return ['FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN'].includes(status)
            ? 'failed'
            : 'pending'
        },
        logContext: `provider=bailian capability=${capability} requestId=${taskId}`,
      },
    )
    const urls = extractMediaUrls(raw, { kind: 'video' })
    if (urls.length === 0)
      throw new MediaProviderError('provider_http_error', `No video in Bailian task ${taskId}`)
    const assets = await Promise.all(
      urls.map((video, index) =>
        this.artifact.downloadMediaAsset(
          'video',
          video,
          input.outputDir,
          filenameHelper(input, 'wan-video', index, urls.length),
          ctx.fetch,
        ),
      ),
    )
    logMediaResult({
      provider: this.id,
      capability,
      ok: true,
      requestId: taskId,
      assetCount: assets.length,
    })
    return {
      provider: this.id,
      model: ctx.defaultModel,
      mode: 'async',
      requestId: taskId,
      assets,
      rawResponse: raw,
    }
  }
}

function requiredPrompt(input: MediaGenerateInput, capability: MediaCapabilityId): string {
  const prompt = input.prompt?.trim()
  if (!prompt)
    throw new MediaProviderError('invalid_input', `Bailian ${capability} requires a prompt`)
  return prompt
}

function optionalPrompt(input: MediaGenerateInput, capability: MediaCapabilityId): string {
  const prompt = input.prompt?.trim() ?? ''
  if (!prompt && capability !== 'video.edit') {
    throw new MediaProviderError('invalid_input', `Bailian ${capability} requires a prompt`)
  }
  return prompt
}

async function buildVideoMedia(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
  capability: MediaCapabilityId,
): Promise<BailianMedia[]> {
  const model = ctx.defaultModel
  const files = input.inputFiles ?? []
  const images = files.filter((file) => file.type === 'image' || file.type === 'file')
  const videos = files.filter((file) => file.type === 'video')
  const audios = files.filter((file) => file.type === 'audio')
  if (model.includes('videoedit') || model.includes('video-edit'))
    return buildVideoEditMedia(images, videos, ctx)
  if (model.includes('r2v') || capability === 'video.reference_to_video')
    return buildReferenceMedia(images, videos, audios, ctx)
  if (capability === 'video.generate' && images.length + videos.length + audios.length === 0)
    return []
  return buildImageToVideoMedia(images, videos, audios, ctx)
}

async function buildImageToVideoMedia(
  images: MediaInputFile[],
  videos: MediaInputFile[],
  audios: MediaInputFile[],
  ctx: MediaProviderContext,
): Promise<BailianMedia[]> {
  const first = images.filter((file) => file.role === 'first_frame')
  const last = images.filter((file) => file.role === 'last_frame')
  const unassigned = images.filter(
    (file) => file.role !== 'first_frame' && file.role !== 'last_frame',
  )
  if (first.length > 1 || last.length > 1 || videos.length > 1 || audios.length > 1) {
    throw new MediaProviderError(
      'invalid_input',
      '万相 2.7 图生视频的首帧、尾帧、首视频片段和驱动音频均最多 1 个',
    )
  }
  if (videos.length > 0 && (first.length > 0 || unassigned.length > 0 || audios.length > 0)) {
    throw new MediaProviderError('invalid_input', '视频续写只能传首视频片段，或首视频片段加尾帧')
  }
  if (videos.length > 0) {
    return [
      { type: 'first_clip', url: await resolveVideoReference(videos[0]!, ctx) },
      ...(last[0]
        ? [{ type: 'last_frame' as const, url: await resolveImageReference(last[0]) }]
        : []),
    ]
  }
  const firstFrame = first[0] ?? unassigned[0]
  if (!firstFrame)
    throw new MediaProviderError('invalid_input', '万相 2.7 图生视频需要首帧图片或首视频片段')
  if (unassigned.length > 1)
    throw new MediaProviderError(
      'invalid_input',
      '万相 2.7 图生视频除首帧、尾帧外不支持额外参考图片',
    )
  return [
    { type: 'first_frame', url: await resolveImageReference(firstFrame) },
    ...(last[0]
      ? [{ type: 'last_frame' as const, url: await resolveImageReference(last[0]) }]
      : []),
    ...(audios[0]
      ? [
          {
            type: 'driving_audio' as const,
            url: await resolveRemoteReference(audios[0], '驱动音频', ctx),
          },
        ]
      : []),
  ]
}

async function buildReferenceMedia(
  images: MediaInputFile[],
  videos: MediaInputFile[],
  audios: MediaInputFile[],
  ctx: MediaProviderContext,
): Promise<BailianMedia[]> {
  if (images.length + videos.length > 5 || audios.length > 1) {
    throw new MediaProviderError(
      'invalid_input',
      '万相 2.7 参考生视频最多 5 个图像/视频参考和 1 个参考音色',
    )
  }
  if (images.length + videos.length === 0)
    throw new MediaProviderError('invalid_input', '万相 2.7 参考生视频至少需要一个图像或视频参考')
  return [
    ...(await Promise.all(
      images.map(async (file) => ({
        type: file.role === 'first_frame' ? ('first_frame' as const) : ('reference_image' as const),
        url: await resolveImageReference(file),
      })),
    )),
    ...(await Promise.all(
      videos.map(async (file) => ({
        type: 'reference_video' as const,
        url: await resolveVideoReference(file, ctx),
      })),
    )),
    ...(await Promise.all(
      audios.map(async (file) => ({
        type: 'reference_voice' as const,
        url: await resolveRemoteReference(file, '参考音色', ctx),
      })),
    )),
  ]
}

async function buildVideoEditMedia(
  images: MediaInputFile[],
  videos: MediaInputFile[],
  ctx: MediaProviderContext,
): Promise<BailianMedia[]> {
  if (videos.length !== 1)
    throw new MediaProviderError('invalid_input', '万相 2.7 视频编辑必须且只能传入一个待编辑视频')
  if (images.length > 4)
    throw new MediaProviderError('invalid_input', '万相 2.7 视频编辑最多支持 4 张参考图')
  return [
    { type: 'video', url: await resolveVideoReference(videos[0]!, ctx) },
    ...(await Promise.all(
      images.map(async (file) => ({
        type: 'reference_image' as const,
        url: await resolveImageReference(file),
      })),
    )),
  ]
}

async function resolveImageReference(file: MediaInputFile): Promise<string> {
  const direct = directReference(file)
  if (direct) return direct
  if (!file.path)
    throw new MediaProviderError(
      'invalid_input',
      '百炼图片素材需要 HTTP/HTTPS、OSS 临时 URL、Base64 或可读取的本地文件',
    )
  const buffer = await readLocalFile(file.path, '图片')
  return `data:${file.mimeType || mimeType(file.path, 'image')};base64,${buffer.toString('base64')}`
}

async function resolveVideoReference(
  file: MediaInputFile,
  ctx: MediaProviderContext,
): Promise<string> {
  const direct = directReference(file)
  if (direct && !direct.startsWith('data:')) return direct
  return resolveLocalRemoteReference(file, '视频', ctx)
}

async function resolveRemoteReference(
  file: MediaInputFile,
  label: string,
  ctx: MediaProviderContext,
): Promise<string> {
  const direct = directReference(file)
  if (direct && !direct.startsWith('data:')) return direct
  return resolveLocalRemoteReference(file, label, ctx)
}

async function resolveLocalRemoteReference(
  file: MediaInputFile,
  label: string,
  ctx: MediaProviderContext,
): Promise<string> {
  const localPath = file.path?.trim()
  if (localPath && ctx.fallbackUploader?.canHandle('bailian')) {
    try {
      const uploaded = await ctx.fallbackUploader.upload({
        buffer: await readLocalFile(localPath, label),
        filename: path.basename(localPath) || `bailian-${label}.bin`,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        targetProvider: 'bailian',
      })
      const publicUrl = uploaded.publicUrl ?? uploaded.url
      if (publicUrl && /^https?:\/\//i.test(publicUrl)) return publicUrl
    } catch (error) {
      throw new MediaProviderError(
        'auth_required',
        `百炼${label}本地素材公开上传失败，请改用 HTTPS/OSS 临时 URL：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  throw new MediaProviderError(
    'invalid_input',
    `百炼${label}素材必须是 HTTP/HTTPS、OSS 临时 URL，或配置可用的本地素材公开上传服务`,
  )
}

function directReference(file: MediaInputFile): string | undefined {
  if (file.fileId?.trim())
    throw new MediaProviderError(
      'invalid_input',
      '百炼 Files file_id 不能直接传给多媒体生成接口，请使用其上传返回的 oss:// 临时 URL',
    )
  for (const candidate of [file.dataUrl, file.url]) {
    const value = candidate?.trim()
    if (!value || value.startsWith('safe-file://')) continue
    if (/^(https?:|oss:|data:)/i.test(value)) return value
  }
  return undefined
}

async function readLocalFile(filePath: string, label: string): Promise<Buffer> {
  try {
    return await readFile(filePath)
  } catch (error) {
    throw new MediaProviderError(
      'invalid_input',
      `无法读取百炼${label}素材 ${path.basename(filePath)}：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isQwenImageModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.startsWith('qwen-image')
}

/**
 * Qwen-Image 2.0 系列参数构造（DashScope 原生，与 apimart 的 qwen 完全独立）。
 * 与 wan 的 imageParameters 关键差异：
 * - size 为像素星号（2048*2048），不校验 1K/2K/4K；
 * - n 上限 6（2.0 系列）；
 * - 不透传 wan 专属的 thinking_mode / enable_sequential / bbox_list / color_palette。
 * negative_prompt 由 generateImage 从 input.negativePrompt 合并进 params，此处直接 pick。
 */
function qwenImageParameters(
  params: Record<string, unknown> | undefined,
  skipParameterValidation = false,
): Record<string, unknown> {
  const normalized = normalizeBailianImageParams(params)
  const size = normalized.size
  if (
    !skipParameterValidation &&
    size !== undefined &&
    (typeof size !== 'string' || !/^\d+\*\d+$/.test(size))
  ) {
    throw new MediaProviderError(
      'invalid_input',
      'Qwen-Image 2.0 size 必须为像素星号格式（如 2048*2048）',
    )
  }
  const n = normalized.n
  if (
    !skipParameterValidation &&
    n !== undefined &&
    (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 6)
  ) {
    throw new MediaProviderError('invalid_input', 'Qwen-Image 2.0 n 必须是 1-6 的整数')
  }
  // 显式补全官方默认（size/n/prompt_extend/watermark），使请求体稳定可控；
  // negative_prompt / seed 仅在调用方传入时透传。
  const result: Record<string, unknown> = {
    size: size ?? '2048*2048',
    n: typeof n === 'number' ? n : 1,
    prompt_extend: normalized.prompt_extend ?? true,
    watermark: normalized.watermark ?? false,
  }
  if (normalized.negative_prompt !== undefined) result.negative_prompt = normalized.negative_prompt
  if (normalized.seed !== undefined) result.seed = normalized.seed
  return result
}

function mergeNegativePrompt(
  params: Record<string, unknown> | undefined,
  negativePrompt: string | undefined,
): Record<string, unknown> | undefined {
  const trimmed = negativePrompt?.trim()
  if (!trimmed) return params
  return { ...(params ?? {}), negative_prompt: trimmed }
}

function imageParameters(
  params: Record<string, unknown> | undefined,
  model: string,
  imageCount: number,
  skipParameterValidation = false,
): Record<string, unknown> {
  const normalized = normalizeBailianImageParams(params)
  const size = normalized.size
  if (
    !skipParameterValidation &&
    size !== undefined &&
    (typeof size !== 'string' || !['1K', '2K', '4K'].includes(size))
  ) {
    throw new MediaProviderError('invalid_input', '万相 2.7 图像 size 仅支持 1K、2K、4K')
  }
  const enableSequential = normalized.enable_sequential === true
  if (
    !skipParameterValidation &&
    size === '4K' &&
    (model !== 'wan2.7-image-pro' || imageCount > 0 || enableSequential)
  ) {
    throw new MediaProviderError('invalid_input', '4K 仅支持 wan2.7-image-pro 的非组图纯文生图场景')
  }
  if (
    !skipParameterValidation &&
    model !== 'wan2.7-image-pro' &&
    normalized.color_palette !== undefined
  ) {
    throw new MediaProviderError('invalid_input', 'color_palette 仅支持 wan2.7-image-pro')
  }
  const n = normalized.n
  if (
    !skipParameterValidation &&
    n !== undefined &&
    (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > (enableSequential ? 12 : 4))
  ) {
    throw new MediaProviderError(
      'invalid_input',
      `万相 2.7 ${enableSequential ? '组图' : '单图'} n 必须是 1-${enableSequential ? 12 : 4} 的整数`,
    )
  }
  return pick(
    normalized,
    ['n', 'watermark', 'thinking_mode', 'enable_sequential', 'bbox_list', 'color_palette', 'seed'],
    { size: size ?? '2K' },
  )
}

function videoParameters(
  params: Record<string, unknown> | undefined,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const normalized = normalizeBailianVideoParams(params)
  if (normalized.duration === undefined && normalized.durationSeconds !== undefined)
    normalized.duration = normalized.durationSeconds
  const defaults: Record<string, unknown> = ctx.mediaDefaults?.video ?? {}
  for (const key of ['resolution', 'duration', 'watermark']) {
    if (normalized[key] === undefined && defaults?.[key] !== undefined)
      normalized[key] = defaults[key]
  }
  if (normalized.duration === undefined && defaults?.durationSeconds !== undefined)
    normalized.duration = defaults.durationSeconds
  return pick(normalized, [
    'resolution',
    'ratio',
    'duration',
    'prompt_extend',
    'watermark',
    'seed',
    'audio_setting',
  ])
}

function normalizeBailianImageParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const normalized = { ...(params ?? {}) }
  const aliases: Array<[string, string]> = [
    ['thinkingMode', 'thinking_mode'],
    ['enableSequential', 'enable_sequential'],
    ['bboxList', 'bbox_list'],
    ['colorPalette', 'color_palette'],
    ['negativePrompt', 'negative_prompt'],
    ['promptExtend', 'prompt_extend'],
  ]
  for (const [from, to] of aliases) {
    if (normalized[to] === undefined && normalized[from] !== undefined)
      normalized[to] = normalized[from]
  }
  return normalized
}

/**
 * A custom model ref may be displayed with a cloned Wan manifest so the
 * canvas can render its parameter controls. That clone must not impose Wan's
 * `1K/2K/4K` enum (custom Bailian models commonly expect `2048*1024`). Keep
 * the user's non-empty custom parameters and let the selected model validate
 * its own native parameter contract.
 */
function customImageParameters(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const normalized = normalizeBailianImageParams(params)
  return Object.fromEntries(
    Object.entries(normalized).filter(
      ([key, value]) => key !== 'filename' && value !== undefined && value !== null && value !== '',
    ),
  )
}

function isSynthesizedCustomImageManifest(ctx: MediaProviderContext): boolean {
  const manifest = ctx.mediaManifest
  return (
    manifest?.id.startsWith('custom:') === true &&
    manifest.providerKind !== 'custom' &&
    isMediaProviderKind(manifest.providerKind)
  )
}

function normalizeBailianVideoParams(
  params: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const normalized = { ...(params ?? {}) }
  const aliases: Array<[string, string]> = [
    ['aspectRatio', 'ratio'],
    ['promptExtend', 'prompt_extend'],
    ['audioSetting', 'audio_setting'],
  ]
  for (const [from, to] of aliases) {
    if (normalized[to] === undefined && normalized[from] !== undefined)
      normalized[to] = normalized[from]
  }
  return normalized
}

function pick(
  params: Record<string, unknown> | undefined,
  keys: string[],
  defaults: Record<string, unknown> = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults }
  for (const key of keys)
    if (params?.[key] !== undefined && params[key] !== null) result[key] = params[key]
  return result
}

function aigcBaseUrl(ctx: MediaProviderContext): string {
  const endpoint = (
    ctx.apiEndpoint || 'https://dashscope.aliyuncs.com/api/v1/services/aigc'
  ).replace(/\/+$/, '')
  // A provider profile may reuse Bailian's OpenAI-compatible endpoint
  // (`/compatible-mode/v1`) for chat and media. Media generation, however,
  // is exposed by the native DashScope API. Convert the workspace endpoint
  // before appending the native AIGC routes; otherwise requests become
  // `/compatible-mode/v1/api/v1/services/aigc/...` and return 404.
  const compatibleModeSuffix = '/compatible-mode/v1'
  if (endpoint.endsWith(compatibleModeSuffix)) {
    return `${endpoint.slice(0, -compatibleModeSuffix.length)}/api/v1/services/aigc`
  }
  if (endpoint.endsWith('/services/aigc')) return endpoint
  if (endpoint.endsWith('/api/v1')) return `${endpoint}/services/aigc`
  return `${endpoint}/api/v1/services/aigc`
}

function apiV1BaseUrl(ctx: MediaProviderContext): string {
  return aigcBaseUrl(ctx).replace(/\/services\/aigc$/, '')
}

function headers(ctx: MediaProviderContext): Record<string, string> {
  return { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}` }
}

function bailianError(_status: number, body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = body as {
    code?: unknown
    message?: unknown
    request_id?: unknown
    output?: { code?: unknown; message?: unknown }
  }
  const code =
    typeof value.code === 'string'
      ? value.code
      : typeof value.output?.code === 'string'
        ? value.output.code
        : undefined
  const message =
    typeof value.message === 'string'
      ? value.message
      : typeof value.output?.message === 'string'
        ? value.output.message
        : undefined
  const request = typeof value.request_id === 'string' ? ` (request_id: ${value.request_id})` : ''
  return code || message
    ? `${code ?? 'BailianError'}: ${message ?? 'request failed'}${request}`
    : undefined
}

function requestId(value: unknown): string | undefined {
  return value &&
    typeof value === 'object' &&
    typeof (value as { request_id?: unknown }).request_id === 'string'
    ? (value as { request_id: string }).request_id
    : undefined
}

function normalizeImageValue(value: string): string {
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
}

function mimeType(filePath: string, kind: 'image' | 'audio'): string {
  const extension = path.extname(filePath).toLowerCase()
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  }
  return known[extension] ?? `${kind}/octet-stream`
}

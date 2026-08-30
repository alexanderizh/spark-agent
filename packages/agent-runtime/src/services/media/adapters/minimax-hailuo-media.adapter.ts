/**
 * MiniMax（minimaxi 开放平台）多媒体 adapter。
 *
 * 覆盖本轮开发的「主流 + 最新」模型，四条独立路径：
 *
 * 1. 图像生成（image-01 / image-01-live）—— `POST /v1/image_generation`，同步。
 *    - image.generate：文生图；image.edit：图生图（subject_reference 主体参考，仅 image-01）。
 *    - image-01-live 额外把 style_type / style_weight 组装成嵌套 `{style:{...}}`。
 *
 * 2. v1 视频生成（Hailuo-2.3 / 2.3-Fast）—— `POST /v1/video_generation` + `GET /v1/query/video_generation`。
 *    - t2v / i2v（首帧）；产物 file_id → `GET /v1/files/retrieve?file_id=` 拿 download_url（1h）→ 下载。
 *
 * 3. 视频 Agent 模板（video-agent）—— `POST /v1/video_template_generation` + `GET /v1/query/video_template_generation`。
 *    - template_id 驱动；产物直接含 video_url（9h CDN）→ 下载。
 *
 * 4. V2 视频生成（MiniMax-H3，最新主推）—— `POST /v2/video_generation`（content[] 多模态数组）+ `GET /v2/query/video_generation/{task_id}`。
 *    - t2v / i2v（首帧+尾帧）/ r2v（参考图+视频+音频，互斥）；产物 task.content.url → 下载。
 *
 * 错误模型（v1 与 V2 不同，来源：docs/integrations/minimax/video-models-v2.md §4.6 / auth-errors.md §2）：
 *   - v1 / 模板 / Files：HTTP 恒 200，业务码在 body `base_resp.status_code`(number)；fetchJson 不抛，
 *     adapter 主动 assertMinimaxBaseResp 检测后本地映射码并抛错。
 *   - V2 (H3)：真实 HTTP 状态码 + OAI `{error:{type,message,http_code}}`；fetchJson 在 !res.ok 抛错，
 *     用 manifest.error(minimaxV2ErrorContract) 归一 + 本地 errorExtractor 组装消息。
 *
 * 状态枚举：v1/模板首字母大写（Success/Fail）；V2 全小写（succeeded/failed/expired）。各自独立 inspect。
 */

import { DEFAULT_VIDEO_POLL_TIMEOUT_MS, normalizeMinimaxBaseUrl } from '@spark/protocol'
import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { MediaProviderError, mediaAdapterModelId } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaGeneratedAsset,
  MediaInputFile,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import {
  extractTaskId,
  fetchJson,
  pollTask,
  type ErrorExtractor,
  type ExtractedImage,
} from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import { resolveMinimaxHailuoMediaReference } from '../minimax-hailuo-media-input.js'
import { MinimaxHailuoFilesClient } from '../minimax-hailuo-files.client.js'
import { assertMinimaxBaseResp } from '../minimax-hailuo-error.js'
import {
  configuredMediaInterfaceTimeoutMs,
  mediaPollTimeoutOptions,
  resolveMediaInterfaceTimeoutMs,
} from '../media-timeout.js'
import { clampInt, filenameHelper } from './openai-compatible-media.adapter.js'

const log = createLogger('media:minimax-hailuo')

const IMAGE_CAPABILITIES: readonly MediaCapabilityId[] = ['image.generate', 'image.edit']
const VIDEO_CAPABILITIES: readonly MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
]
// 音频（speech-2.8-hd/turbo 文生语音、music-2.6 文生音乐），均走 v1 通道（HTTP 恒 200 + base_resp 业务码）。
// 来源：docs/integrations/minimax/speech-music.md §1（T2A HTTP）/ §6（Music Generation）。
const AUDIO_CAPABILITIES: readonly MediaCapabilityId[] = ['audio.speech', 'audio.music']

/** V2(H3) content[] 元素（简化类型，仅描述发送形态）。 */
type MinimaxV2ContentItem =
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string }
      role: 'first_frame' | 'last_frame' | 'reference_image'
    }
  | { type: 'video_url'; video_url: { url: string }; role: 'reference_video' }
  | { type: 'audio_url'; audio_url: { url: string }; role: 'reference_audio' }

// v1/Files 的 base_resp 归一（MINIMAX_V1_ERROR_MAP + assertMinimaxBaseResp）已抽到
// minimax-hailuo-error.ts，adapter 与 files client 共用，避免两处错误行为不一致。

const V1_SUCCEEDED_STATUS = 'Success'
const V1_FAILED_STATUS = 'Fail'
const V2_SUCCEEDED_STATUS = 'succeeded'
// V2 终态失败：failed（生成失败）/ expired（超 7 天保留期）/ cancelled（用户或系统取消）。
// cancelled 也是终态，必须终止轮询，否则会一直 pending 直到超时（来源 video-models-v2.md §5.3）。
const V2_FAILED_STATUSES = ['failed', 'expired', 'cancelled']

export class MinimaxHailuoMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'minimax-hailuo'
  private readonly capabilities = new Set<MediaCapabilityId>([
    ...IMAGE_CAPABILITIES,
    ...VIDEO_CAPABILITIES,
    ...AUDIO_CAPABILITIES,
  ])
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) throw new MediaProviderError('api_key_missing', 'Missing MiniMax API key')
    const capability = input.capability
    if (!capability) {
      throw new MediaProviderError(
        'capability_not_supported',
        'No capability resolved for minimax-hailuo invoke',
      )
    }
    if (!this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `minimax-hailuo does not support ${capability}`,
      )
    }
    if (capability.startsWith('image.')) return this.generateImage(input, ctx)
    if (capability.startsWith('audio.')) return this.generateAudio(input, ctx)
    return this.generateVideo(input, ctx)
  }

  // ─── 图像路径（image-01 / image-01-live，/v1/image_generation，同步）──────────

  private async generateImage(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', `MiniMax ${capability} requires a prompt`)
    }
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const params = buildMinimaxImageParams(input, ctx)
    const body: Record<string, unknown> = { model, prompt, ...params }

    // 图生图（image.edit）：subject_reference 主体参考。官方当前仅 image-01 + type=character + 单张。
    if (capability === 'image.edit') {
      const refFiles = (input.inputFiles ?? []).filter(isImageInput)
      const refFile = refFiles[0]
      if (!refFile) {
        throw new MediaProviderError(
          'invalid_input',
          'MiniMax 图生图需要一张主体参考图（role=reference）',
        )
      }
      const ref = await resolveMinimaxHailuoMediaReference(refFile, 'image', ctx, {
        allowMmFile: false,
      })
      body.subject_reference = [{ type: 'character', image_file: ref }]
    }

    const url = `${base}/v1/image_generation`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120) },
    })

    const resp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 120_000),
    })
    assertMinimaxBaseResp(resp)
    const images = extractMinimaxImages(resp)
    if (images.length === 0) {
      logMediaResult({ provider: this.id, capability, ok: false, error: 'No images in response' })
      throw new MediaProviderError(
        'provider_http_error',
        `No images in MiniMax response: ${JSON.stringify(resp).slice(0, 800)}`,
      )
    }
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: images.length })
    const assets = await Promise.all(
      images.map((image, index) =>
        this.artifact.writeImage(
          image,
          input.outputDir,
          filenameHelper(input, 'minimax-image', index, images.length),
          ctx.fetch,
          configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
        ),
      ),
    )
    return { provider: this.id, model, mode: 'sync', assets, rawResponse: resp }
  }

  // ─── 音频路径：speech（T2A）/ music，均同步返回，走 /v1 通道 ────────────────

  private async generateAudio(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    if (capability === 'audio.music') return this.generateMusic(input, ctx)
    return this.generateSpeech(input, ctx)
  }

  // ─── 文生语音 T2A（speech-2.8-hd/turbo，POST /v1/t2a_v2，同步）──────────────
  // 文档：docs/integrations/minimax/speech-music.md §1。必填 model + text；
  // voice_setting.voice_id 必填（schema 字段名 voice，映射到官方 voice_id）。
  // 错误归一复用 assertMinimaxBaseResp（T2A HTTP base_resp 子集见 §1.5）。

  private async generateSpeech(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = 'audio.speech' as MediaCapabilityId
    const text = (input.prompt ?? '').trim()
    if (!text) {
      throw new MediaProviderError('invalid_input', 'MiniMax T2A 需要文本（prompt）')
    }
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const params = buildMinimaxSpeechParams(input, ctx)
    if (!params.voice_id) {
      throw new MediaProviderError(
        'invalid_input',
        'MiniMax T2A 需要 voice_id（modelParams.voice 或 provider mediaDefaults.audio.voice）',
      )
    }

    const voiceSetting: Record<string, unknown> = { voice_id: params.voice_id }
    if (params.speed != null) voiceSetting.speed = params.speed
    if (params.vol != null) voiceSetting.vol = params.vol
    if (params.pitch != null) voiceSetting.pitch = params.pitch
    if (params.emotion) voiceSetting.emotion = params.emotion

    const body: Record<string, unknown> = {
      model,
      text,
      stream: false,
      output_format: params.output_format, // 'url' | 'hex'，默认 url
      voice_setting: voiceSetting,
      audio_setting: { format: params.format ?? 'mp3' },
      aigc_watermark: params.aigc_watermark ?? false,
    }
    if (params.language_boost) body.language_boost = params.language_boost
    if (params.subtitle_enable != null) {
      body.subtitle_enable = params.subtitle_enable
      if (params.subtitle_type) body.subtitle_type = params.subtitle_type
    }

    const url = `${base}/v1/t2a_v2`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { text: text.slice(0, 120), voice: params.voice_id },
    })

    const resp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 120_000),
    })
    assertMinimaxBaseResp(resp)

    const asset = await this.writeMinimaxAudioAsset(
      resp,
      input,
      'minimax-speech',
      params.output_format,
      params.format,
      ctx,
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1 })
    return { provider: this.id, model, mode: 'sync', assets: [asset], rawResponse: resp }
  }

  // ─── 文生音乐（music-2.6，POST /v1/music_generation，同步）──────────────────
  // 文档：docs/integrations/minimax/speech-music.md §6。必填 model；prompt/lyrics 条件必填。
  // 错误归一复用 assertMinimaxBaseResp（Music base_resp 子集见 §6.1）。

  private async generateMusic(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = 'audio.music' as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    if (!prompt) {
      throw new MediaProviderError('invalid_input', 'MiniMax 音乐生成需要描述（prompt）')
    }
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const params = buildMinimaxMusicParams(input, ctx)
    const body: Record<string, unknown> = {
      model,
      prompt,
      output_format: params.output_format,
      // audio_setting.format 始终传（§6.1 L425/L433：mp3/wav/pcm，默认 mp3），
      // 与 T2A 一致；否则用户选的 format 静默丢失且 hex 落盘 mimeType 与实际不符。
      audio_setting: { format: params.format ?? 'mp3' },
      aigc_watermark: params.aigc_watermark ?? false,
    }
    if (params.lyrics) body.lyrics = params.lyrics
    if (params.is_instrumental != null) body.is_instrumental = params.is_instrumental
    if (params.lyrics_optimizer != null) body.lyrics_optimizer = params.lyrics_optimizer

    const url = `${base}/v1/music_generation`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120) },
    })

    const resp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 180_000),
    })
    assertMinimaxBaseResp(resp)

    const asset = await this.writeMinimaxAudioAsset(
      resp,
      input,
      'minimax-music',
      params.output_format,
      params.format,
      ctx,
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1 })
    return { provider: this.id, model, mode: 'sync', assets: [asset], rawResponse: resp }
  }

  /**
   * MiniMax 音频产物落盘：response.data.audio 在 output_format=url 时是下载 URL，
   * hex 时是 16 进制编码字符串（§1.5 / §6.1）。url 复用 downloadMediaAsset（含重试），
   * hex 用 Buffer.from(hex,'hex') + writeBinaryAsset。
   *
   * 字段读取：T2A 的 data.audio 为 url/hex 双形态（§1.5 L100「格式与请求指定输出格式一致」）；
   * Music hex 走 data.audio（§6.1 L446），但 url 模式返回字段名官方 schema 未定义（MusicData 仅
   * status/audio，文档 L461/L535 标注「需实调验证」）——故 url 模式优先 data.audio，回退 data.url 兜底。
   */
  private async writeMinimaxAudioAsset(
    resp: unknown,
    input: MediaGenerateInput,
    filePrefix: string,
    outputFormat: string | undefined,
    format: string | undefined,
    ctx: MediaProviderContext,
  ): Promise<MediaGeneratedAsset> {
    const audioRaw = readPath(resp, 'data', 'audio') ?? readPath(resp, 'data', 'url')
    if (typeof audioRaw !== 'string' || audioRaw.length === 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `No audio in MiniMax response: ${JSON.stringify(resp).slice(0, 800)}`,
      )
    }
    const filename = filenameHelper(input, filePrefix, 0, 1)
    if (outputFormat === 'hex') {
      const buffer = Buffer.from(audioRaw, 'hex')
      return this.artifact.writeBinaryAsset(
        'audio',
        buffer,
        input.outputDir,
        filename,
        mimeTypeFromAudioFormat(format),
      )
    }
    return this.artifact.downloadMediaAsset(
      'audio',
      audioRaw,
      input.outputDir,
      filename,
      ctx.fetch,
      configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
    )
  }

  // ─── 视频路径：按 modelId 分流到 v1 / 模板 / V2(H3) ─────────────────────────

  private async generateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const modelId = mediaAdapterModelId(ctx)
    if (modelId === 'video-agent') return this.generateTemplateVideo(input, ctx)
    if (modelId === 'MiniMax-H3') return this.generateV2Video(input, ctx)
    return this.generateV1Video(input, ctx)
  }

  // ─── v1 视频（Hailuo-2.3 / -Fast）───────────────────────────────────────────

  private async generateV1Video(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const body: Record<string, unknown> = { model, ...buildMinimaxV1VideoParams(input, ctx) }
    if (prompt) body.prompt = prompt

    if (capability === 'video.image_to_video') {
      const frameFile = (input.inputFiles ?? []).filter(isImageInput)[0]
      if (!frameFile) {
        throw new MediaProviderError(
          'invalid_input',
          'MiniMax v1 图生视频需要一张首帧图（role=first_frame）',
        )
      }
      body.first_frame_image = await resolveMinimaxHailuoMediaReference(frameFile, 'image', ctx, {
        allowMmFile: false,
      })
    }

    const url = `${base}/v1/video_generation`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { prompt: prompt.slice(0, 120), firstFrame: capability === 'video.image_to_video' },
    })

    const createResp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 60_000),
    })
    assertMinimaxBaseResp(createResp)
    const taskId = extractTaskId(createResp)
    if (!taskId) {
      throw new MediaProviderError(
        'provider_http_error',
        `No task_id in MiniMax v1 response: ${JSON.stringify(createResp).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: taskId, response: createResp })
    log.info(`event=task-created capability=${capability} model=${model} requestId=${taskId}`)

    const pollUrl = `${base}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`
    const queryResp = await pollTask(pollUrl, authHeaders(ctx), {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
      ...mediaPollTimeoutOptions(ctx.mediaDefaults, DEFAULT_VIDEO_POLL_TIMEOUT_MS),
      inspect: (data) => {
        assertMinimaxBaseResp(data)
        const status = minimaxStatus(data)
        if (status === V1_SUCCEEDED_STATUS) return 'done'
        if (status === V1_FAILED_STATUS) return 'failed'
        return 'pending'
      },
      logContext: `provider=minimax-hailuo capability=${capability} requestId=${taskId}`,
      describeResponse: describeMinimaxV1PollResponse,
    })

    // v1 产物：query 返回 file_id(string) → retrieve 拿 download_url(1h) → 下载。
    const fileId = readPath(queryResp, 'file_id') ?? readPath(queryResp, 'data', 'file_id')
    const directUrl =
      typeof fileId === 'string' && fileId
        ? await this.resolveV1DownloadUrl(fileId, ctx)
        : undefined
    if (!directUrl) {
      throw new MediaProviderError(
        'provider_http_error',
        `MiniMax v1 任务成功但未取到 download_url: ${JSON.stringify(queryResp).slice(0, 800)}`,
      )
    }
    const asset = await this.artifact.downloadMediaAsset(
      'video',
      directUrl,
      input.outputDir,
      filenameHelper(input, 'hailuo', 0, 1),
      ctx.fetch,
      configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1, requestId: taskId })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: taskId,
      assets: [asset],
      rawResponse: queryResp,
    }
  }

  /** v1 视频：file_id → GET /v1/files/retrieve 拿 download_url（1h 有效）。 */
  private async resolveV1DownloadUrl(
    fileId: string,
    ctx: MediaProviderContext,
  ): Promise<string | undefined> {
    const file = await new MinimaxHailuoFilesClient({
      apiKey: ctx.apiKey,
      apiEndpoint: ctx.apiEndpoint,
      ...(ctx.fetch ? { fetch: ctx.fetch } : {}),
    }).retrieve(fileId)
    return file.downloadUrl
  }

  // ─── 视频 Agent 模板（video-agent）──────────────────────────────────────────

  private async generateTemplateVideo(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)
    const templateId =
      stringVal(input.modelParams?.templateId) ?? stringVal(input.modelParams?.template_id)
    if (!templateId) {
      throw new MediaProviderError('invalid_input', 'MiniMax 视频 Agent 需要选择 template_id')
    }

    const body: Record<string, unknown> = { template_id: templateId }
    const mediaFiles = (input.inputFiles ?? []).filter(isImageInput)
    if (mediaFiles.length > 0) {
      const resolved = await Promise.all(
        mediaFiles.map((file) =>
          resolveMinimaxHailuoMediaReference(file, 'image', ctx, { allowMmFile: false }),
        ),
      )
      body.media_inputs = resolved.map((value) => ({ value }))
    }
    const prompt = (input.prompt ?? '').trim()
    if (prompt) body.text_inputs = [{ value: prompt }]
    const callbackUrl =
      stringVal(input.modelParams?.callbackUrl) ?? stringVal(input.modelParams?.callback_url)
    if (callbackUrl) body.callback_url = callbackUrl

    const url = `${base}/v1/video_template_generation`
    logMediaCall({
      provider: this.id,
      capability,
      model,
      method: 'POST',
      url,
      body,
      extra: { templateId },
    })

    const createResp = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 60_000),
    })
    assertMinimaxBaseResp(createResp)
    const taskId = extractTaskId(createResp)
    if (!taskId) {
      throw new MediaProviderError(
        'provider_http_error',
        `No task_id in MiniMax template response: ${JSON.stringify(createResp).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: taskId, response: createResp })

    const pollUrl = `${base}/v1/query/video_template_generation?task_id=${encodeURIComponent(taskId)}`
    const queryResp = await pollTask(pollUrl, authHeaders(ctx), {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
      ...mediaPollTimeoutOptions(ctx.mediaDefaults, DEFAULT_VIDEO_POLL_TIMEOUT_MS),
      inspect: (data) => {
        assertMinimaxBaseResp(data)
        const status = minimaxStatus(data)
        if (status === V1_SUCCEEDED_STATUS) return 'done'
        if (status === V1_FAILED_STATUS) return 'failed'
        return 'pending'
      },
      logContext: `provider=minimax-hailuo capability=template requestId=${taskId}`,
      describeResponse: describeMinimaxTemplatePollResponse,
    })

    const videoUrl = readPath(queryResp, 'video_url') ?? readPath(queryResp, 'data', 'video_url')
    if (typeof videoUrl !== 'string' || !videoUrl) {
      throw new MediaProviderError(
        'provider_http_error',
        `MiniMax 模板任务成功但未取到 video_url: ${JSON.stringify(queryResp).slice(0, 800)}`,
      )
    }
    const asset = await this.artifact.downloadMediaAsset(
      'video',
      videoUrl,
      input.outputDir,
      filenameHelper(input, 'minimax-template', 0, 1),
      ctx.fetch,
      configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1, requestId: taskId })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: taskId,
      assets: [asset],
      rawResponse: queryResp,
    }
  }

  // ─── V2 视频（MiniMax-H3，content[] 多模态数组）─────────────────────────────

  private async generateV2Video(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = input.capability as MediaCapabilityId
    const prompt = (input.prompt ?? '').trim()
    const model = ctx.defaultModel
    const base = baseEndpoint(ctx)

    const content = await buildMinimaxV2Content(input, ctx, capability, prompt)
    if (content.length === 0 || !content.some((item) => item.type === 'text')) {
      throw new MediaProviderError(
        'invalid_input',
        'MiniMax H3 每次请求必须包含至少一个非空 text 项',
      )
    }
    const params = buildMinimaxV2VideoParams(input, ctx, capability)
    const body: Record<string, unknown> = { model, content, ...params }

    const url = `${base}/v2/video_generation`
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
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 60_000),
      errorExtractor: minimaxV2ErrorExtractor,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
    })
    const taskId = extractTaskId(createResp)
    if (!taskId) {
      throw new MediaProviderError(
        'provider_http_error',
        `No task_id in MiniMax V2 response: ${JSON.stringify(createResp).slice(0, 800)}`,
      )
    }
    ctx.onTaskSubmitted?.({ requestId: taskId, response: createResp })
    log.info(`event=task-created capability=${capability} model=${model} requestId=${taskId}`)

    const pollUrl = `${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`
    const queryResp = await pollTask(pollUrl, authHeaders(ctx), {
      fetchImpl: ctx.fetch,
      intervalMs: ctx.mediaDefaults?.polling?.intervalMs ?? 5_000,
      ...mediaPollTimeoutOptions(ctx.mediaDefaults, DEFAULT_VIDEO_POLL_TIMEOUT_MS),
      errorExtractor: minimaxV2ErrorExtractor,
      ...(ctx.mediaManifest?.error ? { errorContract: ctx.mediaManifest.error } : {}),
      inspect: (data) => {
        const status = readPath(data, 'task', 'status') ?? readPath(data, 'status')
        const statusText = typeof status === 'string' ? status : ''
        if (statusText === V2_SUCCEEDED_STATUS) return 'done'
        if (V2_FAILED_STATUSES.includes(statusText)) return 'failed'
        return 'pending'
      },
      logContext: `provider=minimax-hailuo capability=${capability} requestId=${taskId}`,
      describeResponse: describeMinimaxV2PollResponse,
    })

    const videoUrl =
      readPath(queryResp, 'task', 'content', 'url') ?? readPath(queryResp, 'content', 'url')
    if (typeof videoUrl !== 'string' || !videoUrl) {
      throw new MediaProviderError(
        'provider_http_error',
        `MiniMax V2 任务成功但未取到 content.url: ${JSON.stringify(queryResp).slice(0, 800)}`,
      )
    }
    const asset = await this.artifact.downloadMediaAsset(
      'video',
      videoUrl,
      input.outputDir,
      filenameHelper(input, 'hailuo-h3', 0, 1),
      ctx.fetch,
      configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1, requestId: taskId })
    return {
      provider: this.id,
      model,
      mode: 'async',
      requestId: taskId,
      assets: [asset],
      rawResponse: queryResp,
    }
  }
}

// ─── 请求体构造 ──────────────────────────────────────────────────────────────

/**
 * T2A 请求参数（speech-2.8-hd/turbo）。schema 字段名 voice 映射到官方 voice_setting.voice_id；
 * voice 缺失时用 provider mediaDefaults.audio.voice 兜底（来源 §1.2）。
 * output_format 默认 url（与 manifest capability defaults 一致；hex 模式 data.audio 返回 hex 字符串）。
 */
function buildMinimaxSpeechParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): {
  voice_id: string | undefined
  speed: number | undefined
  vol: number | undefined
  pitch: number | undefined
  emotion: string | undefined
  language_boost: string | undefined
  format: string | undefined
  output_format: string
  aigc_watermark: boolean | undefined
  subtitle_enable: boolean | undefined
  subtitle_type: string | undefined
} {
  const raw = removeBlankParams(input.modelParams)
  const aliases = ctx.mediaManifestCapability?.aliases
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases?.[key] ?? key] = value
  }
  const defaultsVoice = ctx.mediaDefaults?.audio?.voice
  return {
    voice_id:
      stringVal(normalized.voice) ??
      stringVal(normalized.voice_id) ??
      (typeof defaultsVoice === 'string' && defaultsVoice ? defaultsVoice : undefined),
    speed: numberVal(normalized.speed),
    vol: numberVal(normalized.vol),
    pitch: numberVal(normalized.pitch),
    emotion: stringVal(normalized.emotion),
    language_boost: stringVal(normalized.language_boost),
    format: stringVal(normalized.format),
    output_format: stringVal(normalized.output_format) ?? 'url',
    aigc_watermark: boolVal(normalized.aigc_watermark),
    subtitle_enable: boolVal(normalized.subtitle_enable),
    subtitle_type: stringVal(normalized.subtitle_type),
  }
}

/** 音乐生成请求参数（music-2.6，§6.1）。output_format 默认 url。 */
function buildMinimaxMusicParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): {
  lyrics: string | undefined
  output_format: string
  aigc_watermark: boolean | undefined
  lyrics_optimizer: boolean | undefined
  is_instrumental: boolean | undefined
  format: string | undefined
} {
  const raw = removeBlankParams(input.modelParams)
  const aliases = ctx.mediaManifestCapability?.aliases
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases?.[key] ?? key] = value
  }
  return {
    lyrics: stringVal(normalized.lyrics),
    output_format: stringVal(normalized.output_format) ?? 'url',
    aigc_watermark: boolVal(normalized.aigc_watermark),
    lyrics_optimizer: boolVal(normalized.lyrics_optimizer),
    is_instrumental: boolVal(normalized.is_instrumental),
    format: stringVal(normalized.format),
  }
}

/** audio_setting.format → mime 类型（hex 模式落盘用；来源 §1.3 / §6.1）。 */
function mimeTypeFromAudioFormat(format: string | undefined): string {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'pcm':
      return 'audio/pcm'
    case 'flac':
      return 'audio/flac'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

/** 图像请求参数：从 modelParams + manifest aliases 归一，image-01-live 组装嵌套 style。 */
function buildMinimaxImageParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const raw = removeBlankParams(input.modelParams)
  const aliases = ctx.mediaManifestCapability?.aliases
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases?.[key] ?? key] = value
  }
  const params: Record<string, unknown> = {}
  const aspectRatio = stringVal(normalized.aspect_ratio) ?? stringVal(normalized.aspectRatio)
  const model = mediaAdapterModelId(ctx)
  if (aspectRatio) {
    params.aspect_ratio = normalizeMinimaxImageAspectRatio(aspectRatio, model, ctx)
  }
  // width/height 仅 image-01 生效；与 aspect_ratio 同时设置时官方优先 aspect_ratio，故仅未设比例时透传。
  if (!aspectRatio) {
    const width = numberVal(normalized.width)
    const height = numberVal(normalized.height)
    if (width != null || height != null) {
      if (model !== 'image-01') {
        throw new MediaProviderError('invalid_input', 'MiniMax 仅 image-01 支持自定义宽高')
      }
      if (width == null || height == null) {
        throw new MediaProviderError(
          'invalid_input',
          'MiniMax 自定义宽高必须同时填写 width 和 height',
        )
      }
      validateMinimaxImageDimension(width, 'width')
      validateMinimaxImageDimension(height, 'height')
      params.width = width
      params.height = height
    }
  }
  const responseFormat =
    stringVal(normalized.response_format) ?? stringVal(normalized.responseFormat)
  if (responseFormat) params.response_format = responseFormat
  const seed = numberVal(normalized.seed)
  if (seed != null) params.seed = seed
  const n = numberVal(normalized.n)
  if (n != null) params.n = clampInt(n, undefined, 1, 1, 9)
  const promptOptimizer = boolVal(normalized.prompt_optimizer)
  if (promptOptimizer != null) params.prompt_optimizer = promptOptimizer
  const watermark = boolVal(normalized.aigc_watermark)
  if (watermark != null) params.aigc_watermark = watermark

  // image-01-live 画风：顶层 style_type / style_weight 组装成 {style:{...}}。
  const styleType = stringVal(normalized.style_type)
  if (styleType && ctx.mediaManifestCapability?.paramSchema && hasParam(ctx, 'style_type')) {
    const style: Record<string, unknown> = { style_type: styleType }
    const styleWeight = numberVal(normalized.style_weight)
    if (styleWeight != null) style.style_weight = styleWeight
    params.style = style
  }
  return params
}

const MINIMAX_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
] as const

function normalizeMinimaxImageAspectRatio(
  value: string,
  model: string,
  ctx: MediaProviderContext,
): string {
  const manifestValues = manifestStringEnumValues(ctx, 'aspectRatio')
  const allowed: readonly string[] =
    manifestValues ??
    (model === 'image-01-live'
      ? MINIMAX_IMAGE_ASPECT_RATIOS.filter((ratio) => ratio !== '21:9')
      : MINIMAX_IMAGE_ASPECT_RATIOS)
  if (!allowed.includes(value)) {
    throw new MediaProviderError('invalid_input', `MiniMax ${model} 不支持画幅 ${value}`)
  }
  return value
}

function validateMinimaxImageDimension(value: number, name: 'width' | 'height'): void {
  if (!Number.isInteger(value) || value < 512 || value > 2048 || value % 8 !== 0) {
    throw new MediaProviderError('invalid_input', `MiniMax ${name} 必须是 512–2048 且为 8 的倍数`)
  }
}

function manifestStringEnumValues(
  ctx: MediaProviderContext,
  paramName: string,
): string[] | undefined {
  const schema = ctx.mediaManifestCapability?.paramSchema
  if (!schema || typeof schema !== 'object') return undefined
  const properties = (schema as { properties?: Record<string, unknown> }).properties
  const property = properties?.[paramName]
  if (!property || typeof property !== 'object') return undefined
  const values = (property as { enum?: unknown[] }).enum
  if (!Array.isArray(values)) return undefined
  return values.filter((item): item is string => typeof item === 'string')
}

/** v1 视频请求参数（Hailuo-2.3 / -Fast）。 */
function buildMinimaxV1VideoParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
): Record<string, unknown> {
  const raw = removeBlankParams(input.modelParams)
  const aliases = ctx.mediaManifestCapability?.aliases
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases?.[key] ?? key] = value
  }
  const params: Record<string, unknown> = {}
  const duration = numberVal(normalized.duration) ?? numberVal(normalized.durationSeconds)
  if (duration != null) {
    if (duration !== 6 && duration !== 10) {
      throw new MediaProviderError(
        'invalid_input',
        'MiniMax Hailuo-2.3/-Fast duration 仅支持 6 或 10 秒',
      )
    }
    params.duration = duration
  }
  const resolution = stringVal(normalized.resolution)
  if (resolution) params.resolution = resolution
  if (resolution === '1080P' && duration === 10) {
    throw new MediaProviderError('invalid_input', 'MiniMax Hailuo-2.3/-Fast 的 1080P 仅支持 6 秒')
  }
  const promptOptimizer = boolVal(normalized.prompt_optimizer)
  if (promptOptimizer != null) params.prompt_optimizer = promptOptimizer
  const fastPretreatment = boolVal(normalized.fast_pretreatment)
  if (fastPretreatment != null) params.fast_pretreatment = fastPretreatment
  const watermark = boolVal(normalized.aigc_watermark)
  if (watermark != null) params.aigc_watermark = watermark
  const callbackUrl = stringVal(normalized.callback_url) ?? stringVal(normalized.callbackUrl)
  if (callbackUrl) params.callback_url = callbackUrl
  return params
}

/**
 * V2(H3) 视频请求参数：resolution 透传（768P/2K，默认 2K），duration [4,15]，ratio，watermark。
 * resolution 是官方必填字段恒发；非枚举值兜底 2K（validator 已拦，此处二次防御）。
 */
function buildMinimaxV2VideoParams(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
  capability: MediaCapabilityId,
): Record<string, unknown> {
  const raw = removeBlankParams(input.modelParams)
  // 先按 manifest aliases 归一，再读字段。读取顺序统一为 canonical 优先、原生兜底：
  // 经公共 compiler 的路径，modelParams 已统一为 canonical key（aspectRatio / durationSeconds）；
  // 自 Phase 1 起 defaults 也与 raw 走同一套归一（见 mergeDefaults），不再出现同义键并存。
  // 保留原生 key（ratio / duration / aspect_ratio）兜底，用于不经 compiler 的入口——
  // custom manifest（isSynthesizedCustomManifest 绕过 compiler）、历史任务存库值、
  // 画布直传与 adapter 直调——这些入口仍可能携带 provider 原生键名。
  const aliases = ctx.mediaManifestCapability?.aliases
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    normalized[aliases?.[key] ?? key] = value
  }
  const params: Record<string, unknown> = {}
  // resolution 官方枚举 768P / 2K，必填；缺省或非枚举值统一兜底 2K。
  const resolutionRaw = stringVal(normalized.resolution)
  params.resolution = resolutionRaw === '768P' || resolutionRaw === '2K' ? resolutionRaw : '2K'
  const duration = numberVal(normalized.durationSeconds) ?? numberVal(normalized.duration)
  if (duration != null) params.duration = clampInt(duration, undefined, 5, 4, 15)
  const ratio =
    stringVal(normalized.aspectRatio) ??
    stringVal(normalized.aspect_ratio) ??
    stringVal(normalized.ratio)
  if (ratio) {
    params.ratio = ratio
  } else {
    // t2v 必填且不能为 adaptive；i2v/r2v 默认 adaptive。
    params.ratio = capability === 'video.generate' ? '16:9' : 'adaptive'
  }
  const watermark = boolVal(normalized.aigc_watermark)
  if (watermark != null) params.aigc_watermark = watermark
  const callbackUrl = stringVal(normalized.callback_url) ?? stringVal(normalized.callbackUrl)
  if (callbackUrl) params.callback_url = callbackUrl
  return params
}

/**
 * 组装 V2(H3) content[] 数组。capability 决定角色语义：
 *   - video.image_to_video：图片为 first_frame / last_frame（i2v）；
 *   - video.reference_to_video：图/视频/音频为 reference_*（r2v）；
 *   - video.generate：仅 text（t2v，不接受媒体）。
 * i2v 与 r2v 由 capability 天然互斥；validator 保证不混传。
 */
async function buildMinimaxV2Content(
  input: MediaGenerateInput,
  ctx: MediaProviderContext,
  capability: MediaCapabilityId,
  prompt: string,
): Promise<MinimaxV2ContentItem[]> {
  const content: MinimaxV2ContentItem[] = []
  if (prompt) content.push({ type: 'text', text: prompt })
  if (capability === 'video.generate') return content

  if (capability === 'video.image_to_video') {
    const images = (input.inputFiles ?? []).filter(isImageInput)
    const explicitFirst = images.find((file) => file.role === 'first_frame')
    const explicitLast = images.find((file) => file.role === 'last_frame')
    const first = explicitFirst ?? images[0]
    const last = explicitLast ?? (images.length > 1 && images[1] !== first ? images[1] : undefined)
    if (first) {
      const ref = await resolveMinimaxHailuoMediaReference(first, 'image', ctx, {
        allowMmFile: true,
      })
      content.push({ type: 'image_url', image_url: { url: ref }, role: 'first_frame' })
    }
    if (last) {
      const ref = await resolveMinimaxHailuoMediaReference(last, 'image', ctx, {
        allowMmFile: true,
      })
      content.push({ type: 'image_url', image_url: { url: ref }, role: 'last_frame' })
    }
    return content
  }

  // video.reference_to_video：参考图 / 参考视频 / 参考音频。
  for (const file of (input.inputFiles ?? []).filter(isImageInput)) {
    const ref = await resolveMinimaxHailuoMediaReference(file, 'image', ctx, { allowMmFile: true })
    content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' })
  }
  for (const file of (input.inputFiles ?? []).filter(isVideoInput)) {
    const ref = await resolveMinimaxHailuoMediaReference(file, 'video', ctx, { allowMmFile: true })
    content.push({ type: 'video_url', video_url: { url: ref }, role: 'reference_video' })
  }
  for (const file of (input.inputFiles ?? []).filter(isAudioInput)) {
    const ref = await resolveMinimaxHailuoMediaReference(file, 'audio', ctx, { allowMmFile: true })
    content.push({ type: 'audio_url', audio_url: { url: ref }, role: 'reference_audio' })
  }
  return content
}

// ─── 错误归一（v1 / V2）──────────────────────────────────────────────────────

// assertMinimaxBaseResp（v1/Files 的 base_resp 归一）见顶部 import 的 minimax-hailuo-error.ts。

/**
 * V2(H3) 错误提取器：OAI 风格 `{error:{type,message,http_code}, request_id}`，
 * HTTP 真实状态码（401/400/429/402/422/500）。fetchJson 在 !res.ok 时调用。
 * code 归一由 manifest.error(minimaxV2ErrorContract) 完成；本函数只组装消息文本。
 */
const minimaxV2ErrorExtractor: ErrorExtractor = (status, body) => {
  if (!body || typeof body !== 'object') return undefined
  const error = (body as Record<string, unknown>).error
  if (!error || typeof error !== 'object') return undefined
  const errFields = error as Record<string, unknown>
  const type = typeof errFields.type === 'string' ? errFields.type : ''
  const message = typeof errFields.message === 'string' ? errFields.message : ''
  if (!type && !message) return undefined
  const reqId =
    typeof (body as Record<string, unknown>).request_id === 'string'
      ? ((body as Record<string, unknown>).request_id as string)
      : ''
  const head = type ? `MiniMax V2 ${type}` : `MiniMax V2 HTTP ${status}`
  const tail = reqId ? ` (request_id: ${reqId})` : ''
  return message ? `${head}: ${message}${tail}` : `${head}${tail}`
}

// ─── 轮询响应摘要 ────────────────────────────────────────────────────────────

function describeMinimaxV1PollResponse(value: unknown): Record<string, unknown> {
  return {
    status: minimaxStatus(value) || 'unknown',
    fileId: stringVal(readPath(value, 'file_id')) ?? '',
  }
}

function describeMinimaxTemplatePollResponse(value: unknown): Record<string, unknown> {
  return {
    status: minimaxStatus(value) || 'unknown',
    hasVideoUrl: Boolean(readPath(value, 'video_url')),
  }
}

function describeMinimaxV2PollResponse(value: unknown): Record<string, unknown> {
  const status = readPath(value, 'task', 'status') ?? readPath(value, 'status')
  const url = readPath(value, 'task', 'content', 'url') ?? readPath(value, 'content', 'url')
  return {
    status: typeof status === 'string' ? status : 'unknown',
    hasVideoUrl: typeof url === 'string' && Boolean(url),
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function baseEndpoint(ctx: MediaProviderContext): string {
  // ProviderProfile.apiEndpoint = https://api.minimaxi.com（media preset）。去尾部斜杠，子路径在此拼接。
  return normalizeMinimaxBaseUrl(ctx.apiEndpoint ?? '')
}

function authHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${ctx.apiKey}`,
  }
}

function isImageInput(file: MediaInputFile): boolean {
  if (file.type === 'image') return true
  if (file.type !== 'file') return false
  if (file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/')) return false
  return true
}

function isVideoInput(file: MediaInputFile): boolean {
  return (
    file.type === 'video' || (file.type === 'file' && file.mimeType?.startsWith('video/') === true)
  )
}

function isAudioInput(file: MediaInputFile): boolean {
  return (
    file.type === 'audio' || (file.type === 'file' && file.mimeType?.startsWith('audio/') === true)
  )
}

/** 判断当前 capability 的 paramSchema 是否声明了某字段（image-01-live 画风守卫）。 */
function hasParam(ctx: MediaProviderContext, paramName: string): boolean {
  const schema = ctx.mediaManifestCapability?.paramSchema
  if (!schema || typeof schema !== 'object') return true
  const properties = (schema as { properties?: Record<string, unknown> }).properties
  if (!properties || typeof properties !== 'object') return true
  return paramName in properties
}

/** 读取 minimax image 响应 data.image_urls[] / data.image_base64[]。 */
function extractMinimaxImages(body: unknown): ExtractedImage[] {
  const data = readPath(body, 'data')
  if (!data || typeof data !== 'object') return []
  const urls = readPath(data, 'image_urls')
  const base64s = readPath(data, 'image_base64')
  const out: ExtractedImage[] = []
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (typeof u === 'string' && u) out.push({ kind: 'url', value: u })
    }
  }
  if (Array.isArray(base64s)) {
    for (const b of base64s) {
      if (typeof b === 'string' && b) out.push({ kind: 'base64', value: b, mimeType: 'image/png' })
    }
  }
  return out
}

/** 按点号路径读取嵌套字段（支持 data.image_urls 这类）。 */
function readPath(root: unknown, ...segments: string[]): unknown {
  return segments.reduce<unknown>((acc, key) => {
    if (acc == null) return undefined
    if (typeof acc !== 'object' || Array.isArray(acc)) return undefined
    return (acc as Record<string, unknown>)[key]
  }, root)
}

/**
 * 读取 v1/模板查询响应顶层 `status`（保留大小写）。
 * 注意：media-http.util 的 extractStatus 会 toLowerCase，而 minimax v1 状态枚举是
 * 首字母大写（Success/Fail），直接比较会失配，故这里按原文读取。
 */
function minimaxStatus(data: unknown): string {
  const value = readPath(data, 'status')
  return typeof value === 'string' ? value : ''
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

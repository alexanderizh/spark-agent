/**
 * 火山豆包语音（Volcengine Speech）多媒体 adapter。
 *
 * 与方舟（volcengine-ark）独立成 provider：
 *   - 方舟：ark.cn-beijing.volces.com，Authorization: Bearer，图片/视频
 *   - 语音：openspeech.bytedance.com，X-Api-Key，音频生成/语音合成
 *
 * 凭证来源不同控制台、域名/鉴权头全不同，因此独立成 provider（media-config.ts
 * 的 'volcengine-speech' kind），不复用 ark adapter。
 *
 * 覆盖两个音频能力：
 *
 * 1. 音频生成（seed-audio-1.0，audio.music）—— POST /api/v3/tts/create，同步。
 *    - 必填 model + text_prompt；可选 speaker / audio_config。
 *    - 响应体顶层 { code, message, audio(base64), url(2h), duration }，成功 code=0
 *      （music.md 响应体段）；adapter 优先用 url（downloadMediaAsset）。
 *    - 文档：docs/integrations/volcengine/music.md
 *
 * 2. 语音合成（seed-tts-2.0，audio.speech）—— POST /api/v3/tts/unidirectional，
 *    单向流式（HTTP Chunked）。
 *    - 鉴权三头：X-Api-Key + X-Api-Resource-Id:seed-tts-2.0 + X-Api-Request-Id(uuid)。
 *    - 必填 req_params.text + req_params.speaker；audio_params.format 等。
 *    - 响应：HTTP Chunked 二进制音频流，fetch.arrayBuffer() 累积所有 chunk 后落盘。
 *    - 文档：docs/integrations/volcengine/tts.md
 */

import type { MediaCapabilityId, MediaProviderKind } from '@spark/protocol'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import { MediaProviderError } from '../media-adapter.types.js'
import type {
  MediaGenerateInput,
  MediaGenerateOutput,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../media-adapter.types.js'
import { MediaArtifactService } from '../media-artifact.service.js'
import { fetchJson } from '../media-http.util.js'
import { logMediaCall, logMediaResult } from '../media-debug-log.js'
import {
  configuredMediaInterfaceTimeoutMs,
  resolveMediaInterfaceTimeoutMs,
} from '../media-timeout.js'
import { filenameHelper } from './openai-compatible-media.adapter.js'

const log = createLogger('media:volcengine-speech')

const AUDIO_CAPABILITIES: readonly MediaCapabilityId[] = ['audio.music', 'audio.speech']

const SPEECH_HOST = 'https://openspeech.bytedance.com'
const SEED_AUDIO_MODEL = 'seed-audio-1.0'
const SEED_TTS_RESOURCE_ID = 'seed-tts-2.0'

export class VolcengineSpeechMediaAdapter implements MediaProviderAdapter {
  readonly id: MediaProviderKind = 'volcengine-speech'
  private readonly capabilities = new Set<MediaCapabilityId>(AUDIO_CAPABILITIES)
  private readonly artifact = new MediaArtifactService()

  supports(capability: MediaCapabilityId): boolean {
    return this.capabilities.has(capability)
  }

  async invoke(input: MediaGenerateInput, ctx: MediaProviderContext): Promise<MediaGenerateOutput> {
    if (!ctx.apiKey) {
      throw new MediaProviderError('api_key_missing', 'Missing Volcengine Speech API key')
    }
    const capability = input.capability
    if (!capability || !this.supports(capability)) {
      throw new MediaProviderError(
        'capability_not_supported',
        `volcengine-speech does not support ${capability ?? '<none>'}`,
      )
    }
    if (capability === 'audio.music') return this.generateMusic(input, ctx)
    return this.generateSpeech(input, ctx)
  }

  // ─── 音频生成（seed-audio-1.0，/api/v3/tts/create，同步）──────────────────
  // 文档：docs/integrations/volcengine/music.md。必填 model + text_prompt；
  // 响应顶层 {code,message,audio(base64),url(2h),duration}，成功 code=0。
  private async generateMusic(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = 'audio.music' as MediaCapabilityId
    const textPrompt = (input.prompt ?? '').trim()
    if (!textPrompt) {
      throw new MediaProviderError('invalid_input', '豆包音频生成需要 text_prompt（prompt）')
    }
    const params = readMusicParams(input, ctx)

    const audioConfig: Record<string, unknown> = {}
    if (params.format) audioConfig.format = params.format
    if (params.sample_rate != null) audioConfig.sample_rate = params.sample_rate
    if (params.speech_rate != null) audioConfig.speech_rate = params.speech_rate
    if (params.loudness_rate != null) audioConfig.loudness_rate = params.loudness_rate
    if (params.pitch_rate != null) audioConfig.pitch_rate = params.pitch_rate
    if (params.enable_subtitle != null) audioConfig.enable_subtitle = params.enable_subtitle

    const body: Record<string, unknown> = {
      model: SEED_AUDIO_MODEL,
      text_prompt: textPrompt,
    }
    if (params.speaker) body.speaker = params.speaker
    if (Object.keys(audioConfig).length > 0) body.audio_config = audioConfig

    const url = `${SPEECH_HOST}/api/v3/tts/create`
    logMediaCall({
      provider: this.id,
      capability,
      model: SEED_AUDIO_MODEL,
      method: 'POST',
      url,
      body,
      extra: { textPrompt: textPrompt.slice(0, 120) },
    })

    const resp = (await fetchJson(url, {
      method: 'POST',
      headers: speechAuthHeaders(ctx),
      body: JSON.stringify(body),
      fetchImpl: ctx.fetch,
      timeoutMs: resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 180_000),
    })) as Record<string, unknown> | undefined

    // 业务码归一：顶层 code，成功为 0（music.md 响应体段）。
    const code = typeof resp?.code === 'number' ? resp.code : undefined
    if (code != null && code !== 0) {
      throw new MediaProviderError(
        'provider_http_error',
        `Volcengine audio ${code}: ${String(resp?.message ?? '').slice(0, 500)}`,
      )
    }

    const audioUrl = typeof resp?.url === 'string' ? resp.url : ''
    if (!audioUrl) {
      throw new MediaProviderError(
        'provider_http_error',
        `No audio url in Volcengine speech response: ${JSON.stringify(resp).slice(0, 800)}`,
      )
    }
    const filename = filenameHelper(input, 'volcengine-music', 0, 1)
    const asset = await this.artifact.downloadMediaAsset(
      'audio',
      audioUrl,
      input.outputDir,
      filename,
      ctx.fetch,
      configuredMediaInterfaceTimeoutMs(ctx.mediaDefaults),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1 })
    return {
      provider: this.id,
      model: SEED_AUDIO_MODEL,
      mode: 'sync',
      assets: [asset],
      rawResponse: resp,
    }
  }

  // ─── 语音合成（seed-tts-2.0，/api/v3/tts/unidirectional，单向流式）─────────
  // 文档：docs/integrations/volcengine/tts.md。HTTP Chunked 二进制音频流，
  // fetch.arrayBuffer() 累积所有 chunk 后落盘。鉴权三头：X-Api-Key +
  // X-Api-Resource-Id:seed-tts-2.0 + X-Api-Request-Id(uuid)。
  private async generateSpeech(
    input: MediaGenerateInput,
    ctx: MediaProviderContext,
  ): Promise<MediaGenerateOutput> {
    const capability = 'audio.speech' as MediaCapabilityId
    const text = (input.prompt ?? '').trim()
    if (!text) {
      throw new MediaProviderError('invalid_input', '豆包语音合成需要 text（prompt）')
    }
    const params = readSpeechParams(input, ctx)
    if (!params.speaker) {
      throw new MediaProviderError(
        'invalid_input',
        '豆包语音合成需要 speaker（modelParams.speaker 或 provider mediaDefaults.audio.voice）',
      )
    }

    const audioParams: Record<string, unknown> = {}
    if (params.format) audioParams.format = params.format
    if (params.sample_rate != null) audioParams.sample_rate = params.sample_rate
    if (params.bit_rate != null) audioParams.bit_rate = params.bit_rate
    if (params.speech_rate != null) audioParams.speech_rate = params.speech_rate
    if (params.loudness_rate != null) audioParams.loudness_rate = params.loudness_rate

    const body = {
      req_params: { text, speaker: params.speaker },
      audio_params: audioParams,
    }

    const url = `${SPEECH_HOST}/api/v3/tts/unidirectional`
    const headers: Record<string, string> = {
      ...speechAuthHeaders(ctx),
      'X-Api-Resource-Id': SEED_TTS_RESOURCE_ID,
      'X-Api-Request-Id': randomUUID(),
    }
    logMediaCall({
      provider: this.id,
      capability,
      model: SEED_TTS_RESOURCE_ID,
      method: 'POST',
      url,
      body,
      extra: { text: text.slice(0, 120), speaker: params.speaker },
    })

    const timeoutMs = resolveMediaInterfaceTimeoutMs(ctx.mediaDefaults, 120_000)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let buffer: Buffer
    try {
      const fetchImpl = ctx.fetch ?? fetch
      const res = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new MediaProviderError(
          'provider_http_error',
          `Volcengine speech ${res.status}: ${errText.slice(0, 800)}`,
        )
      }
      // HTTP Chunked 流式：arrayBuffer() 等待并拼接所有 chunk 为单一 Buffer。
      buffer = Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (controller.signal.aborted && isAbortError(err)) {
        throw new MediaProviderError(
          'provider_http_error',
          `Volcengine speech 流式请求超时 (${timeoutMs}ms)`,
        )
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
    if (buffer.length === 0) {
      throw new MediaProviderError('provider_http_error', 'Volcengine speech 返回空音频流')
    }
    const filename = filenameHelper(input, 'volcengine-speech', 0, 1)
    const asset = await this.artifact.writeBinaryAsset(
      'audio',
      buffer,
      input.outputDir,
      filename,
      mimeTypeFromSpeechFormat(params.format),
    )
    logMediaResult({ provider: this.id, capability, ok: true, assetCount: 1 })
    return {
      provider: this.id,
      model: SEED_TTS_RESOURCE_ID,
      mode: 'sync',
      assets: [asset],
      rawResponse: { bytes: buffer.length, format: params.format ?? 'mp3' },
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/** 火山豆包语音鉴权头（X-Api-Key，区别于方舟的 Bearer）。 */
function speechAuthHeaders(ctx: MediaProviderContext): Record<string, string> {
  return {
    'X-Api-Key': ctx.apiKey ?? '',
    'Content-Type': 'application/json',
  }
}

interface MusicParams {
  speaker: string | undefined
  format: string | undefined
  sample_rate: number | undefined
  speech_rate: number | undefined
  loudness_rate: number | undefined
  pitch_rate: number | undefined
  enable_subtitle: boolean | undefined
}

interface SpeechParams {
  speaker: string | undefined
  format: string | undefined
  sample_rate: number | undefined
  bit_rate: number | undefined
  speech_rate: number | undefined
  loudness_rate: number | undefined
}

function readMusicParams(input: MediaGenerateInput, ctx: MediaProviderContext): MusicParams {
  const m = (input.modelParams ?? {}) as Record<string, unknown>
  const audio = ((ctx.mediaDefaults?.audio as Record<string, unknown>) ?? {}) ?? {}
  return {
    speaker: readStr(m.speaker) ?? readStr(audio.voice),
    format: readStr(m.format) ?? readStr(audio.format) ?? 'wav',
    sample_rate: readNum(m.sample_rate),
    speech_rate: readNum(m.speech_rate),
    loudness_rate: readNum(m.loudness_rate),
    pitch_rate: readNum(m.pitch_rate),
    enable_subtitle: readBool(m.enable_subtitle),
  }
}

function readSpeechParams(input: MediaGenerateInput, ctx: MediaProviderContext): SpeechParams {
  const m = (input.modelParams ?? {}) as Record<string, unknown>
  const audio = ((ctx.mediaDefaults?.audio as Record<string, unknown>) ?? {}) ?? {}
  return {
    speaker: readStr(m.speaker) ?? readStr(audio.voice),
    format: readStr(m.format) ?? readStr(audio.format) ?? 'mp3',
    sample_rate: readNum(m.sample_rate),
    bit_rate: readNum(m.bit_rate),
    speech_rate: readNum(m.speech_rate),
    loudness_rate: readNum(m.loudness_rate),
  }
}

function readStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

function readNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function readBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
}

/** 音频格式 → MIME 映射（music 与 tts 共用，枚举见 music.md / tts.md）。 */
function mimeTypeFromSpeechFormat(format: string | undefined): string {
  switch (format) {
    case 'wav':
      return 'audio/wav'
    case 'pcm':
      return 'audio/pcm'
    case 'ogg_opus':
      return 'audio/ogg'
    case 'mp3':
    default:
      return 'audio/mpeg'
  }
}

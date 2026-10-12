/**
 * remoteVoiceTranscription —— 远程渠道入站语音转写编排（本地优先 + 云端兜底）。
 *
 * 链路：
 *   音频文件（OGG/MP3/M4A/WAV/WebM）
 *     → ffmpeg 解码为 16k mono PCM
 *     → 本地 SenseVoice 离线识别（复用语音助手语音包，免费、无网络依赖）
 *     → 未就绪/失败/空结果 → 云端 audio.transcription（多媒体渠道，Whisper 系）
 *     → 两路都不可用 → failed（携带原因与配置指引，回传远程端）
 *
 * 所有外部依赖（ffmpeg 解码、本地识别、云端路由）均以可注入函数形式提供，
 * 单元测试不依赖真实模型与网络。
 */

import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import type { MediaProviderProfile } from '@spark/agent-runtime'
import type { MediaRouterService } from '@spark/agent-runtime'
import { decodeAudioToPcm16kMono } from './FfmpegRunner.js'
import { resolveVoiceModelPaths, resolveVoiceRefinePaths } from './VoiceIntegrityService.js'
import { transcribePcm16k } from './VoiceRecognitionService.js'

const log = createLogger('remote-voice-transcription')

export type RemoteVoiceTranscriptionOutcome =
  | { kind: 'ok'; text: string; engine: 'local' | 'cloud' }
  | { kind: 'failed'; message: string }

export interface RemoteVoiceTranscriber {
  transcribe(input: { audioPath: string; mimeType?: string }): Promise<RemoteVoiceTranscriptionOutcome>
}

export interface RemoteVoiceTranscriptionDeps {
  resolveMediaProviders(): Promise<MediaProviderProfile[]>
  mediaRouter: Pick<MediaRouterService, 'invoke'>
  /** 转写临时产物（PCM/WAV）落盘目录 */
  workDir: string
  /** 音频 → 16k mono PCM 文件；默认走 FfmpegRunner */
  decodeAudioToPcm?: (input: string, outputPath: string) => Promise<void>
  /**
   * PCM16 → 本地识别文本；null = 本地识别不可用。
   * 默认实现包含语音包就绪检查（模型包 + 离线精修模型）与 SenseVoice 解码。
   */
  transcribePcm?: (samples: Int16Array) => Promise<string | null>
}

const LOCAL_SETUP_GUIDANCE =
  '在 SparkWork 桌面端打开「设置 → 语音助手」，点击安装/修复语音识别模型包（含离线识别模型），安装完成后重发语音即可本地转写'
const CLOUD_SETUP_GUIDANCE =
  '在 SparkWork 桌面端「设置 → 渠道」中新增支持「语音转写」能力的多媒体渠道（如 OpenAI 兼容 Whisper、APIMart、MiniMax、火山方舟等），配置后重发语音即可走云端转写'

/** 语音时长保护上限（秒）：超长语音拒绝转写，防止主进程长时间阻塞。 */
const MAX_VOICE_DURATION_SECONDS = 600

async function defaultDecodeAudioToPcm(input: string, outputPath: string): Promise<void> {
  await decodeAudioToPcm16kMono(input, outputPath)
}

/** 默认本地识别：先检查语音包就绪，再走 SenseVoice 离线转写。 */
async function defaultTranscribePcm(samples: Int16Array): Promise<string | null> {
  if (resolveVoiceModelPaths() == null) {
    throw new Error('语音识别模型包未安装（缺 native/流式模型，无法加载识别运行时）')
  }
  if (resolveVoiceRefinePaths() == null) {
    throw new Error('离线识别模型（SenseVoice）未安装')
  }
  return transcribePcm16k(samples)
}

/** Int16 PCM → WAV Buffer（44 字节 RIFF 头 + 数据），供云端转写渠道消费 */
function buildPcm16kWav(samples: Int16Array): Buffer {
  const dataBytes = samples.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  const body = Buffer.from(samples.buffer, samples.byteOffset, dataBytes)
  return Buffer.concat([header, body])
}

/** PCM 文件 → Int16Array（小端）。空文件返回 null。slice 出零偏移的新 ArrayBuffer，
 * 规避 Buffer 底层 byteOffset 不落 In16 对齐边界时 Int16Array 构造抛错。 */
async function readPcmFile(filePath: string): Promise<Int16Array | null> {
  const buffer = await fs.readFile(filePath)
  if (buffer.byteLength < 2) return null
  const sampleCount = Math.floor(buffer.byteLength / 2)
  const aligned = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + sampleCount * 2,
  ) as ArrayBuffer
  return new Int16Array(aligned)
}

export function createRemoteVoiceTranscriber(
  deps: RemoteVoiceTranscriptionDeps,
): RemoteVoiceTranscriber {
  const decodeAudioToPcm = deps.decodeAudioToPcm ?? defaultDecodeAudioToPcm
  const transcribePcm = deps.transcribePcm ?? defaultTranscribePcm

  async function transcribeViaCloud(
    audioPath: string,
    pcmSamples: Int16Array | null,
  ): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    let uploadPath = audioPath
    let tempWavPath: string | null = null
    try {
      // 有 PCM 时转成 WAV 上传（渠道兼容性最好）；没有则直接上传原容器
      if (pcmSamples != null && pcmSamples.length > 0) {
        await fs.mkdir(deps.workDir, { recursive: true })
        tempWavPath = path.join(deps.workDir, `${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
        await fs.writeFile(tempWavPath, buildPcm16kWav(pcmSamples))
        uploadPath = tempWavPath
      }
      const providers = await deps.resolveMediaProviders()
      if (providers.length === 0) {
        return { ok: false, reason: '未配置任何多媒体渠道' }
      }
      const { output } = await deps.mediaRouter.invoke(
        {
          operation: 'audio_transcribe',
          capability: 'audio.transcription',
          inputFiles: [{ type: 'audio', path: uploadPath, role: 'input' }],
          outputDir: deps.workDir,
        },
        { providers },
      )
      const text =
        output.assets.find((asset) => asset.contentText != null && asset.contentText.length > 0)
          ?.contentText ?? ''
      const cleaned = text.trim()
      if (cleaned.length === 0) {
        return { ok: false, reason: '云端转写返回空文本' }
      }
      return { ok: true, text: cleaned }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: detail }
    } finally {
      if (tempWavPath != null) {
        fs.unlink(tempWavPath).catch(() => undefined)
      }
    }
  }

  return {
    async transcribe(input) {
      const pcmPath = path.join(deps.workDir, `${Date.now()}-${randomUUID().slice(0, 8)}.pcm`)
      let pcmSamples: Int16Array | null = null
      // 本地转写不可用/失败原因：所有路径都会赋值，最终进入失败回执
      let localReason: string

      // ── 第一优先：ffmpeg 解码 + SenseVoice 本地识别 ──
      try {
        await fs.mkdir(deps.workDir, { recursive: true })
        await decodeAudioToPcm(input.audioPath, pcmPath)
        pcmSamples = await readPcmFile(pcmPath)
        if (pcmSamples == null || pcmSamples.length === 0) {
          localReason = '音频解码结果为空（可能不是有效语音）'
        } else if (pcmSamples.length > 16000 * MAX_VOICE_DURATION_SECONDS) {
          localReason = `语音超过 ${MAX_VOICE_DURATION_SECONDS / 60} 分钟，超出本地转写上限`
        } else {
          try {
            const text = await transcribePcm(pcmSamples)
            if (text != null && text.trim().length > 0) {
              log.info(
                `远程语音本地转写成功 (${(pcmSamples.length / 16000).toFixed(1)}s, ${text.trim().length} 字)`,
              )
              return { kind: 'ok', text: text.trim(), engine: 'local' }
            }
            localReason = text == null ? '本地识别模型未就绪' : '本地识别结果为空'
          } catch (error) {
            localReason = error instanceof Error ? error.message : String(error)
          }
        }
      } catch (error) {
        localReason = `音频解码失败：${error instanceof Error ? error.message : String(error)}`
      } finally {
        fs.unlink(pcmPath).catch(() => undefined)
      }

      log.warn(`远程语音本地转写不可用，转云端兜底：${localReason}`)

      // ── 兜底：云端 audio.transcription ──
      const cloud = await transcribeViaCloud(input.audioPath, pcmSamples)
      if (cloud.ok) {
        log.info(`远程语音云端转写成功 (${cloud.text.length} 字)`)
        return { kind: 'ok', text: cloud.text, engine: 'cloud' }
      }

      const message =
        `本地转写：${localReason}\n` +
        `云端转写：${cloud.reason}\n\n` +
        `配置指引：\n· 本地（推荐）：${LOCAL_SETUP_GUIDANCE}\n· 云端兜底：${CLOUD_SETUP_GUIDANCE}`
      log.warn(`远程语音转写两路均失败：local=${localReason} cloud=${cloud.reason}`)
      return { kind: 'failed', message }
    },
  }
}

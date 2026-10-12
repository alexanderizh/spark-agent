/**
 * qqVoiceMedia —— QQ 官方机器人的语音媒体链路。
 *
 * 入站：群/单聊事件 attachments 中的语音（SILK，.slk）→ 校验腾讯 CDN 域名 →
 *       下载 → silk-wasm 解码为 WAV（供转写链路的 ffmpeg/识别器消费）。
 * 出站：本地音频（MP3 等）→ ffmpeg 解码 24k 单声道 PCM → silk-wasm 编码 →
 *       富媒体接口（file_type=3）上传拿 file_info，由调用方以 msg_type=7 发送。
 *
 * QQ 频道场景无富媒体 file_info 通道，改用 multipart file_audio 直传 SILK。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@spark/shared'
import {
  decodeAudioToPcm16kMono,
} from './FfmpegRunner.js'
import {
  QQ_SILK_SAMPLE_RATE,
  decodeSilkToWav,
  encodePcm16ToSilk,
  isSilkData,
} from './silkCodec.js'

const log = createLogger('qq-voice-media')

export const QQ_INBOUND_VOICE_LIMIT_BYTES = 20 * 1024 * 1024

const QQ_VOICE_EXTENSION_REGEX = /\.(?:slk|silk|amr|mp3|wav|m4a|aac|ogg|opus)$/iu

export type QqInboundVoice = {
  url: string
  filename?: string
  contentType?: string
  size?: number
}

function isQqVoiceContentType(contentType: string | undefined, filename: string | undefined): boolean {
  if (contentType != null && (/^audio\//iu.test(contentType) || contentType.toLowerCase() === 'voice'))
    return true
  return filename != null && QQ_VOICE_EXTENSION_REGEX.test(filename)
}

/** 从 QQ 群/单聊事件中提取语音附件（图片附件由 extractQqInboundImages 单独处理）。 */
export function extractQqInboundVoices(message: Record<string, unknown>): QqInboundVoice[] {
  if (!Array.isArray(message.attachments)) return []
  return message.attachments.slice(0, 10).flatMap((raw): QqInboundVoice[] => {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const url = typeof item.url === 'string' ? item.url : ''
    const filename = typeof item.filename === 'string' ? item.filename : undefined
    const contentType = typeof item.content_type === 'string' ? item.content_type : undefined
    const size = typeof item.size === 'number' ? item.size : undefined
    if (!url || !isQqVoiceContentType(contentType, filename)) return []
    return [
      {
        url,
        ...(filename ? { filename } : {}),
        ...(contentType ? { contentType } : {}),
        ...(size != null ? { size } : {}),
      },
    ]
  })
}

export type QqInboundVoiceFile = {
  /** 落盘后的音频文件绝对路径（silk 已转为 WAV，其余保持原格式） */
  path: string
  mimeType: string
}

/**
 * 下载 QQ 入站语音：SILK 解码为 WAV；非 SILK（少见）按原扩展名落盘，
 * 交给转写链路的 ffmpeg 统一解码。
 */
export async function downloadQqVoice(
  input: { voice: QqInboundVoice; attachmentRoot: string },
  fetchImpl: typeof fetch = fetch,
): Promise<QqInboundVoiceFile> {
  const url = new URL(input.voice.url)
  // 与图片链路同源约束：QQ 事件中的附件 URL 属于外部输入，只接受腾讯 CDN。
  if (
    url.protocol !== 'https:' ||
    !/(?:^|\.)(?:qpic\.cn|qq\.com|qq\.com\.cn)$/iu.test(url.hostname)
  ) {
    throw new Error('QQ 语音地址不是可信的腾讯域名')
  }
  if (input.voice.size != null && input.voice.size > QQ_INBOUND_VOICE_LIMIT_BYTES) {
    throw new Error('语音超过 20 MB 限制')
  }
  const response = await fetchImpl(input.voice.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`下载 QQ 语音失败：HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > QQ_INBOUND_VOICE_LIMIT_BYTES) throw new Error('语音超过 20 MB 限制')

  await fs.mkdir(input.attachmentRoot, { recursive: true })
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

  if (isSilkData(bytes)) {
    const decoded = await decodeSilkToWav(bytes)
    const filePath = path.join(input.attachmentRoot, `qq-voice-${stamp}.wav`)
    await fs.writeFile(filePath, decoded.wav, { flag: 'wx' })
    return { path: filePath, mimeType: 'audio/wav' }
  }

  const extension = path.extname(input.voice.filename ?? '').toLowerCase()
  if (extension == null || !QQ_VOICE_EXTENSION_REGEX.test(extension)) {
    throw new Error('QQ 语音文件不是受支持的 SILK/音频格式')
  }
  const filePath = path.join(input.attachmentRoot, `qq-voice-${stamp}${extension}`)
  await fs.writeFile(filePath, bytes, { flag: 'wx' })
  return { path: filePath, mimeType: `audio/${extension.slice(1)}` }
}

export type QqOutboundSilk = {
  bytes: Buffer
  fileName: string
}

/**
 * 把出站音频（本地路径 / file:// URL）准备成 QQ 可接受的 SILK：
 * 已是 SILK 直接透传；其余格式经 ffmpeg 解码为 24k 单声道 PCM 后编码。
 */
export async function prepareQqOutboundSilk(source: string): Promise<QqOutboundSilk> {
  const localPath = source.startsWith('file://') ? fileURLToPath(source) : source
  if (!path.isAbsolute(localPath)) {
    throw new Error(`QQ 语音发送只支持本地文件：${source.slice(0, 120)}`)
  }
  const realPath = await fs.realpath(localPath)
  const stat = await fs.stat(realPath)
  if (!stat.isFile()) throw new Error('语音文件路径不是文件')
  if (stat.size > QQ_INBOUND_VOICE_LIMIT_BYTES) throw new Error('语音文件超过 20 MB 限制')

  const bytes = await fs.readFile(realPath)
  const fileName = path.basename(realPath)
  if (isSilkData(bytes)) return { bytes, fileName }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-voice-'))
  const pcmPath = path.join(tempDir, 'voice.pcm')
  try {
    await decodeAudioToPcm16kMono(realPath, pcmPath, { sampleRate: QQ_SILK_SAMPLE_RATE })
    const pcm = await fs.readFile(pcmPath)
    if (pcm.byteLength < 2) throw new Error('音频解码结果为空（可能不是有效语音）')
    const sampleCount = Math.floor(pcm.byteLength / 2)
    const samples = new Int16Array(
      pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + sampleCount * 2) as ArrayBuffer,
    )
    const silk = await encodePcm16ToSilk(samples, QQ_SILK_SAMPLE_RATE)
    log.info(
      `QQ 出站语音 SILK 编码完成: ${(samples.length / QQ_SILK_SAMPLE_RATE).toFixed(1)}s, silk ${silk.byteLength} 字节`,
    )
    return { bytes: silk, fileName: `${path.parse(fileName).name || 'voice'}.slk` }
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * 上传 QQ 群/单聊富媒体（file_type=3 语音）并返回 file_info。
 * 与 uploadQqImage 同一接口，仅 file_type 不同。
 */
export async function uploadQqVoice(
  input: {
    token: string
    endpointBase: string
    source: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { bytes } = await prepareQqOutboundSilk(input.source)
  const response = await fetchImpl(`${input.endpointBase}/files`, {
    method: 'POST',
    headers: { Authorization: `QQBot ${input.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_type: 3,
      file_data: bytes.toString('base64'),
      srv_send_msg: false,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const payload = (await response.json()) as { file_info?: string; message?: string }
  if (!response.ok || !payload.file_info) {
    throw new Error(`QQ 语音上传失败：${payload.message ?? response.status}`)
  }
  return payload.file_info
}

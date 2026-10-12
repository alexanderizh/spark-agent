/**
 * feishuVoiceMedia —— 飞书语音媒体链路。
 *
 * 入站：语音消息（msg_type=audio，OGG/Opus）或音频文件消息 →
 *       resources 接口下载 → 落盘 .ogg → 转写链路消费。
 * 出站：本地音频（MP3 等）→ ffmpeg 转码 OGG/Opus → /im/v1/files 上传
 *       （file_type=opus，飞书音频消息唯一接受的类型）→ 返回 file_key，
 *       由调用方以 msg_type=audio 发送。
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from '@spark/shared'
import { encodeAudioToOggOpus, probeVideo } from './FfmpegRunner.js'

const log = createLogger('feishu-voice-media')

const FEISHU_VOICE_LIMIT_BYTES = 30 * 1024 * 1024
const FEISHU_AUDIO_FILE_EXTENSION_REGEX = /\.(?:ogg|oga|opus|mp3|wav|m4a|aac|flac|amr)$/iu

export type FeishuInboundVoice = {
  messageId: string
  fileKey: string
  fileName?: string
}

/**
 * 提取飞书入站语音：优先语音消息（msg_type=audio），
 * 其次是文件名带音频扩展名的文件消息（msg_type=file）。
 */
export function extractFeishuInboundVoice(message: {
  message_id?: string | undefined
  message_type?: string | undefined
  content?: string | undefined
}): FeishuInboundVoice | null {
  if (message.message_type !== 'audio' && message.message_type !== 'file') return null
  if (!message.message_id || !message.content) return null
  try {
    const content = JSON.parse(message.content) as Record<string, unknown>
    const fileKey = typeof content.file_key === 'string' ? content.file_key : ''
    if (fileKey.length === 0) return null
    if (message.message_type === 'file') {
      const fileName = typeof content.file_name === 'string' ? content.file_name : ''
      if (!FEISHU_AUDIO_FILE_EXTENSION_REGEX.test(fileName)) return null
      return { messageId: message.message_id, fileKey, fileName }
    }
    return { messageId: message.message_id, fileKey }
  } catch {
    return null
  }
}

export type FeishuInboundVoiceFile = {
  path: string
  mimeType: string
}

/** 下载飞书入站语音（audio/file 消息统一走 resources 接口 type=file）。 */
export async function downloadFeishuVoice(
  input: { token: string; voice: FeishuInboundVoice; attachmentRoot: string },
  fetchImpl: typeof fetch = fetch,
): Promise<FeishuInboundVoiceFile> {
  const { messageId, fileKey } = input.voice
  const response = await fetchImpl(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=file`,
    { headers: { Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(30_000) },
  )
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200)
    throw new Error(`下载飞书语音失败：HTTP ${response.status} ${detail}`.trim())
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > FEISHU_VOICE_LIMIT_BYTES) throw new Error('语音超过 30 MB 限制')

  // 飞书语音固定 OGG/Opus；文件消息按原始扩展名落盘
  const isOgg = bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS'
  const extension = isOgg
    ? '.ogg'
    : (path.extname(input.voice.fileName ?? '').match(FEISHU_AUDIO_FILE_EXTENSION_REGEX)?.[0] ??
      '')
  if (extension === '') throw new Error('飞书语音文件不是受支持的音频格式')

  await fs.mkdir(input.attachmentRoot, { recursive: true })
  const filePath = path.join(
    input.attachmentRoot,
    `feishu-voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${extension}`,
  )
  await fs.writeFile(filePath, bytes, { flag: 'wx' })
  return {
    path: filePath,
    mimeType: extension === '.ogg' ? 'audio/ogg' : `audio/${extension.slice(1)}`,
  }
}

/**
 * 出站语音 → 飞书音频消息素材：转码为 OGG/Opus 并上传（file_type=opus），
 * 返回 audio 消息所需的 file_key。
 */
export async function uploadFeishuAudio(
  input: { token: string; source: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const localPath = input.source.startsWith('file://') ? fileURLToPath(input.source) : input.source
  if (!path.isAbsolute(localPath)) {
    throw new Error(`飞书语音发送只支持本地文件：${input.source.slice(0, 120)}`)
  }
  const realPath = await fs.realpath(localPath)
  const stat = await fs.stat(realPath)
  if (!stat.isFile()) throw new Error('语音文件路径不是文件')
  if (stat.size > FEISHU_VOICE_LIMIT_BYTES) throw new Error('语音文件超过 30 MB 限制')

  // 飞书 audio 消息只接受 opus 素材；统一重编码，避免源容器不合规
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-voice-'))
  let opusPath: string
  let durationMs: number
  try {
    durationMs = Math.round((await probeVideo(realPath)).durationSec * 1000)
    opusPath = path.join(tempDir, 'voice.ogg')
    await encodeAudioToOggOpus(realPath, opusPath)
    const form = new FormData()
    form.append('file_type', 'opus')
    if (Number.isFinite(durationMs) && durationMs > 0) {
      form.append('duration', String(durationMs))
    }
    form.append(
      'file',
      new Blob([await fs.readFile(opusPath)], { type: 'audio/ogg' }),
      `${path.parse(path.basename(realPath)).name || 'voice'}.ogg`,
    )
    const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
    const payload = (await response.json()) as {
      code?: number
      msg?: string
      data?: { file_key?: string }
    }
    if (!response.ok || payload.code !== 0 || !payload.data?.file_key) {
      throw new Error(`飞书语音上传失败：${payload.msg ?? response.status}`)
    }
    log.info(
      `飞书出站语音上传成功: ${durationMs}ms, file_key=${payload.data.file_key.slice(0, 16)}…`,
    )
    return payload.data.file_key
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

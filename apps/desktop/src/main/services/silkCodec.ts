/**
 * silkCodec —— QQ 语音（SILK 格式）编解码封装。
 *
 * QQ 官方机器人的语音富媒体只接受 SILK 格式，ffmpeg 不支持 SILK 编解码，
 * 这里通过 silk-wasm（纯 wasm、无 native 依赖）完成：
 *   - 解码：入站 QQ 语音（.slk，可能带 0x02 变体前缀）→ WAV（供 ffmpeg/转写链路消费）
 *   - 编码：PCM s16le → SILK（出站 QQ 语音）
 *
 * silk-wasm 以动态 import 惰性加载：包缺失或加载失败时抛出带配置指引的错误，
 * 不在模块加载期炸掉主进程。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('silk-codec')

/** QQ 语音常用的 SILK 采样率（Hz）。 */
export const QQ_SILK_SAMPLE_RATE = 24_000

const SILK_SETUP_GUIDANCE =
  'QQ 语音组件（silk-wasm）未安装或加载失败，请更新/重装应用后重试；若持续失败请在桌面端查看日志'

/** QQ 手动端语音常在 #!SILK 魔数前多一个 0x02 字节（QQ 变体）。 */
export function isSilkData(bytes: Buffer): boolean {
  if (bytes.length >= 10 && bytes[0] === 0x02 && bytes.subarray(1, 10).toString('ascii') === '#!SILK_V3') {
    return true
  }
  return bytes.length >= 9 && bytes.subarray(0, 9).toString('ascii') === '#!SILK_V3'
}

/**
 * silk-wasm 的解码面向 QQ 变体：输入需带 0x02 前缀，标准 #!SILK_V3 头需补上。
 */
function ensureQqVariantPrefix(bytes: Buffer): Buffer {
  return bytes[0] === 0x02 ? bytes : Buffer.concat([Buffer.from([0x02]), bytes])
}

async function loadSilkWasm(): Promise<typeof import('silk-wasm')> {
  try {
    return await import('silk-wasm')
  } catch (error) {
    log.error(`silk-wasm 加载失败: ${error instanceof Error ? error.message : String(error)}`)
    throw new Error(SILK_SETUP_GUIDANCE, { cause: error })
  }
}

/** PCM s16le → WAV Buffer（44 字节 RIFF 头 + 数据）。 */
export function buildWavFromPcm16(samples: Int16Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  const body = Buffer.from(samples.buffer, samples.byteOffset, dataBytes)
  return Buffer.concat([header, body])
}

export type SilkDecodeResult = {
  /** 解码后的 WAV 文件内容（单声道 s16le） */
  wav: Buffer
  /** 音频时长（毫秒） */
  durationMs: number
}

/** 解码 QQ 入站 SILK 语音 → WAV。 */
export async function decodeSilkToWav(bytes: Buffer): Promise<SilkDecodeResult> {
  if (!isSilkData(bytes)) throw new Error('不是有效的 QQ 语音（SILK）数据')
  const { decode } = await loadSilkWasm()
  const result = await decode(ensureQqVariantPrefix(bytes), QQ_SILK_SAMPLE_RATE)
  const pcm = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  const sampleCount = Math.floor(pcm.byteLength / 2)
  const samples = new Int16Array(
    pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + sampleCount * 2) as ArrayBuffer,
  )
  return {
    wav: buildWavFromPcm16(samples, QQ_SILK_SAMPLE_RATE),
    durationMs: result.duration,
  }
}

/** PCM s16le（单声道）→ SILK Buffer，用于出站 QQ 语音。 */
export async function encodePcm16ToSilk(samples: Int16Array, sampleRate: number): Promise<Buffer> {
  const { encode } = await loadSilkWasm()
  const result = await encode(samples, sampleRate)
  return Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength)
}

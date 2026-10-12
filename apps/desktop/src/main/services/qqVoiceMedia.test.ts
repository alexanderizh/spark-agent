import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encode } from 'silk-wasm'

import {
  downloadQqVoice,
  extractQqInboundVoices,
  prepareQqOutboundSilk,
} from './qqVoiceMedia.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

async function makeSilkBytes(): Promise<Buffer> {
  // 20ms 静音 PCM @24k → SILK（真实 wasm 编码，产物自带 0x02 + #!SILK_V3 头）
  const samples = new Int16Array(480)
  const result = await encode(samples, 24_000)
  return Buffer.from(result.data)
}

async function makeAttachmentRoot(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-voice-test-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'voice')
}

describe('extractQqInboundVoices', () => {
  it('提取 content_type 为 audio/voice 或音频扩展名的附件', () => {
    const voices = extractQqInboundVoices({
      attachments: [
        { url: 'https://groupteam.cdn.qq.com/a.slk', content_type: 'audio', filename: 'a.slk', size: 100 },
        { url: 'https://groupteam.cdn.qq.com/b.slk', filename: 'b.slk' },
        { url: 'https://groupteam.cdn.qq.com/c.png', content_type: 'image/png' },
        { url: '', content_type: 'audio' },
      ],
    })
    expect(voices).toHaveLength(2)
    expect(voices[0]).toMatchObject({ url: 'https://groupteam.cdn.qq.com/a.slk' })
    expect(voices[1]).toMatchObject({ filename: 'b.slk' })
  })

  it('无 attachments 或非对象数组时返回空', () => {
    expect(extractQqInboundVoices({})).toEqual([])
    expect(extractQqInboundVoices({ attachments: 'x' })).toEqual([])
    expect(extractQqInboundVoices({ attachments: [null, 42] })).toEqual([])
  })
})

describe('downloadQqVoice', () => {
  it('SILK 语音解码为 WAV 落盘', async () => {
    const silk = await makeSilkBytes()
    const attachmentRoot = await makeAttachmentRoot()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(silk))
    const file = await downloadQqVoice(
      {
        voice: { url: 'https://groupteam.cdn.qq.com/voice.slk', filename: 'voice.slk' },
        attachmentRoot,
      },
      fetchMock,
    )
    expect(file.mimeType).toBe('audio/wav')
    const bytes = await fs.readFile(file.path)
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(bytes.toString('ascii', 8, 12)).toBe('WAVE')
    expect(bytes.readUInt32LE(24)).toBe(24_000)
  })

  it('非腾讯域名的语音地址被拒绝', async () => {
    const attachmentRoot = await makeAttachmentRoot()
    await expect(
      downloadQqVoice(
        {
          voice: { url: 'https://evil.example/voice.slk', filename: 'voice.slk' },
          attachmentRoot,
        },
        vi.fn<typeof fetch>(),
      ),
    ).rejects.toThrow('不是可信的腾讯域名')
  })

  it('非 SILK 音频按原扩展名落盘', async () => {
    const attachmentRoot = await makeAttachmentRoot()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(Buffer.from('mp3-bytes')))
    const file = await downloadQqVoice(
      {
        voice: {
          url: 'https://groupteam.cdn.qq.com/voice.mp3',
          filename: 'voice.mp3',
          contentType: 'audio/mpeg',
        },
        attachmentRoot,
      },
      fetchMock,
    )
    expect(file.path.endsWith('.mp3')).toBe(true)
    expect(await fs.readFile(file.path)).toEqual(Buffer.from('mp3-bytes'))
  })

  it('未知格式抛出明确错误', async () => {
    const attachmentRoot = await makeAttachmentRoot()
    await expect(
      downloadQqVoice(
        {
          voice: { url: 'https://groupteam.cdn.qq.com/file.bin', filename: 'file.bin' },
          attachmentRoot,
        },
        vi.fn<typeof fetch>(async () => new Response(Buffer.from('x'))),
      ),
    ).rejects.toThrow('SILK')
  })
})

describe('prepareQqOutboundSilk', () => {
  it('已是 SILK 的文件直接透传', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-qq-out-voice-'))
    temporaryDirectories.push(directory)
    const silk = await makeSilkBytes()
    const filePath = path.join(directory, 'voice.slk')
    await fs.writeFile(filePath, silk)

    const result = await prepareQqOutboundSilk(filePath)
    expect(result.bytes.equals(silk)).toBe(true)
    expect(result.fileName).toBe('voice.slk')
  })

  it('非本地路径拒绝（QQ 语音不支持远端 URL 直发）', async () => {
    await expect(prepareQqOutboundSilk('https://cdn.example/voice.mp3')).rejects.toThrow(
      '只支持本地文件',
    )
  })
})

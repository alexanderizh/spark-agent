import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  extractTelegramOutboundMedia,
  mergeTelegramOutboundImages,
  sendTelegramOutboundImage,
  sendTelegramOutboundVoice,
} from './telegramOutboundMedia.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('extractTelegramOutboundMedia', () => {
  it('extracts public and local Markdown images while preserving surrounding text', () => {
    const result = extractTelegramOutboundMedia(
      '完成\n\n![远程图](https://cdn.example/result.png)\n![本地图](</tmp/result image.png>)',
    )

    expect(result.text).toBe('完成')
    expect(result.images).toEqual([
      { source: 'https://cdn.example/result.png', alt: '远程图' },
      { source: '/tmp/result image.png', alt: '本地图' },
    ])
  })

  it('deduplicates the same presented file and Markdown image', () => {
    expect(
      mergeTelegramOutboundImages(
        [{ source: 'file:///tmp/result.png', alt: 'Markdown 图片' }],
        [{ source: '/tmp/result.png', alt: '' }],
      ),
    ).toEqual([{ source: 'file:///tmp/result.png', alt: 'Markdown 图片' }])
  })
})

describe('sendTelegramOutboundImage', () => {
  it('uploads a local image directly to Telegram', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-image-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'result.png')
    await fs.writeFile(filePath, Buffer.from('png'))
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))
    const uploadTemporaryFile = vi.fn(async () => 'https://spark.example/fallback.png')

    await expect(
      sendTelegramOutboundImage(
        { token: '1:token', chatId: 'chat-1', image: { source: filePath, alt: '结果' } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-upload')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData)
    expect(uploadTemporaryFile).not.toHaveBeenCalled()
  })

  it('falls back to the Spark temporary upload URL when Telegram direct upload fails', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-image-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'result.png')
    await fs.writeFile(filePath, Buffer.from('png'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":false,"description":"upload failed"}', { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response('{"ok":false,"description":"document upload failed"}', { status: 400 }),
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    const uploadTemporaryFile = vi.fn(async () => 'https://spark.example/fallback.png')

    await expect(
      sendTelegramOutboundImage(
        { token: '1:token', chatId: 'chat-1', image: { source: filePath, alt: '结果' } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('spark-transfer')
    const realPath = await fs.realpath(filePath)
    expect(uploadTemporaryFile).toHaveBeenCalledWith({
      filePath: realPath,
      fileName: 'result.png',
      mimeType: 'image/png',
    })
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      chat_id: 'chat-1',
      photo: 'https://spark.example/fallback.png',
    })
  })

  it('sends an image as a Telegram document when photo upload is rejected', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-image-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'result.png')
    await fs.writeFile(filePath, Buffer.from('png'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"ok":false}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
    const uploadTemporaryFile = vi.fn(async () => 'https://spark.example/fallback.png')

    await expect(
      sendTelegramOutboundImage(
        { token: '1:token', chatId: 'chat-1', image: { source: filePath, alt: '结果' } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-document-upload')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/sendDocument')
    expect(uploadTemporaryFile).not.toHaveBeenCalled()
  })
})

describe('sendTelegramOutboundVoice', () => {
  const uploadTemporaryFile = vi.fn(async () => 'https://spark.example/fallback.mp3')

  it('sends a local MP3 via sendAudio (audio card)', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, '静夜思-朗诵.mp3')
    await fs.writeFile(filePath, Buffer.from('mp3'))
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))

    await expect(
      sendTelegramOutboundVoice(
        { token: '1:token', chatId: 'chat-1', voice: { source: filePath } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-audio')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendAudio')
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData)
    expect(uploadTemporaryFile).not.toHaveBeenCalled()
  })

  it('sends a local OGG/Opus via sendVoice (voice bubble)', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'voice.ogg')
    await fs.writeFile(filePath, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]))
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))

    await expect(
      sendTelegramOutboundVoice(
        { token: '1:token', chatId: 'chat-1', voice: { source: filePath } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-voice')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sendVoice')
  })

  it('falls back to sendDocument when sendAudio rejects the file', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'voice.mp3')
    await fs.writeFile(filePath, Buffer.from('mp3'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"ok":false,"description":"audio rejected"}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))

    await expect(
      sendTelegramOutboundVoice(
        { token: '1:token', chatId: 'chat-1', voice: { source: filePath } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-document')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/sendDocument')
  })

  it('sends a remote audio URL via sendAudio without downloading', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{"ok":true}', { status: 200 }))

    await expect(
      sendTelegramOutboundVoice(
        {
          token: '1:token',
          chatId: 'chat-1',
          voice: { source: 'https://cdn.example/voice.mp3', name: '朗读' },
        },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).resolves.toBe('telegram-audio-url')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain('/sendAudio')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      chat_id: 'chat-1',
      audio: 'https://cdn.example/voice.mp3',
    })
  })

  it('rejects voice files above the 50 MB Telegram document limit', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(directory)
    const filePath = path.join(directory, 'voice.mp3')
    const big = Buffer.alloc(51 * 1024 * 1024)
    await fs.writeFile(filePath, big)
    const fetchMock = vi.fn<typeof fetch>()

    await expect(
      sendTelegramOutboundVoice(
        { token: '1:token', chatId: 'chat-1', voice: { source: filePath } },
        { fetch: fetchMock, uploadTemporaryFile },
      ),
    ).rejects.toThrow('50 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

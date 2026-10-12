import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  downloadTelegramInboundImage,
  downloadTelegramInboundVoice,
  extractTelegramInboundImages,
  extractTelegramInboundVoice,
  TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES,
  TELEGRAM_INBOUND_VOICE_LIMIT_BYTES,
} from './telegramInboundMedia.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

describe('extractTelegramInboundImages', () => {
  it('selects the largest Telegram photo variant', () => {
    expect(
      extractTelegramInboundImages({
        photo: [
          { file_id: 'small', file_unique_id: 'same', width: 90, height: 90, file_size: 100 },
          { file_id: 'large', file_unique_id: 'same', width: 1280, height: 720, file_size: 900 },
        ],
      }),
    ).toEqual([
      {
        fileId: 'large',
        fileUniqueId: 'same',
        fileName: 'telegram-photo.jpg',
        fileSize: 900,
        mimeType: 'image/jpeg',
      },
    ])
  })

  it('accepts an image sent as a Telegram document', () => {
    expect(
      extractTelegramInboundImages({
        document: {
          file_id: 'document',
          file_unique_id: 'unique',
          file_name: 'original.png',
          mime_type: 'image/png',
          file_size: 1024,
        },
      }),
    ).toEqual([
      {
        fileId: 'document',
        fileUniqueId: 'unique',
        fileName: 'original.png',
        mimeType: 'image/png',
        fileSize: 1024,
      },
    ])
  })
})

describe('downloadTelegramInboundImage', () => {
  it('downloads, verifies, and persists a Telegram image attachment', async () => {
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-inbound-'))
    temporaryDirectories.push(attachmentRoot)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":true,"result":{"file_path":"photos/file.png"}}', { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(png, { status: 200 }))

    const attachment = await downloadTelegramInboundImage(
      {
        token: '1:token',
        attachmentRoot,
        descriptor: { fileId: 'file', fileUniqueId: 'unique', fileName: 'photo.png' },
      },
      fetchMock,
    )

    expect(attachment.type).toBe('image')
    expect(path.extname(attachment.path)).toBe('.png')
    await expect(fs.readFile(attachment.path)).resolves.toEqual(png)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects files above the inbound size limit before downloading', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(
      downloadTelegramInboundImage(
        {
          token: '1:token',
          attachmentRoot: '/tmp/unused',
          descriptor: { fileId: 'large', fileSize: TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES + 1 },
        },
        fetchMock,
      ),
    ).rejects.toThrow('20 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('extractTelegramInboundVoice', () => {
  it('extracts a voice note with default ogg metadata', () => {
    expect(
      extractTelegramInboundVoice({
        voice: { file_id: 'v1', file_unique_id: 'vu1', duration: 12, file_size: 2048 },
      }),
    ).toEqual({
      fileId: 'v1',
      fileUniqueId: 'vu1',
      fileSize: 2048,
      mimeType: 'audio/ogg',
      fileName: 'telegram-voice.ogg',
      durationSec: 12,
    })
  })

  it('extracts a voice note preserving the declared audio mime type', () => {
    expect(
      extractTelegramInboundVoice({
        voice: { file_id: 'v2', mime_type: 'audio/ogg' },
      }),
    ).toEqual({
      fileId: 'v2',
      mimeType: 'audio/ogg',
    })
  })

  it('extracts an audio file by mime type', () => {
    expect(
      extractTelegramInboundVoice({
        audio: {
          file_id: 'a1',
          file_unique_id: 'au1',
          file_name: 'song.mp3',
          mime_type: 'audio/mpeg',
          duration: 90,
        },
      }),
    ).toEqual({
      fileId: 'a1',
      fileUniqueId: 'au1',
      fileName: 'song.mp3',
      mimeType: 'audio/mpeg',
      durationSec: 90,
    })
  })

  it('extracts an audio document by file extension', () => {
    expect(
      extractTelegramInboundVoice({
        document: { file_id: 'd1', file_name: 'memo.m4a', mime_type: 'application/octet-stream' },
      }),
    ).toEqual({
      fileId: 'd1',
      fileName: 'memo.m4a',
      mimeType: 'application/octet-stream',
    })
  })

  it('returns null for non-audio documents and plain text messages', () => {
    expect(
      extractTelegramInboundVoice({
        document: { file_id: 'd2', file_name: 'report.pdf', mime_type: 'application/pdf' },
      }),
    ).toBeNull()
    expect(extractTelegramInboundVoice({ text: 'hello' })).toBeNull()
    expect(extractTelegramInboundVoice({ photo: [] })).toBeNull()
  })
})

describe('downloadTelegramInboundVoice', () => {
  it('downloads, verifies, and persists an OGG voice note', async () => {
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(attachmentRoot)
    const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)])
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":true,"result":{"file_path":"voice/file_0.oga"}}', { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(ogg, { status: 200 }))

    const voice = await downloadTelegramInboundVoice(
      {
        token: '1:token',
        attachmentRoot,
        descriptor: { fileId: 'file', fileUniqueId: 'unique', durationSec: 5 },
      },
      fetchMock,
    )

    expect(voice.mimeType).toBe('audio/ogg')
    expect(path.extname(voice.path)).toBe('.ogg')
    await expect(fs.readFile(voice.path)).resolves.toEqual(ogg)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects a payload that is not a supported audio container', async () => {
    const attachmentRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-voice-'))
    temporaryDirectories.push(attachmentRoot)
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"ok":true,"result":{"file_path":"voice/file_0.bin"}}', { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(Buffer.from('not audio at all'), { status: 200 }))

    await expect(
      downloadTelegramInboundVoice(
        { token: '1:token', attachmentRoot, descriptor: { fileId: 'file' } },
        fetchMock,
      ),
    ).rejects.toThrow('不是受支持')
  })

  it('rejects voice files above the inbound size limit before downloading', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(
      downloadTelegramInboundVoice(
        {
          token: '1:token',
          attachmentRoot: '/tmp/unused',
          descriptor: { fileId: 'big', fileSize: TELEGRAM_INBOUND_VOICE_LIMIT_BYTES + 1 },
        },
        fetchMock,
      ),
    ).rejects.toThrow('20 MB')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

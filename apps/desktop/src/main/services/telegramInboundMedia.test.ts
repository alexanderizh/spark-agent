import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  downloadTelegramInboundImage,
  extractTelegramInboundImages,
  TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES,
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

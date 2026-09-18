import { describe, expect, it, vi } from 'vitest'

import {
  IMAGE_LIMITS,
  detectImageMediaType,
  formatImageBytes,
  formatImageLabel,
  imagePlaceholderText,
  readImageDimensions,
  validateImageAttachments,
  type TurnImageAttachment,
} from '../../src/images/attachments.js'
import {
  loadImageFiles,
  normalizePastedPath,
  readImageFile,
  resolveImageFilePath,
} from '../../src/images/files.js'
import { pngBytes, jpegBytes, gifBytes, webpBytes } from '../fixtures/image-bytes.js'

describe('image attachment vocabulary', () => {
  it('sniffs the container from magic bytes instead of the extension', () => {
    expect(detectImageMediaType(pngBytes(640, 360))).toBe('image/png')
    expect(detectImageMediaType(jpegBytes())).toBe('image/jpeg')
    expect(detectImageMediaType(gifBytes(12, 7))).toBe('image/gif')
    expect(detectImageMediaType(webpBytes(320, 200))).toBe('image/webp')
    expect(detectImageMediaType(Buffer.from('not an image at all'))).toBeUndefined()
  })

  it('reads pixel dimensions per container', () => {
    expect(readImageDimensions(pngBytes(1920, 1080), 'image/png')).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(readImageDimensions(gifBytes(12, 7), 'image/gif')).toEqual({ width: 12, height: 7 })
    expect(readImageDimensions(jpegBytes(), 'image/jpeg')).toEqual({ width: 800, height: 600 })
    expect(readImageDimensions(webpBytes(320, 200), 'image/webp')).toEqual({
      width: 320,
      height: 200,
    })
    // Truncated payloads degrade to "unknown" instead of throwing.
    expect(readImageDimensions(pngBytes(1920, 1080).subarray(0, 12), 'image/png')).toBeUndefined()
  })

  it('enforces count, per-image, and total-size limits', () => {
    const small = attachment(1_024)
    expect(validateImageAttachments([small])).toEqual({ ok: true })
    expect(validateImageAttachments(Array.from({ length: 21 }, () => small))).toMatchObject({
      ok: false,
    })
    expect(
      validateImageAttachments([attachment(IMAGE_LIMITS.maxBytesPerImage + 1)]),
    ).toMatchObject({ ok: false })
    expect(
      validateImageAttachments(
        Array.from({ length: 3 }, () => attachment(IMAGE_LIMITS.maxBytesPerImage)),
      ),
    ).toMatchObject({ ok: false })
    expect(validateImageAttachments([attachment(0)])).toMatchObject({ ok: false })
  })

  it('formats placeholders and block labels for the draft and the editor hint', () => {
    expect(imagePlaceholderText(3)).toBe('[Image #3]')
    expect(formatImageBytes(512)).toBe('512B')
    expect(formatImageBytes(2_048)).toBe('2KB')
    expect(formatImageBytes(1_572_864)).toBe('1.5MB')
    expect(formatImageLabel(attachment(245_760, 1920, 1080), 2)).toBe(
      '[Image #2 · 1920×1080 · 240KB]',
    )
    expect(formatImageLabel(attachment(245_760), 1)).toBe('[Image #1 · 240KB]')
  })
})

describe('image files', () => {
  it('reads a file, sniffing its real container and name', async () => {
    const result = await readImageFile('/tmp/shot.png', {
      readBytes: async () => pngBytes(800, 600),
    })
    expect(result).toEqual({
      ok: true,
      image: {
        bytes: pngBytes(800, 600),
        mediaType: 'image/png',
        name: 'shot.png',
        width: 800,
        height: 600,
      },
    })
  })

  it('classifies missing, empty, oversized, and unsupported files', async () => {
    const enoent = Object.assign(new Error('missing'), { code: 'ENOENT' })
    await expect(
      readImageFile('/tmp/none.png', {
        readBytes: async () => {
          throw enoent
        },
      }),
    ).resolves.toMatchObject({ ok: false, code: 'not-found' })
    await expect(
      readImageFile('/tmp/empty.png', { readBytes: async () => new Uint8Array() }),
    ).resolves.toMatchObject({ ok: false, code: 'unreadable' })
    await expect(
      readImageFile('/tmp/big.png', {
        readBytes: async () => new Uint8Array(IMAGE_LIMITS.maxBytesPerImage + 1),
      }),
    ).resolves.toMatchObject({ ok: false, code: 'too-large' })
    await expect(
      readImageFile('/tmp/doc.png', { readBytes: async () => Buffer.from('plain text') }),
    ).resolves.toMatchObject({ ok: false, code: 'decode-failed' })
  })

  it('loads a batch and rejects it atomically on the first failure', async () => {
    const readBytes = async (path: string): Promise<Uint8Array> => {
      if (path.endsWith('missing.png')) throw Object.assign(new Error('x'), { code: 'ENOENT' })
      return pngBytes(10, 10)
    }
    await expect(
      loadImageFiles(['/tmp/a.png', '/tmp/b.png'], { readBytes }),
    ).resolves.toMatchObject({ ok: true })
    await expect(loadImageFiles(['/tmp/a.png', '/tmp/missing.png'], { readBytes })).resolves.toEqual({
      ok: false,
      message: expect.stringContaining('找不到图片文件'),
    })
  })

  it('only treats a single existing image path as an attachment', async () => {
    const fileExists = vi.fn(async (path: string) => path === '/tmp/shot.png')
    await expect(
      resolveImageFilePath('/tmp/shot.png', { fileExists }),
    ).resolves.toBe('/tmp/shot.png')
    await expect(
      resolveImageFilePath('"file:///tmp/shot.png"', { fileExists }),
    ).resolves.toBe('/tmp/shot.png')
    await expect(resolveImageFilePath('/tmp/other.png', { fileExists })).resolves.toBeUndefined()
    await expect(resolveImageFilePath('/tmp/notes.md', { fileExists })).resolves.toBeUndefined()
    await expect(resolveImageFilePath('line1\n/tmp/shot.png', { fileExists })).resolves.toBeUndefined()
    await expect(
      resolveImageFilePath('https://example.com/shot.png', { fileExists }),
    ).resolves.toBeUndefined()
  })

  it('normalizes terminal drag & drop escaping without rewriting other text', () => {
    expect(normalizePastedPath('/tmp/a\\ b.png')).toBe('/tmp/a b.png')
    expect(normalizePastedPath('  /tmp/a.png  ')).toBe('/tmp/a.png')
    expect(normalizePastedPath('file:///tmp/a%20b.png')).toBe('/tmp/a b.png')
    expect(normalizePastedPath('explain this code')).toBeDefined()
    expect(normalizePastedPath('')).toBeUndefined()
  })
})

function attachment(bytes: number, width?: number, height?: number): TurnImageAttachment {
  return {
    bytes: new Uint8Array(bytes),
    mediaType: 'image/png',
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  }
}

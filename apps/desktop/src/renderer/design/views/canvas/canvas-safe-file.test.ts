// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  dataUrlToBlob,
  dataUrlToFile,
  decodeCanvasSafeFileUrl,
  encodeToSafeFileUrl,
} from './canvas-safe-file'

// 1x1 透明 PNG
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('dataUrlToBlob / dataUrlToFile（不走 fetch，规避 CSP connect-src 不含 data:）', () => {
  it('base64 dataURL → Blob：保留 mime 且字节数正确', async () => {
    const blob = dataUrlToBlob(PNG_DATA_URL)
    expect(blob.type).toBe('image/png')
    const expectedBytes = atob(PNG_DATA_URL.split(',')[1]!).length
    expect(blob.size).toBe(expectedBytes)
    // PNG magic number
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('非 base64（纯文本）dataURL 也能解析', () => {
    const blob = dataUrlToBlob('data:text/plain,hello%20world')
    expect(blob.type).toBe('text/plain')
    expect(blob.size).toBe('hello world'.length)
  })

  it('dataUrlToFile：带文件名与 image/png 类型', () => {
    const file = dataUrlToFile(PNG_DATA_URL, 'shot.png')
    expect(file.name).toBe('shot.png')
    expect(file.type).toBe('image/png')
    expect(file.size).toBeGreaterThan(0)
  })

  it('非法 dataURL 抛错', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow()
  })
})

describe('canvas safe-file paths', () => {
  it('round-trips an absolute path containing Unicode characters', () => {
    const path = '/Users/张三/项目素材/动作参考.mp4'
    expect(decodeCanvasSafeFileUrl(encodeToSafeFileUrl(path))).toBe(path)
  })

  it('rejects malformed and non-absolute safe-file payloads', () => {
    expect(decodeCanvasSafeFileUrl('https://example.com/video.mp4')).toBeNull()
    expect(decodeCanvasSafeFileUrl(encodeToSafeFileUrl('relative/video.mp4'))).toBeNull()
  })
})

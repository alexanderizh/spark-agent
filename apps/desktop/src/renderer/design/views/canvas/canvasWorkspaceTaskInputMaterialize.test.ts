// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { materializeCanvasTaskInputFiles } from './canvasWorkspaceTaskInput'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'

/**
 * materializeCanvasTaskInputFiles 的聚焦回归测试：
 *  - cloud_url 下 video/audio 本地文件经 auth:upload-file 物质化为 https URL；
 *  - 已是 https URL 或带 fileId 的 provider 文件直通，不触发上传；
 *  - video/audio 上传失败不再走 base64 兜底，直接抛错（避免大文件 base64 膨胀）。
 */
describe('materializeCanvasTaskInputFiles (cloud_url)', () => {
  let invokeMock: ReturnType<typeof vi.fn>
  let originalSpark: unknown

  beforeEach(() => {
    originalSpark = (window as unknown as { spark?: unknown }).spark
    invokeMock = vi.fn()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke: invokeMock },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: originalSpark,
    })
  })

  it('uploads local video dataUrl to a public https url', async () => {
    invokeMock.mockResolvedValue({ aiUrl: 'https://cdn.example.com/uploaded.mp4' })
    const file: CanvasMediaTaskInputFile = {
      type: 'video',
      role: 'reference',
      dataUrl: 'data:video/mp4;base64,AAAA',
      mimeType: 'video/mp4',
    }
    const [result] = await materializeCanvasTaskInputFiles([file], 'cloud_url')
    expect(result!.url).toBe('https://cdn.example.com/uploaded.mp4')
    expect(result!.dataUrl).toBeUndefined()
    expect(invokeMock).toHaveBeenCalledWith('auth:upload-file', expect.objectContaining({ mimeType: 'video/mp4' }))
  })

  it('uploads local audio dataUrl to a public https url', async () => {
    invokeMock.mockResolvedValue({ aiUrl: 'https://cdn.example.com/uploaded.mp3' })
    const file: CanvasMediaTaskInputFile = {
      type: 'audio',
      dataUrl: 'data:audio/mpeg;base64,BB',
      mimeType: 'audio/mpeg',
    }
    const [result] = await materializeCanvasTaskInputFiles([file], 'cloud_url')
    expect(result!.url).toBe('https://cdn.example.com/uploaded.mp3')
  })

  it('passes through files that already have an https url without uploading', async () => {
    const file: CanvasMediaTaskInputFile = {
      type: 'video',
      url: 'https://cdn.example.com/already.mp4',
      mimeType: 'video/mp4',
    }
    const [result] = await materializeCanvasTaskInputFiles([file], 'cloud_url')
    expect(result!).toEqual(file)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('passes through provider files carrying a fileId without uploading', async () => {
    const file: CanvasMediaTaskInputFile = {
      type: 'video',
      fileId: 'mm_file://abc123',
      mimeType: 'video/mp4',
    }
    const [result] = await materializeCanvasTaskInputFiles([file], 'cloud_url')
    expect(result!).toEqual(file)
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('throws when video upload fails (no base64 fallback for large media)', async () => {
    invokeMock.mockRejectedValue(new Error('upload failed'))
    const file: CanvasMediaTaskInputFile = {
      type: 'video',
      dataUrl: 'data:video/mp4;base64,AAAA',
      mimeType: 'video/mp4',
    }
    await expect(materializeCanvasTaskInputFiles([file], 'cloud_url')).rejects.toThrow('upload failed')
  })
})

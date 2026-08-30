import { describe, expect, it, vi } from 'vitest'
import { resolveViewerLoadSource } from './filePreviewSource'

function encodeSafeFileUrl(filePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(filePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

describe('resolveViewerLoadSource', () => {
  it('reads a local absolute path through binary IPC', async () => {
    const content = new Uint8Array([1, 2, 3]).buffer
    const readBinaryFile = vi.fn(async () => ({ content }))

    await expect(
      resolveViewerLoadSource('C:\\workspace\\report.xlsx', readBinaryFile),
    ).resolves.toEqual({
      kind: 'local',
      buffer: content,
    })
    expect(readBinaryFile).toHaveBeenCalledWith({ filePath: 'C:\\workspace\\report.xlsx' })
  })

  it('decodes safe-file URLs before binary IPC', async () => {
    const content = new ArrayBuffer(0)
    const readBinaryFile = vi.fn(async () => ({ content }))
    const filePath = 'C:\\工作区\\演示文稿.pptx'

    await resolveViewerLoadSource(encodeSafeFileUrl(filePath), readBinaryFile)

    expect(readBinaryFile).toHaveBeenCalledWith({ filePath })
  })

  it('keeps HTTP sources on the Viewer URL path', async () => {
    const readBinaryFile = vi.fn()

    await expect(
      resolveViewerLoadSource('https://example.com/report.docx', readBinaryFile),
    ).resolves.toEqual({
      kind: 'remote',
      url: 'https://example.com/report.docx',
    })
    expect(readBinaryFile).not.toHaveBeenCalled()
  })

  it('surfaces precise IPC read errors', async () => {
    await expect(
      resolveViewerLoadSource('/workspace/missing.docx', async () => ({
        error: 'ENOENT: file not found',
      })),
    ).rejects.toThrow('ENOENT: file not found')
  })
})

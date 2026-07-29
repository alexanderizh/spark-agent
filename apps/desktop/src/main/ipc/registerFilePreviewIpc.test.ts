import { describe, expect, it, vi } from 'vitest'
import { readPreviewFileBinary } from './registerFilePreviewIpc.js'

describe('readPreviewFileBinary', () => {
  it('returns an isolated ArrayBuffer for an allowed absolute path', async () => {
    const source = new Uint8Array([10, 20, 30, 40])
    const result = await readPreviewFileBinary('/workspace/report.docx', {
      isPathAllowed: () => true,
      readFileBytes: vi.fn(async () => source.subarray(1, 3)),
    })

    expect(result.content).toBeInstanceOf(ArrayBuffer)
    if (result.content == null) throw new Error('expected binary file content')
    expect(Array.from(new Uint8Array(result.content))).toEqual([20, 30])
    expect(result.error).toBeUndefined()
  })

  it('rejects paths outside the safe-file allowlist without reading them', async () => {
    const readFileBytes = vi.fn()
    const result = await readPreviewFileBinary('/private/secret.docx', {
      isPathAllowed: () => false,
      readFileBytes,
    })

    expect(result).toEqual({ error: '预览文件不在允许读取的目录中' })
    expect(readFileBytes).not.toHaveBeenCalled()
  })

  it('rejects relative paths', async () => {
    const result = await readPreviewFileBinary('report.docx', {
      isPathAllowed: () => true,
      readFileBytes: vi.fn(),
    })

    expect(result).toEqual({ error: '预览文件路径必须是绝对路径' })
  })
})

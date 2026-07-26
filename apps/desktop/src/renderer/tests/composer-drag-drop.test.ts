import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildComposerAttachmentsFromPaths,
  getDataTransferFilePaths,
  hasFileDataTransfer,
  isUnresolvableFileDrop,
} from '../design/services/composer-attachments'

/**
 * Electron 32 起渲染进程的 File 上不再有 `path`，拖拽只能靠 preload 转发的
 * webUtils.getPathForFile。下面这组用例刻意用「没有 path 属性」的 File 形态，
 * 避免再次出现「测试用旧 API 桩造出绿灯、生产链路其实是断的」。
 */
function makeNativeFile(name: string): File {
  return { name } as unknown as File
}

describe('composer drag and drop attachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves dropped file paths via preload webUtils bridge (Electron 32+)', () => {
    const diskPaths = new Map<string, string>([
      ['index.html', '/Users/me/project/index.html'],
      ['assets', '/Users/me/project/assets'],
    ])
    const getPathForFile = vi.fn((file: File) => diskPaths.get(file.name) ?? '')
    vi.stubGlobal('spark', { getPathForFile })

    const dataTransfer = {
      files: [makeNativeFile('index.html'), makeNativeFile('assets')],
      getData: vi.fn(() => ''),
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer

    expect(getDataTransferFilePaths(dataTransfer)).toEqual([
      '/Users/me/project/index.html',
      '/Users/me/project/assets',
    ])
    expect(getPathForFile).toHaveBeenCalledTimes(2)
  })

  it('flags an unresolvable drop instead of silently dropping the files', () => {
    // webUtils 通道缺失（preload 未注入）：拿不到任何路径，但确实拖进了文件
    vi.stubGlobal('spark', {})
    const dataTransfer = {
      files: [makeNativeFile('index.html')],
      getData: vi.fn(() => ''),
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer

    const paths = getDataTransferFilePaths(dataTransfer)
    expect(paths).toEqual([])
    expect(isUnresolvableFileDrop(dataTransfer, paths)).toBe(true)
  })

  it('does not flag a drop that carried no files at all', () => {
    const dataTransfer = {
      files: [],
      getData: vi.fn(() => ''),
      items: [],
      types: ['text/plain'],
    } as unknown as DataTransfer

    expect(isUnresolvableFileDrop(dataTransfer, [])).toBe(false)
  })

  it('extracts local file paths from legacy Electron drag data', () => {
    const dataTransfer = {
      files: [
        { path: '/Users/me/project/index.html', name: 'index.html' },
        { path: '/Users/me/project/assets', name: 'assets' },
      ],
      getData: vi.fn(() => ''),
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer

    expect(hasFileDataTransfer(dataTransfer)).toBe(true)
    expect(getDataTransferFilePaths(dataTransfer)).toEqual([
      '/Users/me/project/index.html',
      '/Users/me/project/assets',
    ])
  })

  it('normalizes Windows drive paths from file URLs', () => {
    const dataTransfer = {
      files: [],
      getData: vi.fn((type: string) =>
        type === 'text/uri-list' ? 'file:///C:/Users/me/project/index.html' : '',
      ),
      items: [],
      types: ['Files'],
    } as unknown as DataTransfer

    expect(getDataTransferFilePaths(dataTransfer)).toEqual([
      'C:/Users/me/project/index.html',
    ])
  })

  it('builds image previews and directory attachments for dropped paths', async () => {
    const statFileKind = vi.fn(async ({ path }: { path: string }) => ({
      kind: path.endsWith('/assets') ? 'directory' : 'file',
    }))
    const prepareImagePreview = vi.fn(async ({ sourcePath }: { sourcePath: string }) => ({
      filePath: `${sourcePath}.preview`,
      fileUrl: `safe-file://preview/${sourcePath.split('/').pop()}`,
    }))

    const attachments = await buildComposerAttachmentsFromPaths(
      ['/Users/me/project/index.html', '/Users/me/project/screen.png', '/Users/me/project/assets'],
      {
        idPrefix: 'drop',
        prepareImagePreview,
        statFileKind,
        timestamp: 42,
      },
    )

    expect(attachments).toEqual([
      {
        id: '42-drop-0-/Users/me/project/index.html',
        name: 'index.html',
        path: '/Users/me/project/index.html',
        type: 'file',
      },
      {
        id: '42-drop-1-/Users/me/project/screen.png',
        name: 'screen.png',
        path: '/Users/me/project/screen.png',
        previewPath: '/Users/me/project/screen.png.preview',
        previewUrl: 'safe-file://preview/screen.png',
        type: 'image',
      },
      {
        id: '42-drop-2-/Users/me/project/assets',
        name: 'assets',
        path: '/Users/me/project/assets',
        type: 'directory',
      },
    ])
  })
})

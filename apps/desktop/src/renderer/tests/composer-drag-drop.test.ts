import { describe, expect, it, vi } from 'vitest'
import {
  buildComposerAttachmentsFromPaths,
  getDataTransferFilePaths,
  hasFileDataTransfer,
} from '../design/services/composer-attachments'

describe('composer drag and drop attachments', () => {
  it('extracts local file paths from Electron drag data', () => {
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

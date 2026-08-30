import { describe, expect, it, vi } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'

const workspaceRoot = join('G:', 'spark', 'spark-agent')

const electronMocks = vi.hoisted(() => ({
  paths: {
    userData: 'C:/Users/Test/AppData/Roaming/SparkAgent',
    temp: 'C:/Users/Test/AppData/Local/Temp',
    downloads: 'C:/Users/Test/Downloads',
  },
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return electronMocks.paths.userData
      if (name === 'temp') return electronMocks.paths.temp
      if (name === 'downloads') return electronMocks.paths.downloads
      return ''
    },
  },
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
  },
}))

vi.mock('../../db.js', () => ({
  getDatabase: () => ({
    raw: {
      prepare: () => ({
        all: () => [{ root_path: workspaceRoot }],
      }),
    },
  }),
}))

import {
  createSafeFileResponse,
  getSafeFileAllowedRoots,
  isSafeFilePathAllowed,
  SAFE_FILE_PRIVILEGED_SCHEME,
} from '../SafeFileProtocol.js'

describe('SafeFileProtocol', () => {
  it('enables CORS and streaming for local canvas, WebGL, audio, and video assets', () => {
    expect(SAFE_FILE_PRIVILEGED_SCHEME).toEqual(
      expect.objectContaining({
        scheme: 'safe-file',
        privileges: expect.objectContaining({
          corsEnabled: true,
          supportFetchAPI: true,
          stream: true,
        }),
      }),
    )
  })

  it('allows generated artifacts under registered workspaces', () => {
    const artifactPath = join(workspaceRoot, '.spark-artifacts', 'images', 'tang-princess.png')

    expect(isSafeFilePathAllowed(artifactPath)).toBe(true)
  })

  it('allows arbitrary files under registered workspaces (built-in preview)', () => {
    // 内置文档/图片预览需要读取项目里的任意文件（PDF、docx、图片等），
    // 因此整体放行已登记 workspace 根目录，而非仅 .spark-artifacts 子目录。
    const previewablePdf = join(workspaceRoot, 'preview-test', 'sample.pdf')

    expect(isSafeFilePathAllowed(previewablePdf)).toBe(true)
  })

  it('does not allow files outside registered workspaces', () => {
    const outsideFile = join('C:', 'Users', 'Test', '.ssh', 'id_rsa')

    expect(isSafeFilePathAllowed(outsideFile)).toBe(false)
  })

  it.runIf(process.platform !== 'win32')(
    'rejects an existing file that escapes an allowed root through a symlink',
    () => {
      const allowedRoot = mkdtempSync(join(tmpdir(), 'safe-file-root-'))
      const outsideRoot = mkdtempSync(join(tmpdir(), 'safe-file-outside-'))
      const outsideFile = join(outsideRoot, 'secret.txt')
      mkdirSync(join(allowedRoot, 'links'))
      writeFileSync(outsideFile, 'secret')
      symlinkSync(outsideRoot, join(allowedRoot, 'links', 'outside'), 'dir')
      const previousTemp = electronMocks.paths.temp
      electronMocks.paths.temp = allowedRoot

      try {
        expect(isSafeFilePathAllowed(join(allowedRoot, 'links', 'outside', 'secret.txt'))).toBe(
          false,
        )
      } finally {
        electronMocks.paths.temp = previousTemp
        rmSync(allowedRoot, { recursive: true, force: true })
        rmSync(outsideRoot, { recursive: true, force: true })
      }
    },
  )

  it('exposes workspace roots in the allowlist', () => {
    expect(getSafeFileAllowedRoots()).toContain(resolve(workspaceRoot))
  })

  it('allows board task attachments persisted outside userData', () => {
    // persistBoardAttachment 把任务附件复制到 ~/.spark-agent/board-attachments/<taskId>/，
    // 任务面板缩略图经 safe-file:// 加载；目录不在 userData/temp/workspace 下，须显式放行。
    const attachmentPath = join(homedir(), '.spark-agent', 'board-attachments', 'task-1', 'img.png')
    expect(isSafeFilePathAllowed(attachmentPath)).toBe(true)
  })

  it('still rejects ~/.spark-agent content outside board-attachments', () => {
    // 只放行 board-attachments 子目录；board-tasks.json / memory / plugins 等仍不可读。
    expect(isSafeFilePathAllowed(join(homedir(), '.spark-agent', 'board-tasks.json'))).toBe(false)
    expect(isSafeFilePathAllowed(join(homedir(), '.spark-agent', 'memory', 'profiles.json'))).toBe(
      false,
    )
  })

  it('serves video range requests with partial content headers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'safe-file-test-'))
    const file = join(dir, 'clip.mp4')
    writeFileSync(file, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))

    try {
      const request = new Request('safe-file://x/test', {
        headers: { range: 'bytes=2-5' },
      })
      const response = createSafeFileResponse(file, request)

      expect(response.status).toBe(206)
      expect(response.headers.get('content-type')).toBe('video/mp4')
      expect(response.headers.get('accept-ranges')).toBe('bytes')
      expect(response.headers.get('content-range')).toBe('bytes 2-5/8')
      expect(response.headers.get('content-length')).toBe('4')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('serves optional worker and WASM assets with executable MIME types', () => {
    const dir = mkdtempSync(join(tmpdir(), 'safe-file-mime-'))
    const worker = join(dir, 'worker.mjs')
    const wasm = join(dir, 'runtime.wasm')
    writeFileSync(worker, 'export {}')
    writeFileSync(wasm, Buffer.from([0, 97, 115, 109]))
    try {
      expect(
        createSafeFileResponse(worker, new Request('safe-file://x/worker')).headers.get(
          'content-type',
        ),
      ).toBe('text/javascript; charset=utf-8')
      expect(
        createSafeFileResponse(wasm, new Request('safe-file://x/wasm')).headers.get('content-type'),
      ).toBe('application/wasm')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  describe('downloads media preview allowlist', () => {
    let downloads: string
    let videoPath: string
    let textPath: string

    beforeAll(() => {
      downloads = mkdtempSync(join(tmpdir(), 'safe-file-dl-'))
      electronMocks.paths.downloads = downloads
      writeFileSync(join(downloads, 'dl-preview-test.mp4'), 'x')
      writeFileSync(join(downloads, 'dl-preview-test.txt'), 'x')
      videoPath = join(downloads, 'dl-preview-test.mp4')
      textPath = join(downloads, 'dl-preview-test.txt')
    })

    afterAll(() => {
      rmSync(downloads, { recursive: true, force: true })
    })

    it('allows media files directly inside Downloads for sub-app preview', () => {
      expect(isSafeFilePathAllowed(videoPath)).toBe(true)
    })

    it('rejects non-media files in Downloads', () => {
      expect(isSafeFilePathAllowed(textPath)).toBe(false)
    })

    it('rejects paths that merely prefix-match the Downloads root', () => {
      expect(isSafeFilePathAllowed(join(downloads, '..', 'Downloads-secrets.mp4'))).toBe(false)
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { join, resolve } from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const workspaceRoot = join('G:', 'spark', 'spark-agent')

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return join('C:', 'Users', 'Test', 'AppData', 'Roaming', 'SparkAgent')
      if (name === 'temp') return join('C:', 'Users', 'Test', 'AppData', 'Local', 'Temp')
      return ''
    },
  },
  net: {
    fetch: vi.fn(),
  },
  protocol: {
    handle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
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
} from '../SafeFileProtocol.js'

describe('SafeFileProtocol', () => {
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

  it('exposes workspace roots in the allowlist', () => {
    expect(getSafeFileAllowedRoots()).toContain(resolve(workspaceRoot))
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
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4, 5])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

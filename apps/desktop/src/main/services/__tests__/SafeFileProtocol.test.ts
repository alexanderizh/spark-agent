import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'

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
  getSafeFileAllowedRoots,
  isSafeFilePathAllowed,
} from '../SafeFileProtocol.js'

describe('SafeFileProtocol', () => {
  it('allows generated artifacts under registered workspaces', () => {
    const artifactPath = join(workspaceRoot, '.spark-artifacts', 'images', 'tang-princess.png')

    expect(isSafeFilePathAllowed(artifactPath)).toBe(true)
  })

  it('does not allow arbitrary workspace files', () => {
    const regularWorkspaceFile = join(workspaceRoot, 'src', 'secrets.png')

    expect(isSafeFilePathAllowed(regularWorkspaceFile)).toBe(false)
  })

  it('exposes workspace artifact roots in the allowlist', () => {
    expect(getSafeFileAllowedRoots()).toContain(join(workspaceRoot, '.spark-artifacts'))
  })
})

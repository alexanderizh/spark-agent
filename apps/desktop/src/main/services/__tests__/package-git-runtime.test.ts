/* eslint-disable @typescript-eslint/no-require-imports -- build hooks are CommonJS modules */
import { describe, expect, it, vi } from 'vitest'

const { packageGitRuntime } = require('../../../../scripts/package-git-runtime.js') as {
  packageGitRuntime: (
    context: { electronPlatformName: string; arch: string },
    options?: { lock?: unknown },
  ) => Promise<{ skipped?: boolean; platform?: string; arch?: string }>
}

function buildContext(platform: string, arch: string) {
  return { electronPlatformName: platform, arch }
}

const emptyLock = { schemaVersion: 1, targets: [] }

describe('packageGitRuntime lock semantics', () => {
  it('skips with a warning when the lock has no targets (Phase 0 not ingested)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await packageGitRuntime(buildContext('darwin', 'x64'), { lock: emptyLock })
      expect(result).toEqual({ skipped: true, platform: 'darwin', arch: 'x64' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('bundled Git runtime is not enabled')
    } finally {
      warn.mockRestore()
    }
  })

  it('fails closed when the lock has targets but none match the build target', async () => {
    const lock = {
      schemaVersion: 1,
      targets: [
        {
          artifactId: 'runtime.git-2.45.4.darwin-arm64',
          version: '2.45.4',
          platform: 'darwin',
          arch: 'arm64',
          archiveSha256: 'a'.repeat(64),
          entry: 'bin/git',
        },
      ],
    }
    await expect(packageGitRuntime(buildContext('win32', 'x64'), { lock })).rejects.toThrow(
      'Git runtime lock has no entry for win32/x64',
    )
  })
})

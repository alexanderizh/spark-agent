import { describe, expect, it } from 'vitest'

import {
  MIN_GIT_VERSION,
  buildGitChildEnvironment,
  compareVersions,
  parseGitRuntimeMode,
  parseGitVersion,
  resolveGitRuntime,
  type GitRuntimeDescriptor,
  type GitRuntimeResolverDeps,
} from './GitRuntimeService'

function makeFakeExec(systemVersion: string, bundledVersion = '2.45.4') {
  return async (
    file: string,
    args: string[],
    _options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
  ) => {
    if (file === '/usr/bin/xcode-select')
      return { stdout: '/Library/Developer/CommandLineTools\n', stderr: '' }
    if (args[0] === '--exec-path') {
      return {
        stdout:
          file === '/usr/bin/git'
            ? '/usr/libexec/git-core\n'
            : '/bundle/runtime/git/libexec/git-core\n',
        stderr: '',
      }
    }
    const version = file === '/usr/bin/git' ? systemVersion : bundledVersion
    if (version === 'broken') {
      throw new Error('spawn failed')
    }
    return { stdout: `git version ${version}\n`, stderr: '' }
  }
}

function makeDeps(overrides: Partial<GitRuntimeResolverDeps> = {}): GitRuntimeResolverDeps {
  const existing = new Set<string>([
    '/usr/bin/git',
    '/usr/libexec/git-core',
    '/usr/libexec/git-core/git-remote-https',
    '/bundle/runtime/git/git-runtime.json',
    '/bundle/runtime/git/bin/git',
    '/bundle/runtime/git/libexec/git-core',
    '/bundle/runtime/git/libexec/git-core/git-remote-https',
  ])
  return {
    env: { PATH: '/usr/bin' },
    platform: 'darwin',
    arch: 'arm64',
    resourcesPath: '/bundle',
    existsSync: (p) => existing.has(p),
    readFileSync: (p) => {
      if (p === '/bundle/runtime/git/git-runtime.json') {
        return JSON.stringify({
          version: '2.45.4',
          platform: 'darwin',
          arch: 'arm64',
          entry: 'bin/git',
        })
      }
      throw new Error(`unexpected read: ${p}`)
    },
    execFileAsync: makeFakeExec('2.45.4'),
    ...overrides,
  }
}

describe('parseGitVersion', () => {
  it('extracts plain versions', () => {
    expect(parseGitVersion('git version 2.45.4')).toBe('2.45.4')
  })

  it('extracts versions from Apple Git output', () => {
    expect(parseGitVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5')
  })

  it('returns null for unrelated output', () => {
    expect(parseGitVersion('not git')).toBeNull()
  })
})

describe('compareVersions', () => {
  it('compares major/minor/patch numerically', () => {
    expect(compareVersions('2.23.0', '2.22.5')).toBe(1)
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1)
    expect(compareVersions('2.23', '2.23.0')).toBe(0)
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1)
  })
})

describe('parseGitRuntimeMode', () => {
  it('defaults to auto', () => {
    expect(parseGitRuntimeMode(undefined)).toBe('auto')
    expect(parseGitRuntimeMode('garbage')).toBe('auto')
  })

  it('accepts explicit modes', () => {
    expect(parseGitRuntimeMode('system-only')).toBe('system-only')
    expect(parseGitRuntimeMode('bundled-only')).toBe('bundled-only')
  })
})

describe('buildGitChildEnvironment', () => {
  const descriptor: GitRuntimeDescriptor = {
    generation: 1,
    source: 'bundled',
    executablePath: '/bundle/runtime/git/bin/git',
    version: '2.45.4',
    commandEnvPatch: { GIT_EXEC_PATH: '/bundle/git/libexec/git-core' },
    shellPathEntries: ['/bundle/git/bin'],
  }

  it('merges env patch and prepends PATH entries without mutating the base', () => {
    const base = { PATH: '/usr/bin:/bin', HOME: '/home/u' }
    const child = buildGitChildEnvironment(base, descriptor)
    expect(child['GIT_EXEC_PATH']).toBe('/bundle/git/libexec/git-core')
    expect(child['PATH']).toBe('/bundle/git/bin:/usr/bin:/bin')
    expect(base['PATH']).toBe('/usr/bin:/bin')
    expect(child['HOME']).toBe('/home/u')
  })

  it('keeps a single PATH key on Windows', () => {
    const base = { Path: 'C:\\Windows;C:\\Windows\\System32', SYSTEMROOT: 'C:\\Windows' }
    const child = buildGitChildEnvironment(base, descriptor, 'win32')
    const pathKeys = Object.keys(child).filter((k) => k.toLowerCase() === 'path')
    expect(pathKeys).toEqual(['PATH'])
    expect(child['PATH']).toBe('/bundle/git/bin;C:\\Windows;C:\\Windows\\System32')
    expect(child['SYSTEMROOT']).toBe('C:\\Windows')
  })
})

describe('resolveGitRuntime', () => {
  it('prefers a valid SPARK_GIT_EXECUTABLE override', async () => {
    const result = await resolveGitRuntime(
      makeDeps({ env: { SPARK_GIT_EXECUTABLE: '/usr/bin/git' } }),
    )
    expect(result.descriptor?.source).toBe('override')
    expect(result.descriptor?.executablePath).toBe('/usr/bin/git')
    expect(result.descriptor?.shellPathEntries).toEqual(['/usr/bin'])
  })

  it('fails strictly on an invalid override instead of falling back', async () => {
    const result = await resolveGitRuntime(
      makeDeps({ env: { SPARK_GIT_EXECUTABLE: '/nonexistent/git' } }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('override_invalid')
  })

  it('rejects a relative override instead of resolving it through PATH', async () => {
    const result = await resolveGitRuntime(
      makeDeps({ env: { SPARK_GIT_EXECUTABLE: 'git' }, existsSync: () => true }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('override_invalid')
  })

  it('rejects an override below the minimum supported version', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_EXECUTABLE: '/usr/bin/git' },
        execFileAsync: makeFakeExec('2.20.0'),
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('override_invalid')
  })

  it('uses system Git when it meets the minimum version', async () => {
    const result = await resolveGitRuntime(makeDeps())
    expect(result.descriptor?.source).toBe('system')
    expect(result.descriptor?.executablePath).toBe('/usr/bin/git')
    expect(result.descriptor?.shellPathEntries).toEqual(['/usr/bin'])
  })

  it('falls back to bundled when system Git is below the minimum version', async () => {
    const result = await resolveGitRuntime(makeDeps({ execFileAsync: makeFakeExec('2.20.0') }))
    expect(result.descriptor?.source).toBe('bundled')
    expect(result.descriptor?.executablePath).toBe('/bundle/runtime/git/bin/git')
    expect(result.descriptor?.commandEnvPatch['GIT_EXEC_PATH']).toBeDefined()
    expect(result.descriptor?.shellPathEntries).toEqual(['/bundle/runtime/git/bin'])
  })

  it('reports unavailable when nothing works in auto mode', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        existsSync: () => false,
        execFileAsync: async () => {
          throw new Error('spawn ENOENT')
        },
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('no_system_git')
  })

  it('respects system-only mode (no bundled fallback)', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_RUNTIME_MODE: 'system-only' },
        existsSync: () => false,
        execFileAsync: async () => {
          throw new Error('spawn ENOENT')
        },
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('no_system_git')
  })

  it('respects bundled-only mode (ignores system Git)', async () => {
    const result = await resolveGitRuntime(
      makeDeps({ env: { SPARK_GIT_RUNTIME_MODE: 'bundled-only' } }),
    )
    expect(result.descriptor?.source).toBe('bundled')
  })

  it('rejects bundled metadata for a foreign platform/arch', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_RUNTIME_MODE: 'bundled-only' },
        arch: 'x64',
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('bundled_missing')
  })

  it('rejects a bundled runtime whose health check fails', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_RUNTIME_MODE: 'bundled-only' },
        execFileAsync: makeFakeExec('2.45.4', 'broken'),
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('bundled_invalid')
  })

  it('rejects a bundled runtime whose version differs from its metadata', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_RUNTIME_MODE: 'bundled-only' },
        execFileAsync: makeFakeExec('2.45.4', '2.30.1'),
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('bundled_invalid')
  })

  it('rejects a bundled runtime below the minimum supported version', async () => {
    const result = await resolveGitRuntime(
      makeDeps({
        env: { SPARK_GIT_RUNTIME_MODE: 'bundled-only' },
        readFileSync: () =>
          JSON.stringify({
            version: '2.20.0',
            platform: 'darwin',
            arch: 'arm64',
            entry: 'bin/git',
          }),
        execFileAsync: makeFakeExec('2.45.4', '2.20.0'),
      }),
    )
    expect(result.descriptor).toBeNull()
    expect(result.unavailableReason).toBe('bundled_invalid')
  })

  it('documents the enforced minimum version', () => {
    expect(compareVersions(MIN_GIT_VERSION, '2.30.9')).toBe(1)
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GitCommandError,
  GitCommandService,
  buildGitChildEnvironment,
  getDefaultGitCommandService,
  type GitCommandRuntimeDescriptor,
  type GitCommandRuntimeProvider,
} from '../../services/git-command.service.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'spark-git-command-'))
  tempDirs.push(dir)
  return dir
}

function descriptor(
  executablePath = process.execPath,
  generation = 1,
): GitCommandRuntimeDescriptor {
  return {
    generation,
    source: 'bundled',
    executablePath,
    version: '2.45.4',
    commandEnvPatch: { SPARK_GIT_TEST_PATCH: 'patched' },
    shellPathEntries: ['/runtime/git/bin'],
  }
}

function provider(initial: GitCommandRuntimeDescriptor | null): GitCommandRuntimeProvider & {
  refreshCount: number
  next: GitCommandRuntimeDescriptor | null
} {
  let current = initial
  return {
    refreshCount: 0,
    next: initial,
    current: () => ({ descriptor: current, message: current == null ? 'missing runtime' : null }),
    resolve: async () => ({
      descriptor: current,
      message: current == null ? 'missing runtime' : null,
    }),
    async refresh() {
      this.refreshCount += 1
      current = this.next
      return { descriptor: current, message: current == null ? 'missing runtime' : null }
    },
  }
}

describe('GitCommandService', () => {
  it('executes argument arrays with the descriptor environment', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(descriptor()))
    const result = await service.execute(
      ['-e', 'process.stdout.write(process.env.SPARK_GIT_TEST_PATCH || "")'],
      { cwd },
    )
    expect(result.stdout).toBe('patched')
    expect(result.runtime.source).toBe('bundled')
  })

  it('returns explicitly allowed non-zero exit codes', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(descriptor()))
    const result = await service.execute(['-e', 'process.exit(7)'], {
      cwd,
      allowedExitCodes: [0, 7],
    })
    expect(result.exitCode).toBe(7)
  })

  it('does not refresh or replay a command after the process started', async () => {
    const cwd = await tempDir()
    const runtime = provider(descriptor())
    const service = new GitCommandService(runtime)
    await expect(
      service.execute(['-e', 'process.exit(9)'], { cwd, operation: 'write' }),
    ).rejects.toMatchObject({
      code: 'GIT_OPERATION_FAILED',
      started: true,
    })
    expect(runtime.refreshCount).toBe(0)
  })

  it('refreshes once when a missing executable prevented process start', async () => {
    const cwd = await tempDir()
    const missing = join(cwd, 'missing-git')
    const runtime = provider(descriptor(missing, 1))
    runtime.next = descriptor(process.execPath, 2)
    const service = new GitCommandService(runtime)
    const result = await service.execute(['-e', 'process.stdout.write("ok")'], { cwd })
    expect(result.stdout).toBe('ok')
    expect(result.runtime.generation).toBe(2)
    expect(runtime.refreshCount).toBe(1)
  })

  it('does not treat a missing cwd as a missing Git runtime', async () => {
    const cwd = await tempDir()
    const runtime = provider(descriptor())
    const service = new GitCommandService(runtime)
    await rm(cwd, { recursive: true, force: true })
    await expect(service.execute(['--version'], { cwd })).rejects.toMatchObject({
      code: 'GIT_OPERATION_FAILED',
      message: 'Git working directory is unavailable',
    })
    expect(runtime.refreshCount).toBe(0)
  })

  it('marks timed-out writes as outcome unknown', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(descriptor()))
    await expect(
      service.execute(['-e', 'setInterval(() => {}, 1000)'], {
        cwd,
        operation: 'write',
        timeoutMs: 30,
      }),
    ).rejects.toMatchObject({
      code: 'GIT_OPERATION_OUTCOME_UNKNOWN',
      timedOut: true,
    })
  })

  it('marks an output-limited write as outcome unknown and terminates it', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(descriptor()))
    await expect(
      service.execute(
        ['-e', 'process.stdout.write("x".repeat(1024)); setInterval(() => {}, 1000)'],
        {
          cwd,
          operation: 'write',
          maxBufferBytes: 32,
        },
      ),
    ).rejects.toMatchObject({
      code: 'GIT_OPERATION_OUTCOME_UNKNOWN',
      timedOut: false,
    })
  })

  it('classifies non-interactive authentication failures', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(descriptor()))
    await expect(
      service.execute(
        ['-e', 'process.stderr.write("fatal: could not read Username"); process.exit(1)'],
        { cwd, operation: 'network' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('reports unavailable runtime before spawning', async () => {
    const cwd = await tempDir()
    const service = new GitCommandService(provider(null))
    await expect(service.execute(['--version'], { cwd })).rejects.toEqual(
      expect.objectContaining<Partial<GitCommandError>>({ code: 'GIT_RUNTIME_UNAVAILABLE' }),
    )
  })

  it('classifies worktree, non-repository and dubious-ownership probes', async () => {
    const cwd = await tempDir()
    const runtime = descriptor()
    const service = new GitCommandService(provider(runtime))
    const execute = vi.spyOn(service, 'execute')
    execute.mockResolvedValueOnce({
      stdout: 'true\nfalse\n',
      stderr: '',
      exitCode: 0,
      runtime,
    })
    await expect(service.probeRepository(cwd)).resolves.toMatchObject({
      kind: 'ready',
      repositoryKind: 'worktree',
    })

    execute.mockResolvedValueOnce({
      stdout: '',
      stderr: 'fatal: not a git repository',
      exitCode: 128,
      runtime,
    })
    await expect(service.probeRepository(cwd)).resolves.toEqual({ kind: 'not_repository' })

    execute.mockResolvedValueOnce({
      stdout: '',
      stderr: 'fatal: detected dubious ownership in repository',
      exitCode: 128,
      runtime,
    })
    await expect(service.probeRepository(cwd)).resolves.toMatchObject({
      kind: 'failed',
      message: expect.stringContaining('dubious ownership'),
    })
  })
})

describe('buildGitChildEnvironment', () => {
  it('normalizes Windows Path casing and prepends bundled entries', () => {
    const env = buildGitChildEnvironment(
      { Path: 'C:\\Windows', KEEP: '1' },
      descriptor('C:\\Spark\\git.exe'),
      'win32',
    )
    expect(env.Path).toBeUndefined()
    expect(env.PATH).toBe('/runtime/git/bin;C:\\Windows')
    expect(env.KEEP).toBe('1')
  })
})

describe('default Git runtime provider', () => {
  it('resolves the PATH fallback to an absolute executable', () => {
    const runtime = getDefaultGitCommandService().getCurrentRuntime()
    expect(runtime).not.toBeNull()
    expect(isAbsolute(runtime?.executablePath ?? '')).toBe(true)
  })
})

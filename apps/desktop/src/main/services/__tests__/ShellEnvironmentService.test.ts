import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  homeDir: null as string | null,
}))

// 部分替换：实现链上其他模块还会用到 child_process 的其他导出（如 exec），
// 整模块替换会令它们解析失败。
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    execFile: mocks.execFile,
  }
})

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return {
    ...original,
    homedir: () => mocks.homeDir ?? original.homedir(),
  }
})

function mockExecFile(
  impl: (command: string, args: string[]) => { error?: Error; stdout?: string; stderr?: string },
): void {
  ;(mocks.execFile as typeof mocks.execFile & {
    [promisify.custom]: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  })[promisify.custom] = async (command: string, args: string[]) => {
    const result = impl(command, args)
    if (result.error) throw result.error
    return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
  }
  mocks.execFile.mockImplementation((command: string, args: string[], optionsOrCallback: unknown, maybeCallback?: unknown) => {
    const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void
    const result = impl(command, args)
    setTimeout(() => {
      callback(result.error ?? null, result.stdout ?? '', result.stderr ?? '')
    }, 0)
    return new EventEmitter()
  })
}

describe('ShellEnvironmentService', () => {
  let tempDir: string | null = null
  let originalBundledNpmCli: string | undefined
  let originalBundledNode: string | undefined
  let originalPath: string | undefined
  let originalShell: string | undefined

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalBundledNpmCli = process.env.SPARK_BUNDLED_NPM_CLI
    originalBundledNode = process.env.SPARK_STANDALONE_NODE
    originalPath = process.env.PATH
    originalShell = process.env.SHELL
    mocks.homeDir = null
  })

  afterEach(() => {
    if (originalBundledNpmCli == null) {
      delete process.env.SPARK_BUNDLED_NPM_CLI
    } else {
      process.env.SPARK_BUNDLED_NPM_CLI = originalBundledNpmCli
    }
    if (originalBundledNode == null) {
      delete process.env.SPARK_STANDALONE_NODE
    } else {
      process.env.SPARK_STANDALONE_NODE = originalBundledNode
    }
    if (originalPath == null) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
    if (originalShell == null) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
    if (tempDir != null) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = null
    }
    mocks.homeDir = null
  })

  it('detects bundled npm when npm is not available on PATH', async () => {
    tempDir = join(tmpdir(), `spark-bundled-npm-${Date.now()}`)
    const npmCli = join(tempDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    const nodeRuntime = join(tempDir, 'runtime', 'node')
    mkdirSync(join(tempDir, 'node_modules', 'npm', 'bin'), { recursive: true })
    mkdirSync(join(tempDir, 'runtime'), { recursive: true })
    writeFileSync(npmCli, '')
    writeFileSync(nodeRuntime, '')
    process.env.SPARK_BUNDLED_NPM_CLI = npmCli
    process.env.SPARK_STANDALONE_NODE = nodeRuntime

    mockExecFile((command, args) => {
      if (command === nodeRuntime && args[0] === npmCli && args[1] === '--version') {
        return { stdout: '10.9.2\n' }
      }
      return { error: new Error(`not found: ${command}`) }
    })

    const { recheckRuntimeTools } = await import('../ShellEnvironmentService.js')
    const status = await recheckRuntimeTools()
    const npm = status.tools.find((tool) => tool.command === 'npm')

    expect(npm).toMatchObject({
      available: true,
      resolvedPath: npmCli,
      version: '10.9.2',
    })
  })

  it('loads the login shell PATH before a stale desktop PATH', async () => {
    process.env.PATH = '/legacy/node16/bin:/usr/bin'
    process.env.SHELL = '/bin/zsh'

    mockExecFile((command, args) => {
      if (command === '/usr/bin/env') {
        const shellIndex = args.indexOf('/bin/zsh')
        expect(args.slice(shellIndex + 1, shellIndex + 3)).toEqual(['-l', '-c'])
        return {
          stdout:
            'shell startup text\n__SPARK_SHELL_PATH__/Users/test/.nvm/versions/node/v22.18.0/bin:/usr/bin\n',
        }
      }
      return { error: new Error(`unexpected command: ${command}`) }
    })

    const { fixShellPath } = await import('../ShellEnvironmentService.js')
    const result = await fixShellPath()

    expect(result.changed).toBe(true)
    expect(result.fixedPath.split(':').slice(0, 2)).toEqual([
      '/Users/test/.nvm/versions/node/v22.18.0/bin',
      '/usr/bin',
    ])
    expect(result.fixedPath.indexOf('/Users/test/.nvm/versions/node/v22.18.0/bin')).toBeLessThan(
      result.fixedPath.indexOf('/legacy/node16/bin'),
    )
  })

  it('prefers the nvm default alias over older installed versions', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'spark-shell-home-'))
    mocks.homeDir = tempDir
    process.env.PATH = '/usr/bin:/bin'
    process.env.SHELL = '/bin/zsh'

    const versionsDir = join(tempDir, '.nvm', 'versions', 'node')
    mkdirSync(join(versionsDir, 'v16.14.0', 'bin'), { recursive: true })
    mkdirSync(join(versionsDir, 'v22.18.0', 'bin'), { recursive: true })
    mkdirSync(join(tempDir, '.nvm', 'alias'), { recursive: true })
    writeFileSync(join(tempDir, '.nvm', 'alias', 'default'), '22.18\n')

    mockExecFile((command) => {
      if (command === '/usr/bin/env') {
        return { stdout: '__SPARK_SHELL_PATH__/usr/bin:/bin\n' }
      }
      return { error: new Error(`unexpected command: ${command}`) }
    })

    const { fixShellPath } = await import('../ShellEnvironmentService.js')
    const result = await fixShellPath()
    const node22Path = join(versionsDir, 'v22.18.0', 'bin')
    const node16Path = join(versionsDir, 'v16.14.0', 'bin')

    expect(result.fixedPath.indexOf(node22Path)).toBeLessThan(result.fixedPath.indexOf(node16Path))
  })
})

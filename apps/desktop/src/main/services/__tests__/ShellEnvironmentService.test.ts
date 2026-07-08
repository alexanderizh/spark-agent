import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}))

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

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    originalBundledNpmCli = process.env.SPARK_BUNDLED_NPM_CLI
    originalBundledNode = process.env.SPARK_ELECTRON_NODE
  })

  afterEach(() => {
    if (originalBundledNpmCli == null) {
      delete process.env.SPARK_BUNDLED_NPM_CLI
    } else {
      process.env.SPARK_BUNDLED_NPM_CLI = originalBundledNpmCli
    }
    if (originalBundledNode == null) {
      delete process.env.SPARK_ELECTRON_NODE
    } else {
      process.env.SPARK_ELECTRON_NODE = originalBundledNode
    }
    if (tempDir != null) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('detects bundled npm when npm is not available on PATH', async () => {
    tempDir = join(tmpdir(), `spark-bundled-npm-${Date.now()}`)
    const npmCli = join(tempDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    mkdirSync(join(tempDir, 'node_modules', 'npm', 'bin'), { recursive: true })
    writeFileSync(npmCli, '')
    process.env.SPARK_BUNDLED_NPM_CLI = npmCli
    process.env.SPARK_ELECTRON_NODE = process.execPath

    mockExecFile((command, args) => {
      if (command === process.execPath && args[0] === npmCli && args[1] === '--version') {
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
})

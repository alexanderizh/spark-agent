import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => process.cwd()),
    on: vi.fn(),
  },
  spawn: vi.fn(),
}))

vi.mock('electron', () => ({
  app: mocks.app,
}))

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}))

vi.mock('../ShellEnvironmentService.js', () => ({
  recheckRuntimeTools: vi.fn(async () => ({ tools: [] })),
}))

function makeSpawnResult(code = 0): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  const on = child.on.bind(child)
  child.on = ((eventName: string | symbol, listener: (...args: unknown[]) => void) => {
    const result = on(eventName, listener)
    if (eventName === 'close') {
      setTimeout(() => {
        child.emit('close', code)
      }, 0)
    }
    return result
  }) as typeof child.on
  return child
}

function makePendingSpawnResult(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('SdkIntegrityService', () => {
  let tempRoot: string | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.app.isPackaged = false
    mocks.app.getAppPath.mockReturnValue(process.cwd())
  })

  afterEach(() => {
    if (tempRoot != null) {
      rmSync(tempRoot, { recursive: true, force: true })
      tempRoot = null
    }
  })

  it('does not hot-install core SDK packages from packaged builds', async () => {
    mocks.app.isPackaged = true
    const { installSdk } = await import('../SdkIntegrityService.js')

    const result = await installSdk('@openai/codex-sdk')

    expect(result.success).toBe(false)
    expect(result.message).toContain('生产安装包不能热安装核心 SDK')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('detects installed Codex SDK packages that do not export package.json', async () => {
    const { checkSdkIntegrity } = await import('../SdkIntegrityService.js')

    const result = await checkSdkIntegrity({ checkLatest: false })
    const codexSdk = result.sdks.find((sdk) => sdk.packageName === '@openai/codex-sdk')

    expect(codexSdk?.installed).toBe(true)
    expect(codexSdk?.installedVersion).toBe('0.143.0')
  })

  it('installs SDK packages into apps/desktop during development', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'spark-sdk-integrity-'))
    const desktopDir = join(tempRoot, 'apps', 'desktop')
    mkdirSync(desktopDir, { recursive: true })
    writeFileSync(join(desktopDir, 'package.json'), JSON.stringify({ name: '@spark/desktop' }))
    mocks.app.getAppPath.mockReturnValue(tempRoot)
    mocks.spawn.mockReturnValue(makeSpawnResult(0))
    const { installSdk } = await import('../SdkIntegrityService.js')

    const result = await installSdk('@openai/codex-sdk')

    expect(result.success).toBe(true)
    const spawnOptions = mocks.spawn.mock.calls[0]?.[2] as { cwd?: string; shell?: boolean } | undefined
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^pnpm(\.cmd)?$/),
      ['add', '@openai/codex-sdk@latest'],
      expect.objectContaining({ shell: true }),
    )
    expect(spawnOptions?.cwd).toMatch(/apps[/\\]desktop$/)
    expect(spawnOptions?.cwd).not.toContain(join('packages', 'agent-runtime'))
  })

  it('rejects concurrent SDK installs to avoid package manager lockfile conflicts', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'spark-sdk-integrity-'))
    const desktopDir = join(tempRoot, 'apps', 'desktop')
    mkdirSync(desktopDir, { recursive: true })
    writeFileSync(join(desktopDir, 'package.json'), JSON.stringify({ name: '@spark/desktop' }))
    mocks.app.getAppPath.mockReturnValue(tempRoot)
    const pending = makePendingSpawnResult()
    mocks.spawn.mockReturnValue(pending)
    const { installSdk } = await import('../SdkIntegrityService.js')

    const first = installSdk('@openai/codex-sdk')
    const second = await installSdk('@anthropic-ai/claude-agent-sdk')

    expect(second.success).toBe(false)
    expect(second.message).toContain('@openai/codex-sdk 正在安装')
    expect(mocks.spawn).toHaveBeenCalledTimes(1)

    pending.emit('close', 0)
    await first
  })

  it('preserves optional dependency placement when updating Claude Agent SDK', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'spark-sdk-integrity-'))
    const desktopDir = join(tempRoot, 'apps', 'desktop')
    mkdirSync(desktopDir, { recursive: true })
    writeFileSync(
      join(desktopDir, 'package.json'),
      JSON.stringify({
        name: '@spark/desktop',
        optionalDependencies: { '@anthropic-ai/claude-agent-sdk': '0.3.204' },
      }),
    )
    mocks.app.getAppPath.mockReturnValue(tempRoot)
    mocks.spawn.mockReturnValue(makeSpawnResult(0))
    const { installSdk } = await import('../SdkIntegrityService.js')

    const result = await installSdk('@anthropic-ai/claude-agent-sdk')

    expect(result.success).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^pnpm(\.cmd)?$/),
      ['add', '--save-optional', '@anthropic-ai/claude-agent-sdk@latest'],
      expect.objectContaining({ shell: true }),
    )
  })

  it('keeps Codex SDK in the desktop packaging dependency closure', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>
    }

    expect(pkg.dependencies?.['@openai/codex-sdk']).toBe('0.143.0')
  })

  it('unpacks Codex platform binaries from Electron asar archives', () => {
    const builderConfig = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf-8')

    expect(builderConfig).toContain('**/node_modules/@openai/codex-*/vendor/**/bin/codex')
    expect(builderConfig).toContain('**/node_modules/@openai/codex-*/vendor/**/bin/codex.exe')
    expect(builderConfig).toContain('**/node_modules/@openai/codex-*/vendor/**/codex-path/**')
  })
})

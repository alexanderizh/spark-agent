import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SparkInstallArtifact } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'

const desktopPackage = JSON.parse(
  readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'),
) as { dependencies?: Record<string, string> }
const CODEX_SDK_VERSION = desktopPackage.dependencies?.['@openai/codex-sdk'] ?? ''
const [sdkMajor = '0', sdkMinor = '0', sdkPatch = '0'] = CODEX_SDK_VERSION.split('.')
const UPDATED_RUNTIME_VERSION = `${sdkMajor}.${sdkMinor}.${Number(sdkPatch) + 1}`

const mocks = vi.hoisted(() => ({
  userData: '',
  artifacts: [] as SparkInstallArtifact[],
  installBinaryArchive: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(() => mocks.userData),
  },
}))

vi.mock(
  '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js')
      >()
    return {
      ...original,
      fetchSparkInstallManifest: vi.fn(async () => ({
        schemaVersion: 1,
        updatedAt: '2026-07-18T00:00:00.000Z',
        baseUrl: 'https://downloads.example.test',
        artifacts: mocks.artifacts,
      })),
    }
  },
)

vi.mock(
  '../../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js',
  () => ({ installBinaryArchive: mocks.installBinaryArchive }),
)

vi.mock('../../../../../../packages/agent-runtime/src/sdk/codex-sdk-executor.js', () => ({
  resolveBundledCodexCli: vi.fn(() => null),
}))

function artifact(
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch,
  targetTriple = currentTargetTriple(),
): SparkInstallArtifact {
  return {
    id: `runtime.codex-agent.${version}.${platform}-${arch}`,
    type: 'binary',
    runtime: 'codex',
    name: `Codex ${platform}-${arch}`,
    version,
    url: `codex-${version}-${platform}-${arch}.tgz`,
    sha256: 'a'.repeat(64),
    size: 100,
    platform: platform as Exclude<SparkInstallArtifact['platform'], undefined>,
    arch: arch as Exclude<SparkInstallArtifact['arch'], undefined>,
    targetTriple,
    sdkPackage: `@openai/codex-sdk@${CODEX_SDK_VERSION}`,
    archive: { format: 'tar.gz', contentRoot: '.' },
  }
}

function currentTargetTriple(): string {
  if (process.platform === 'darwin')
    return process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  if (process.platform === 'win32')
    return process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  return process.arch === 'arm64' ? 'aarch64-unknown-linux-musl' : 'x86_64-unknown-linux-musl'
}

describe('CodexRuntimeIntegrityService', () => {
  beforeEach(() => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'spark-codex-integrity-'))
    mocks.artifacts = [artifact(CODEX_SDK_VERSION)]
    mocks.installBinaryArchive.mockReset()
    mocks.installBinaryArchive.mockImplementation(
      async (options: {
        destDir: string
        onProgress?: (downloaded: number, total: number) => void
      }) => {
        options.onProgress?.(50, 100)
        options.onProgress?.(100, 100)
        mkdirSync(join(options.destDir, 'bin'), { recursive: true })
        writeFileSync(
          join(options.destDir, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
          'codex',
        )
        writeFileSync(join(options.destDir, 'codex-package.json'), '{}')
      },
    )
    delete process.env.SPARK_CODEX_RUNTIME_ROOT
    delete process.env.SPARK_CODEX_SDK_VERSION
    delete process.env.SPARK_CODEX_REQUIRE_RUNTIME
  })

  afterEach(() => {
    rmSync(mocks.userData, { recursive: true, force: true })
    delete process.env.SPARK_CODEX_RUNTIME_ROOT
    delete process.env.SPARK_CODEX_SDK_VERSION
    delete process.env.SPARK_CODEX_REQUIRE_RUNTIME
  })

  it('detects the version of the ESM-only Codex SDK package', async () => {
    const { configureCodexRuntimeEnvironment } = await import('../CodexRuntimeIntegrityService.js')

    configureCodexRuntimeEnvironment()

    expect(CODEX_SDK_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(process.env.SPARK_CODEX_SDK_VERSION).toBe(CODEX_SDK_VERSION)
  })

  it('selects only the artifact matching platform, architecture, target triple, and SDK', async () => {
    const { selectCodexArtifact } = await import('../CodexRuntimeIntegrityService.js')
    const matrix: Array<[NodeJS.Platform, NodeJS.Architecture, string]> = [
      ['darwin', 'arm64', 'aarch64-apple-darwin'],
      ['darwin', 'x64', 'x86_64-apple-darwin'],
      ['linux', 'arm64', 'aarch64-unknown-linux-musl'],
      ['linux', 'x64', 'x86_64-unknown-linux-musl'],
      ['win32', 'arm64', 'aarch64-pc-windows-msvc'],
      ['win32', 'x64', 'x86_64-pc-windows-msvc'],
    ]
    const artifacts = matrix.map(([platform, arch, triple]) =>
      artifact(CODEX_SDK_VERSION, platform, arch, triple),
    )

    for (const [platform, arch, triple] of matrix) {
      const selected = selectCodexArtifact(artifacts, triple, CODEX_SDK_VERSION, platform, arch)
      expect(selected).toMatchObject({ platform, arch, targetTriple: triple })
    }
    expect(
      selectCodexArtifact(artifacts, 'aarch64-apple-darwin', '9.9.9', 'darwin', 'arm64'),
    ).toBeUndefined()
  })

  it('rejects Codex runtime artifacts without a valid SHA256', async () => {
    const invalid = artifact(CODEX_SDK_VERSION)
    delete invalid.sha256
    mocks.artifacts = [invalid]
    const { installCodexRuntime } = await import('../CodexRuntimeIntegrityService.js')

    const result = await installCodexRuntime(CODEX_SDK_VERSION)

    expect(result.success).toBe(false)
    expect(result.message).toContain('缺少有效的 SHA256')
    expect(mocks.installBinaryArchive).not.toHaveBeenCalled()
  })

  it('reports byte progress through verification and activation', async () => {
    const { installCodexRuntime } = await import('../CodexRuntimeIntegrityService.js')
    const progress: Array<{
      state: string
      downloaded: number
      total: number
      percent: number | null
    }> = []

    const result = await installCodexRuntime(CODEX_SDK_VERSION, (event) => {
      progress.push({
        state: event.state,
        downloaded: event.downloaded,
        total: event.total,
        percent: event.percent,
      })
    })

    expect(result.success).toBe(true)
    expect(progress).toEqual(
      expect.arrayContaining([
        { state: 'preparing', downloaded: 0, total: 0, percent: 0 },
        { state: 'downloading', downloaded: 50, total: 100, percent: 50 },
        { state: 'verifying', downloaded: 100, total: 100, percent: 100 },
        { state: 'activating', downloaded: 100, total: 100, percent: 100 },
        { state: 'done', downloaded: 100, total: 100, percent: 100 },
      ]),
    )
  })

  it('atomically upgrades the active runtime and keeps it under userData', async () => {
    const { checkCodexRuntimeIntegrity, getCodexRuntimeRootPath, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')

    expect((await installCodexRuntime(CODEX_SDK_VERSION)).success).toBe(true)
    mocks.artifacts = [artifact(CODEX_SDK_VERSION), artifact(UPDATED_RUNTIME_VERSION)]
    expect(await checkCodexRuntimeIntegrity(true, CODEX_SDK_VERSION)).toMatchObject({
      installed: true,
      installedVersion: CODEX_SDK_VERSION,
      latestVersion: UPDATED_RUNTIME_VERSION,
      updateAvailable: true,
    })
    expect((await installCodexRuntime(CODEX_SDK_VERSION)).newVersion).toBe(UPDATED_RUNTIME_VERSION)

    const runtimeRoot = getCodexRuntimeRootPath()
    const active = JSON.parse(readFileSync(join(runtimeRoot, 'active.json'), 'utf8')) as {
      version: string
      sdkPackage: string
    }
    expect(runtimeRoot).toBe(join(mocks.userData, 'agent-runtimes', 'codex'))
    expect(active).toMatchObject({
      version: UPDATED_RUNTIME_VERSION,
      sdkPackage: `@openai/codex-sdk@${CODEX_SDK_VERSION}`,
    })

    delete process.env.SPARK_CODEX_RUNTIME_ROOT
    delete process.env.SPARK_CODEX_SDK_VERSION
    expect(await checkCodexRuntimeIntegrity(false, CODEX_SDK_VERSION)).toMatchObject({
      installed: true,
      installedVersion: UPDATED_RUNTIME_VERSION,
    })
  })
})

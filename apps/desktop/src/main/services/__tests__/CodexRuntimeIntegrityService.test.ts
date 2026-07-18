import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SparkInstallArtifact } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'

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
    sdkPackage: '@openai/codex-sdk@0.144.5',
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
    mocks.artifacts = [artifact('0.144.5')]
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
      artifact('0.144.5', platform, arch, triple),
    )

    for (const [platform, arch, triple] of matrix) {
      const selected = selectCodexArtifact(artifacts, triple, '0.144.5', platform, arch)
      expect(selected).toMatchObject({ platform, arch, targetTriple: triple })
    }
    expect(
      selectCodexArtifact(artifacts, 'aarch64-apple-darwin', '9.9.9', 'darwin', 'arm64'),
    ).toBeUndefined()
  })

  it('rejects Codex runtime artifacts without a valid SHA256', async () => {
    const invalid = artifact('0.144.5')
    delete invalid.sha256
    mocks.artifacts = [invalid]
    const { installCodexRuntime } = await import('../CodexRuntimeIntegrityService.js')

    const result = await installCodexRuntime('0.144.5')

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

    const result = await installCodexRuntime('0.144.5', (event) => {
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

    expect((await installCodexRuntime('0.144.5')).success).toBe(true)
    mocks.artifacts = [artifact('0.144.5'), artifact('0.144.6')]
    expect(await checkCodexRuntimeIntegrity(true, '0.144.5')).toMatchObject({
      installed: true,
      installedVersion: '0.144.5',
      latestVersion: '0.144.6',
      updateAvailable: true,
    })
    expect((await installCodexRuntime('0.144.5')).newVersion).toBe('0.144.6')

    const runtimeRoot = getCodexRuntimeRootPath()
    const active = JSON.parse(readFileSync(join(runtimeRoot, 'active.json'), 'utf8')) as {
      version: string
      sdkPackage: string
    }
    expect(runtimeRoot).toBe(join(mocks.userData, 'agent-runtimes', 'codex'))
    expect(active).toMatchObject({
      version: '0.144.6',
      sdkPackage: '@openai/codex-sdk@0.144.5',
    })

    delete process.env.SPARK_CODEX_RUNTIME_ROOT
    delete process.env.SPARK_CODEX_SDK_VERSION
    expect(await checkCodexRuntimeIntegrity(false, '0.144.5')).toMatchObject({
      installed: true,
      installedVersion: '0.144.6',
    })
  })
})

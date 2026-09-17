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

const FUTURE_RUNTIME_VERSION = '9.9.9'

/** 与云端真实 manifest 一致：sdkPackage 记录的是该制品自身的版本。 */
function publishedRuntime(version: string): SparkInstallArtifact {
  return { ...artifact(version), sdkPackage: `@openai/codex-sdk@${version}` }
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
    ).toMatchObject({ version: CODEX_SDK_VERSION })
  })

  // 回归：应用内 SDK 版本不在云端 manifest 时，曾经因为「精确相等」过滤得到空集，
  // 完整性页既不显示可用更新也无法安装，Codex 直接不可用。
  describe('runtime artifact selection without an exact SDK pairing', () => {
    const runtime = (version: string, sdkVersion: string): SparkInstallArtifact => ({
      id: `runtime.codex-agent.${version}.darwin-arm64`,
      type: 'binary',
      runtime: 'codex',
      name: `Codex ${version}`,
      version,
      url: `codex-${version}.tgz`,
      sha256: 'a'.repeat(64),
      size: 100,
      platform: 'darwin',
      arch: 'arm64',
      targetTriple: 'aarch64-apple-darwin',
      sdkPackage: `@openai/codex-sdk@${sdkVersion}`,
      archive: { format: 'tar.gz', contentRoot: '.' },
    })

    it('prefers the artifact paired with the app SDK', async () => {
      const { selectCodexRuntimeArtifact } = await import('../CodexRuntimeIntegrityService.js')
      const selection = selectCodexRuntimeArtifact(
        [runtime('0.149.0', '0.149.0'), runtime('0.153.4', '0.153.4')],
        'aarch64-apple-darwin',
        '0.149.0',
        'darwin',
        'arm64',
      )
      expect(selection.artifact).toMatchObject({ version: '0.149.0' })
      expect(selection.reason).toBe('exact-sdk-match')
    })

    it('falls back to the newest runtime not newer than the app SDK', async () => {
      const { selectCodexRuntimeArtifact } = await import('../CodexRuntimeIntegrityService.js')
      // 应用 SDK 0.152.0 从未发布过对应 runtime：旧实现返回空集。
      const selection = selectCodexRuntimeArtifact(
        [
          runtime('0.144.5', '0.144.5'),
          runtime('0.149.0', '0.149.0'),
          runtime('0.153.4', '0.153.4'),
        ],
        'aarch64-apple-darwin',
        '0.152.0',
        'darwin',
        'arm64',
      )
      expect(selection.artifact).toMatchObject({ version: '0.149.0' })
      expect(selection.reason).toBe('newest-compatible')
    })

    it('picks the newest supported runtime when the app SDK version is unknown', async () => {
      const { selectCodexRuntimeArtifact } = await import('../CodexRuntimeIntegrityService.js')
      const selection = selectCodexRuntimeArtifact(
        [runtime('0.144.5', '0.144.5'), runtime('0.153.4', '0.153.4')],
        'aarch64-apple-darwin',
        null,
        'darwin',
        'arm64',
      )
      expect(selection.artifact).toMatchObject({ version: '0.153.4' })
      expect(selection.reason).toBe('newest-compatible')
    })

    it('refuses to install a runtime newer than the app SDK and explains why', async () => {
      const { selectCodexRuntimeArtifact, describeCodexRuntimeSelection } =
        await import('../CodexRuntimeIntegrityService.js')
      const selection = selectCodexRuntimeArtifact(
        [runtime('0.153.4', '0.153.4')],
        'aarch64-apple-darwin',
        '0.140.0',
        'darwin',
        'arm64',
      )
      expect(selection.artifact).toBeUndefined()
      expect(selection.reason).toBe('newer-than-app-sdk')
      expect(describeCodexRuntimeSelection(selection, 'aarch64-apple-darwin', '0.140.0')).toContain(
        '升级 Spark Agent',
      )
    })

    it('ignores runtimes below the protocol baseline and says so', async () => {
      const { selectCodexRuntimeArtifact, describeCodexRuntimeSelection } =
        await import('../CodexRuntimeIntegrityService.js')
      const selection = selectCodexRuntimeArtifact(
        [runtime('0.140.0', '0.140.0')],
        'aarch64-apple-darwin',
        '0.153.4',
        'darwin',
        'arm64',
      )
      expect(selection.artifact).toBeUndefined()
      expect(selection.reason).toBe('below-protocol-baseline')
      expect(selection.candidateVersions).toEqual(['0.140.0'])
      expect(describeCodexRuntimeSelection(selection, 'aarch64-apple-darwin', '0.153.4')).toContain(
        '协议基线',
      )
    })

    it('reports when the platform has no published runtime at all', async () => {
      const { selectCodexRuntimeArtifact, describeCodexRuntimeSelection } =
        await import('../CodexRuntimeIntegrityService.js')
      const selection = selectCodexRuntimeArtifact([], 'aarch64-apple-darwin', '0.153.4')
      expect(selection.artifact).toBeUndefined()
      expect(selection.reason).toBe('no-published-runtime')
      expect(describeCodexRuntimeSelection(selection, 'aarch64-apple-darwin', '0.153.4')).toContain(
        '暂未提供',
      )
    })
  })

  it('explains why a newer published runtime is not offered to an older app', async () => {
    // 应用内置 SDK 0.144.5、已装 0.144.5、云端已有 0.153.4：旧实现页面直接显示「最新」，
    // 用户完全不知道云端还有更新。现在必须给出可读说明。
    const older = {
      ...artifact('0.144.5'),
      sdkPackage: '@openai/codex-sdk@0.144.5',
    }
    mocks.artifacts = [
      older,
      {
        ...artifact(UPDATED_RUNTIME_VERSION),
        sdkPackage: `@openai/codex-sdk@${UPDATED_RUNTIME_VERSION}`,
      },
    ]
    const { checkCodexRuntimeIntegrity, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')
    await installCodexRuntime('0.144.5')
    const integrity = await checkCodexRuntimeIntegrity(true, '0.144.5')
    expect(integrity.latestVersion).toBe('0.144.5')
    expect(integrity.updateAvailable).toBe(false)
    expect(integrity.note).toContain(UPDATED_RUNTIME_VERSION)
    expect(integrity.note).toContain('升级 Spark Agent')
  })

  it('surfaces a readable reason when the manifest has no installable runtime', async () => {
    // 只有晚于应用 SDK 的制品：必须给出「无可安装更新」的可读原因，
    // 而不是让完整性页一片空白。
    mocks.artifacts = [
      {
        ...artifact(UPDATED_RUNTIME_VERSION),
        sdkPackage: `@openai/codex-sdk@${UPDATED_RUNTIME_VERSION}`,
      },
    ]
    const { checkCodexRuntimeIntegrity } = await import('../CodexRuntimeIntegrityService.js')
    const integrity = await checkCodexRuntimeIntegrity(true, '0.100.0')
    expect(integrity.latestVersion).toBeNull()
    expect(integrity.updateAvailable).toBe(false)
    expect(integrity.error).toContain('升级 Spark Agent')
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

  it('keeps an older compatible runtime installed and presents the matching runtime as optional update', async () => {
    const previousRuntimeVersion = '0.144.5'
    mocks.artifacts = [artifact(previousRuntimeVersion)]
    const { checkCodexRuntimeIntegrity, getCodexRuntimeRootPath, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')

    expect((await installCodexRuntime(CODEX_SDK_VERSION)).success).toBe(true)
    const activePath = join(getCodexRuntimeRootPath(), 'active.json')
    const active = JSON.parse(readFileSync(activePath, 'utf8')) as Record<string, unknown>
    writeFileSync(
      activePath,
      `${JSON.stringify(
        {
          ...active,
          sdkPackage: `@openai/codex-sdk@${previousRuntimeVersion}`,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    mocks.artifacts = [artifact(CODEX_SDK_VERSION)]

    await expect(checkCodexRuntimeIntegrity(true, CODEX_SDK_VERSION)).resolves.toMatchObject({
      installed: true,
      installedVersion: previousRuntimeVersion,
      latestVersion: CODEX_SDK_VERSION,
      updateAvailable: true,
    })
  })

  it('explains why a newer published runtime is not offered when it is not paired with the app SDK', async () => {
    mocks.artifacts = [publishedRuntime(CODEX_SDK_VERSION)]
    const { checkCodexRuntimeIntegrity, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')
    expect((await installCodexRuntime(CODEX_SDK_VERSION)).success).toBe(true)
    mocks.artifacts = [
      publishedRuntime(CODEX_SDK_VERSION),
      publishedRuntime(FUTURE_RUNTIME_VERSION),
    ]

    const integrity = await checkCodexRuntimeIntegrity(true, CODEX_SDK_VERSION)

    expect(integrity.error).toBeUndefined()
    expect(integrity.updateAvailable).toBe(false)
    expect(integrity.latestVersion).toBe(CODEX_SDK_VERSION)
    expect(integrity.note).toContain(FUTURE_RUNTIME_VERSION)
    expect(integrity.note).toContain('升级 Spark Agent')
  })

  it('explains the unpaired newer runtime when only a fallback version can be offered', async () => {
    mocks.artifacts = [publishedRuntime(CODEX_SDK_VERSION)]
    const { checkCodexRuntimeIntegrity, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')
    expect((await installCodexRuntime(CODEX_SDK_VERSION)).success).toBe(true)
    mocks.artifacts = [
      publishedRuntime(CODEX_SDK_VERSION),
      publishedRuntime(FUTURE_RUNTIME_VERSION),
    ]
    const unpairedAppSdkVersion = `0.${Number(CODEX_SDK_VERSION.split('.')[1] ?? '0') + 1}.0`

    const integrity = await checkCodexRuntimeIntegrity(true, unpairedAppSdkVersion)

    expect(integrity.latestVersion).toBe(CODEX_SDK_VERSION)
    expect(integrity.note).toContain(FUTURE_RUNTIME_VERSION)
  })

  it('does not raise an error when the installed runtime already covers the newest published one', async () => {
    mocks.artifacts = [publishedRuntime(FUTURE_RUNTIME_VERSION)]
    const { checkCodexRuntimeIntegrity, installCodexRuntime } =
      await import('../CodexRuntimeIntegrityService.js')
    // 用未来版本号安装，构造「>= 云端全部制品，但与应用内 SDK 不配对」的本机状态。
    expect((await installCodexRuntime(FUTURE_RUNTIME_VERSION)).success).toBe(true)

    const integrity = await checkCodexRuntimeIntegrity(true, CODEX_SDK_VERSION)

    expect(integrity.installedVersion).toBe(FUTURE_RUNTIME_VERSION)
    expect(integrity.error).toBeUndefined()
    expect(integrity.note).toBeUndefined()
    expect(integrity.latestVersion).toBe(FUTURE_RUNTIME_VERSION)
    expect(integrity.updateAvailable).toBe(false)
  })
})

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { parseMacSignatureOutput } =
  require('../../../../scripts/verify-packaged-native-host-macos.js') as {
    parseMacSignatureOutput: (output: string) => {
      identifier: string
      teamIdentifier: string
      hardenedRuntime: boolean
    }
  }
const {
  assertSmokeReport,
  createSmokeEnvironment,
  detectWindowsPeArchitecture,
  parseArguments,
  runFinalAppSmoke,
  DEFAULT_SMOKE_TIMEOUT_MS,
  SMOKE_CLEANUP_OPTIONS,
  summarizeOutput,
  validatePackagedNativeHost,
} = require('../../../../scripts/verify-packaged-native-host.js') as {
  assertSmokeReport: (report: unknown, expected: object) => void
  createSmokeEnvironment: (environment: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
  detectWindowsPeArchitecture: (executable: Buffer) => string
  parseArguments: (argv: string[], required: string[]) => Record<string, unknown>
  runFinalAppSmoke: (options: object) => Promise<unknown>
  DEFAULT_SMOKE_TIMEOUT_MS: number
  SMOKE_CLEANUP_OPTIONS: { maxRetries: number; retryDelay: number }
  summarizeOutput: (...outputs: string[]) => string
  validatePackagedNativeHost: (options: object) => Promise<unknown>
}

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('packaged Native Host release verifier', () => {
  it('accepts only matching final bytes and build provenance', async () => {
    const fixture = await createFixture()

    await expect(validatePackagedNativeHost(fixture.options)).resolves.toMatchObject({
      manifest: { platform: 'macos', architecture: 'arm64' },
      buildInfo: { buildMode: 'signed' },
    })
  })

  it('rejects bytes changed after manifest generation', async () => {
    const fixture = await createFixture()
    await writeFile(fixture.executablePath, 'changed-after-signing', { mode: 0o755 })

    await expect(validatePackagedNativeHost(fixture.options)).rejects.toThrow(
      'final-byte digest mismatch',
    )
  })

  it('rejects symlinked executable artifacts', async () => {
    const fixture = await createFixture()
    const target = join(fixture.root, 'real-host')
    await writeFile(target, 'host-bytes', { mode: 0o755 })
    await rm(fixture.executablePath)
    await symlink(target, fixture.executablePath)

    await expect(validatePackagedNativeHost(fixture.options)).rejects.toThrow('regular non-symlink')
  })

  it('requires signed provenance unless local verification is explicit', async () => {
    const fixture = await createFixture({ buildMode: 'local' })

    await expect(validatePackagedNativeHost(fixture.options)).rejects.toThrow(
      'requires a signed Native Host',
    )
    await expect(
      validatePackagedNativeHost({ ...fixture.options, allowLocal: true }),
    ).resolves.toBeDefined()
  })

  it('rejects signed release provenance without a concrete source commit', async () => {
    const fixture = await createFixture({ commit: 'unknown' })

    await expect(validatePackagedNativeHost(fixture.options)).rejects.toThrow(
      'requires a concrete source commit',
    )
  })

  it('requires the final App report to prove matching architecture and handshake', () => {
    const report = createSmokeReport()
    expect(() =>
      assertSmokeReport(report, { platform: 'macos', architecture: 'arm64' }),
    ).not.toThrow()
    expect(() => assertSmokeReport(report, { platform: 'macos', architecture: 'x64' })).toThrow(
      'capabilities do not match release provenance',
    )
  })

  it('parses explicit verifier inputs and rejects unsupported architecture', () => {
    expect(parseArguments(['--app', '/tmp/App.app', '--arch', 'arm64'], ['app', 'arch'])).toEqual({
      app: '/tmp/App.app',
      arch: 'arm64',
    })
    expect(() =>
      parseArguments(['--app', '/tmp/App.app', '--arch', 'ia32'], ['app', 'arch']),
    ).toThrow('--arch must be arm64 or x64')
  })

  it('reads x64 and arm64 PE machine types and rejects malformed executables', () => {
    expect(detectWindowsPeArchitecture(createPeFixture(0x8664))).toBe('x64')
    expect(detectWindowsPeArchitecture(createPeFixture(0xaa64))).toBe('arm64')
    expect(() => detectWindowsPeArchitecture(Buffer.from('not-pe'))).toThrow('DOS header')
  })

  it('requires explicit macOS identity fields and hardened runtime flags', () => {
    expect(
      parseMacSignatureOutput(
        'Identifier=com.spark-agent.desktop.computer-host\nTeamIdentifier=ABCDEFGHIJ\nCodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1',
      ),
    ).toEqual({
      identifier: 'com.spark-agent.desktop.computer-host',
      teamIdentifier: 'ABCDEFGHIJ',
      hardenedRuntime: true,
    })
    expect(() => parseMacSignatureOutput('Identifier=host')).toThrow('missing its identifier')
  })

  it('does not forward release credentials or Node execution switches into the final App', () => {
    expect(
      createSmokeEnvironment({
        PATH: '/usr/bin',
        HOME: '/Users/release',
        PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
        CSC_KEY_PASSWORD: 'secret',
        WIN_CSC_LINK: 'certificate',
        GH_TOKEN: 'token',
        AWS_SECRET_ACCESS_KEY: 'secret',
        NODE_OPTIONS: '--require attack.js',
        ELECTRON_RUN_AS_NODE: '1',
      }),
    ).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/release',
      PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    })
  })

  it('retries Windows smoke cleanup long enough for SQLite handles to close', () => {
    expect(SMOKE_CLEANUP_OPTIONS.maxRetries).toBeGreaterThanOrEqual(5)
    expect(SMOKE_CLEANUP_OPTIONS.retryDelay).toBeGreaterThanOrEqual(100)
  })

  it('allows two bounded Windows trust probes to finish before aborting the smoke', () => {
    expect(DEFAULT_SMOKE_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000)
  })

  it('keeps the end of noisy App output where the Native Host failure is logged', () => {
    expect(
      summarizeOutput(`startup-${'x'.repeat(3_000)}-native-host-parent-auth-failed`),
    ).toContain('native-host-parent-auth-failed')
  })

  it('includes the structured smoke report when the final App exits unsuccessfully', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-native-verifier-'))
    temporaryRoots.push(root)
    const appExecutable = join(root, 'fake-app.js')
    await writeFile(
      appExecutable,
      `#!/usr/bin/env node
const { writeFileSync } = require('node:fs')
writeFileSync(process.env.SPARK_NATIVE_HOST_SMOKE_REPORT, JSON.stringify({
  ok: false,
  capabilities: { available: false, unavailableReason: 'native_host_untrusted' },
  diagnostics: { result: { diagnosticCode: 'parent_auth_failed', stage: 'handshake' } }
}))
process.exit(1)
`,
      { mode: 0o755 },
    )

    await expect(
      runFinalAppSmoke({
        appExecutable,
        platform: 'windows',
        architecture: 'x64',
        env: { PATH: process.env.PATH },
      }),
    ).rejects.toThrow(/native_host_untrusted.*parent_auth_failed/)

    await expect(readFile(appExecutable, 'utf8')).resolves.toContain('parent_auth_failed')
  })
})

async function createFixture(options: { buildMode?: 'signed' | 'local'; commit?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'spark-native-verifier-'))
  temporaryRoots.push(root)
  const executablePath = join(root, 'SparkComputerHost')
  const manifestPath = join(root, 'manifest.json')
  const buildInfoPath = join(root, 'native-host-build.json')
  const executable = Buffer.from('host-bytes')
  const buildMode = options.buildMode ?? 'signed'
  await mkdir(root, { recursive: true })
  await writeFile(executablePath, executable, { mode: 0o755 })
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion: '0.1.0',
      ...(buildMode === 'local' ? { trustMode: 'local' } : {}),
      platform: 'macos',
      architecture: 'arm64',
      executableFileName: 'SparkComputerHost',
      sha256: createHash('sha256').update(executable).digest('hex'),
    }),
  )
  await writeFile(
    buildInfoPath,
    JSON.stringify({
      schemaVersion: 1,
      platform: 'macos',
      architecture: 'arm64',
      protocol: { minimum: 1, maximum: 1 },
      hostVersion: '0.1.0',
      commit: options.commit ?? '1234567',
      buildMode,
      generatedAt: '2026-08-01T00:00:00.000Z',
    }),
  )
  return {
    root,
    executablePath,
    options: {
      platform: 'macos',
      architecture: 'arm64',
      executablePath,
      manifestPath,
      buildInfoPath,
    },
  }
}

function createSmokeReport() {
  return {
    ok: true,
    capabilities: {
      available: true,
      platform: 'macos',
      nativeHost: {
        platform: 'macos',
        architecture: 'arm64',
        protocolVersion: 1,
        hostVersion: '0.1.0',
      },
    },
    diagnostics: {
      runtime: { platform: 'macos', architecture: 'arm64' },
      host: { version: '0.1.0', protocolVersion: 1 },
      result: { diagnosticCode: 'native_host_ready', stage: 'handshake' },
    },
  }
}

function createPeFixture(machine: number): Buffer {
  const executable = Buffer.alloc(128)
  executable.write('MZ', 0, 'ascii')
  executable.writeUInt32LE(64, 0x3c)
  executable.write('PE\0\0', 64, 'ascii')
  executable.writeUInt16LE(machine, 68)
  return executable
}

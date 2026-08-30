import { createHash } from 'node:crypto'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NativeHostArtifactError,
  buildWindowsCodeSignatureInspectionScript,
  createMacCodeRequirement,
  hasUnsafePosixArtifactPermissions,
  readNativeHostArtifactTrustMode,
  windowsCodeSignatureExecOptions,
  windowsCodeSignatureInspectionError,
  verifyLocalNativeHostArtifact,
  verifyWindowsNativeHostArtifact,
  verifyNativeHostArtifact,
} from './NativeHostArtifact.js'

const cleanupDirectories: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(
    cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('verifyLocalNativeHostArtifact', () => {
  it('accepts a hash-bound local artifact without requiring a publisher certificate', async () => {
    const fixture = await createLocalArtifactFixture()

    await expect(readNativeHostArtifactTrustMode(fixture.manifestPath)).resolves.toBe('local')
    await expect(
      verifyLocalNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
      }),
    ).resolves.toMatchObject({ trustMode: 'local' })
  })

  it('rejects modified local Host bytes', async () => {
    const fixture = await createLocalArtifactFixture()
    await writeFile(fixture.executablePath, 'tampered')

    await expect(
      verifyLocalNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
      }),
    ).rejects.toThrowError('Native Host executable digest does not match its artifact manifest')
  })
})

describe('verifyNativeHostArtifact', () => {
  it('anchors the designated requirement to Apple, the signing identifier, and the team', () => {
    expect(
      createMacCodeRequirement({
        identifier: 'com.spark-agent.desktop.computer-host',
        teamIdentifier: 'ABCDE12345',
      }),
    ).toBe(
      'anchor apple generic and identifier "com.spark-agent.desktop.computer-host" and certificate leaf[subject.OU] = "ABCDE12345"',
    )
  })

  it('binds the executable bytes, wire version, platform, architecture, and code signature', async () => {
    const fixture = await createArtifactFixture()
    const inspectCodeSignature = vi.fn(async () => ({
      identifier: 'com.spark-agent.desktop.computer-host',
      teamIdentifier: 'ABCDE12345',
    }))

    const artifact = await verifyNativeHostArtifact({
      executablePath: fixture.executablePath,
      manifestPath: fixture.manifestPath,
      platform: 'macos',
      architecture: 'arm64',
      expectedTeamIdentifier: 'ABCDE12345',
      inspectCodeSignature,
    })

    expect(artifact.manifest.hostVersion).toBe('0.1.0')
    expect(artifact.executablePath).toBe(fixture.executablePath)
    expect(inspectCodeSignature).toHaveBeenCalledWith(fixture.executablePath)
  })

  it('skips redundant code-signature inspection when an unchanged artifact is re-verified', async () => {
    const fixture = await createArtifactFixture()
    const inspectCodeSignature = vi.fn(async () => ({
      identifier: 'com.spark-agent.desktop.computer-host',
      teamIdentifier: 'ABCDE12345',
    }))
    const verifyOnce = () =>
      verifyNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
        inspectCodeSignature,
      })

    await verifyOnce()
    await verifyOnce()

    // The first call runs the full sha256 + codesign inspection; the second call hits the
    // process-local cache (same path/inode/mtime/size/identity) and skips inspection entirely.
    expect(inspectCodeSignature).toHaveBeenCalledTimes(1)
  })

  it('rejects a symlink even when it resolves to bytes with the expected hash', async () => {
    const fixture = await createArtifactFixture()
    const linkedPath = join(fixture.directory, 'LinkedComputerHost')
    await symlink(fixture.executablePath, linkedPath)

    await expect(
      verifyNativeHostArtifact({
        executablePath: linkedPath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
        inspectCodeSignature: vi.fn(),
      }),
    ).rejects.toMatchObject({
      code: 'native_host_untrusted',
    } satisfies Partial<NativeHostArtifactError>)
  })

  it('rejects executable bytes that no longer match the signed artifact manifest', async () => {
    const fixture = await createArtifactFixture()
    await writeFile(fixture.executablePath, 'tampered')

    await expect(
      verifyNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
        inspectCodeSignature: vi.fn(),
      }),
    ).rejects.toThrowError('Native Host executable digest does not match its artifact manifest')
  })

  it('rejects a valid signature from a different team or signing identifier', async () => {
    const fixture = await createArtifactFixture()

    await expect(
      verifyNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
        inspectCodeSignature: async () => ({
          identifier: 'com.attacker.host',
          teamIdentifier: 'ZZZZZ99999',
        }),
      }),
    ).rejects.toThrowError('Native Host code signature does not match its artifact manifest')
  })

  it('rejects a manifest and host signed together by a different Apple developer team', async () => {
    const fixture = await createArtifactFixture('ZZZZZ99999')

    await expect(
      verifyNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
        inspectCodeSignature: async () => ({
          identifier: 'com.spark-agent.desktop.computer-host',
          teamIdentifier: 'ZZZZZ99999',
        }),
      }),
    ).rejects.toThrowError('Native Host signing team does not match the SparkWork application')
  })

  it('rejects a correctly signed Host below the minimum trusted security version and surfaces an actionable diagnostic', async () => {
    const fixture = await createArtifactFixture('ABCDE12345', '0.0.9')

    const error = await verifyNativeHostArtifact({
      executablePath: fixture.executablePath,
      manifestPath: fixture.manifestPath,
      platform: 'macos',
      architecture: 'arm64',
      expectedTeamIdentifier: 'ABCDE12345',
      inspectCodeSignature: async () => ({
        identifier: 'com.spark-agent.desktop.computer-host',
        teamIdentifier: 'ABCDE12345',
      }),
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(error).toBeInstanceOf(NativeHostArtifactError)
    expect((error as Error).message).toBe(
      'Native Host version is below the minimum trusted release',
    )
    expect((error as NativeHostArtifactError).diagnostic).toMatchObject({
      diagnosticCode: 'artifact_version_too_low',
      stage: 'verify',
      repairAction: 'update_app',
    })
  })
})

describe('verifyWindowsNativeHostArtifact', () => {
  it('does not interpret Windows synthetic mode bits as POSIX write permissions', () => {
    expect(hasUnsafePosixArtifactPermissions(0o666, 'win32')).toBe(false)
    expect(hasUnsafePosixArtifactPermissions(0o666, 'darwin')).toBe(true)
    expect(hasUnsafePosixArtifactPermissions(0o644, 'darwin')).toBe(false)
  })

  it('only permits a valid chain or an explicitly self-signed untrusted publisher', () => {
    const script = buildWindowsCodeSignatureInspectionScript()

    expect(script).toContain('$env:SPARK_AUTHENTICODE_PATH')
    expect(script).not.toContain('$args[0]')
    expect(script).toContain('$signature.Status -eq "UnknownError"')
    expect(script).toContain('$signature.Status -eq "NotTrusted"')
    expect(script).toContain(
      '$signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer',
    )
    expect(script).toContain('$signature.Status -ne "Valid" -and -not $selfSignedPublisher')
  })

  it('extends Authenticode inspection only for the bounded release smoke', () => {
    const executablePath = 'C:\\Program Files\\SparkWork\\SparkWork.exe'
    const runtimeOptions = windowsCodeSignatureExecOptions(executablePath, {})
    const releaseOptions = windowsCodeSignatureExecOptions(executablePath, {
      SPARK_NATIVE_HOST_SMOKE_REPORT: 'C:\\Temp\\native-host-report.json',
    })

    expect(runtimeOptions.timeout).toBe(30_000)
    expect(releaseOptions.timeout).toBe(120_000)
    expect(releaseOptions.env.SPARK_AUTHENTICODE_PATH).toBe(executablePath)
  })

  it('surfaces an actionable error when Windows Authenticode inspection times out', () => {
    const error = windowsCodeSignatureInspectionError({ killed: true, signal: 'SIGTERM' }, 120_000)

    expect(error).toBeInstanceOf(NativeHostArtifactError)
    expect(error.message).toContain('timed out after 120000ms')
  })

  it('binds the EXE hash and WinVerifyTrust publisher thumbprint to the outer application signer', async () => {
    const fixture = await createWindowsArtifactFixture()
    const inspectCodeSignature = vi.fn(async () => ({ publisherThumbprint: 'd'.repeat(64) }))

    const artifact = await verifyWindowsNativeHostArtifact({
      executablePath: fixture.executablePath,
      manifestPath: fixture.manifestPath,
      platform: 'windows',
      architecture: 'x64',
      expectedPublisherThumbprint: 'd'.repeat(64),
      inspectCodeSignature,
    })

    expect(artifact.manifest).toMatchObject({
      platform: 'windows',
      signingPublisherThumbprint: 'd'.repeat(64),
    })
    expect(inspectCodeSignature).toHaveBeenCalledWith(fixture.executablePath)
  })

  it('rejects a trusted executable signed by a different publisher certificate', async () => {
    const fixture = await createWindowsArtifactFixture()

    await expect(
      verifyWindowsNativeHostArtifact({
        executablePath: fixture.executablePath,
        manifestPath: fixture.manifestPath,
        platform: 'windows',
        architecture: 'x64',
        expectedPublisherThumbprint: 'd'.repeat(64),
        inspectCodeSignature: async () => ({ publisherThumbprint: 'e'.repeat(64) }),
      }),
    ).rejects.toThrowError('Native Host publisher does not match its artifact manifest')
  })
})

async function createArtifactFixture(
  signingTeamIdentifier = 'ABCDE12345',
  hostVersion = '0.1.0',
): Promise<{
  directory: string
  executablePath: string
  manifestPath: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-native-host-artifact-'))
  cleanupDirectories.push(directory)
  const executablePath = join(directory, 'SparkComputerHost')
  const manifestPath = join(directory, 'manifest.json')
  const executable = Buffer.from('trusted-native-host-fixture')
  await writeFile(executablePath, executable, { mode: 0o755 })
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion,
      platform: 'macos',
      architecture: 'arm64',
      executableFileName: 'SparkComputerHost',
      sha256: createHash('sha256').update(executable).digest('hex'),
      signingIdentifier: 'com.spark-agent.desktop.computer-host',
      signingTeamIdentifier,
    }),
  )
  return { directory, executablePath, manifestPath }
}

async function createWindowsArtifactFixture(): Promise<{
  directory: string
  executablePath: string
  manifestPath: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-windows-native-host-artifact-'))
  cleanupDirectories.push(directory)
  const executablePath = join(directory, 'SparkComputerHost.exe')
  const manifestPath = join(directory, 'manifest.json')
  const executable = Buffer.from('trusted-windows-native-host-fixture')
  await writeFile(executablePath, executable, { mode: 0o755 })
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion: '0.1.0',
      platform: 'windows',
      architecture: 'x64',
      executableFileName: 'SparkComputerHost.exe',
      sha256: createHash('sha256').update(executable).digest('hex'),
      signingPublisherThumbprint: 'd'.repeat(64),
    }),
  )
  return { directory, executablePath, manifestPath }
}

async function createLocalArtifactFixture(): Promise<{
  directory: string
  executablePath: string
  manifestPath: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'spark-local-native-host-artifact-'))
  cleanupDirectories.push(directory)
  const executablePath = join(directory, 'SparkComputerHost')
  const manifestPath = join(directory, 'manifest.json')
  const executable = Buffer.from('local-native-host-fixture')
  await writeFile(executablePath, executable, { mode: 0o755 })
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion: '0.1.0',
      trustMode: 'local',
      platform: 'macos',
      architecture: 'arm64',
      executableFileName: 'SparkComputerHost',
      sha256: createHash('sha256').update(executable).digest('hex'),
    }),
  )
  return { directory, executablePath, manifestPath }
}

/* eslint-disable @typescript-eslint/no-require-imports -- build hooks are CommonJS modules */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { pruneMacElectronLocales, hardenElectronFuses } =
  require('../../../../scripts/after-pack.js') as {
    pruneMacElectronLocales: (appPath: string) => Promise<{ kept: string[]; removed: number }>
    hardenElectronFuses: (
      context: unknown,
      dependencies: {
        flipFuses(path: string, options: Record<string | number, unknown>): Promise<void>
      },
    ) => Promise<void>
  }
const {
  createNativeHostManifest,
  createLocalNativeHostManifest,
  parseCodeSignatureOutput,
  resolveMacNativeHostTrustMode,
  macNativeHostDestinationPaths,
} = require('../../../../scripts/package-native-host.js') as {
  createNativeHostManifest: (input: {
    executable: Buffer
    architecture: 'arm64' | 'x64'
    signature: { identifier: string; teamIdentifier: string }
  }) => Record<string, unknown>
  createLocalNativeHostManifest: (input: {
    executable: Buffer
    architecture: 'arm64' | 'x64'
  }) => Record<string, unknown>
  parseCodeSignatureOutput: (output: string) => {
    identifier: string
    teamIdentifier: string
  }
  resolveMacNativeHostTrustMode: (environment: NodeJS.ProcessEnv) => 'signed' | 'local' | 'auto'
  macNativeHostDestinationPaths: (
    appPath: string,
    architecture: 'arm64' | 'x64',
  ) => { destinationExecutable: string; manifestPath: string }
}
const { Arch } = require('builder-util') as { Arch: Record<string | number, string | number> }
const { FuseV1Options } = require('@electron/fuses') as {
  FuseV1Options: Record<string, number>
}
const {
  createWindowsNativeHostManifest,
  createLocalWindowsNativeHostManifest,
  normalizePublisherThumbprint,
  resolveWindowsNativeHostTrustMode,
  signWindowsNativeHost,
  inspectWindowsAuthenticode,
} = require('../../../../scripts/package-windows-native-host.js') as {
  createWindowsNativeHostManifest: (input: {
    executable: Buffer
    architecture: 'arm64' | 'x64'
    publisherThumbprint: string
  }) => Record<string, unknown>
  createLocalWindowsNativeHostManifest: (input: {
    executable: Buffer
    architecture: 'arm64' | 'x64'
  }) => Record<string, unknown>
  normalizePublisherThumbprint: (value: string) => string
  resolveWindowsNativeHostTrustMode: (environment: NodeJS.ProcessEnv) => 'signed' | 'local'
  signWindowsNativeHost: (
    packager: { signIf?: (path: string) => Promise<boolean> },
    executablePath: string,
  ) => Promise<void>
  inspectWindowsAuthenticode: (
    executablePath: string,
    options: {
      environment: NodeJS.ProcessEnv
      runCommand: (
        command: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv },
      ) => Promise<{ stdout: string; stderr: string }>
    },
  ) => Promise<{ publisherThumbprint: string; timestamped: boolean }>
}
const { verifyWindowsPackageSigners } = require('../../../../scripts/notarize.js') as {
  verifyWindowsPackageSigners: (
    context: unknown,
    options: {
      expectedPublisherThumbprint: string
      inspect: (path: string) => Promise<{ publisherThumbprint: string; timestamped: boolean }>
    },
  ) => Promise<void>
}
const { packageStandaloneNodeRuntime } =
  require('../../../../scripts/package-standalone-node.js') as {
    packageStandaloneNodeRuntime: (
      context: unknown,
      options: {
        sourceExecutable: string
        hostPlatform: string
        hostArch: string
      },
    ) => Promise<{ executablePath: string }>
  }

describe('after-pack locale pruning', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('keeps only English, Simplified Chinese and Traditional Chinese', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-after-pack-'))
    const resources = join(
      root,
      'Spark Agent.app',
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
    )
    for (const locale of ['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj', 'de.lproj', 'ja.lproj']) {
      mkdirSync(join(resources, locale), { recursive: true })
      writeFileSync(join(resources, locale, 'locale.pak'), locale)
    }

    const result = await pruneMacElectronLocales(join(root, 'Spark Agent.app'))

    expect(result).toEqual({
      kept: ['en.lproj', 'zh_CN.lproj', 'zh_TW.lproj'],
      removed: 2,
    })
  })
})

describe('after-pack Electron fuses', () => {
  it('disables Node injection surfaces and requires the embedded ASAR', async () => {
    const calls: Array<{ path: string; options: Record<string | number, unknown> }> = []
    await hardenElectronFuses(
      {
        electronPlatformName: 'win32',
        appOutDir: 'C:\\SparkWork',
        packager: {
          appInfo: { productFilename: 'Spark Agent' },
          platformSpecificBuildOptions: { executableName: 'SparkWork' },
        },
      },
      { flipFuses: async (path, options) => void calls.push({ path, options }) },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toContain('SparkWork.exe')
    expect(calls[0]?.options[FuseV1Options.RunAsNode!]).toBe(false)
    expect(calls[0]?.options[FuseV1Options.EnableNodeOptionsEnvironmentVariable!]).toBe(false)
    expect(calls[0]?.options[FuseV1Options.EnableNodeCliInspectArguments!]).toBe(false)
    expect(calls[0]?.options[FuseV1Options.EnableEmbeddedAsarIntegrityValidation!]).toBe(true)
    expect(calls[0]?.options[FuseV1Options.OnlyLoadAppFromAsar!]).toBe(true)
  })
})

describe('after-pack Native Host artifact manifest', () => {
  it('keeps the macOS executable in Helpers and its manifest out of the nested code tree', () => {
    expect(macNativeHostDestinationPaths('/Applications/SparkWork.app', 'arm64')).toEqual({
      destinationExecutable: '/Applications/SparkWork.app/Contents/Helpers/SparkComputerHost',
      manifestPath:
        '/Applications/SparkWork.app/Contents/Resources/native-host/macos-arm64/manifest.json',
    })
  })

  it('packages a separate Node executable instead of reusing the Electron app binary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'spark-node-runtime-'))
    const source = join(root, 'node-source')
    writeFileSync(source, 'standalone-node')
    try {
      const result = await packageStandaloneNodeRuntime(
        {
          electronPlatformName: 'darwin',
          arch: Arch.arm64,
          appOutDir: root,
          packager: { appInfo: { productFilename: 'Spark Agent' } },
        },
        { sourceExecutable: source, hostPlatform: 'darwin', hostArch: 'arm64' },
      )
      expect(result.executablePath).toBe(
        join(root, 'Spark Agent.app', 'Contents', 'Resources', 'runtime', 'node', 'node'),
      )
      expect(readFileSync(result.executablePath, 'utf8')).toBe('standalone-node')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('binds the final signed executable bytes to the protocol and designated identity', () => {
    const signature = parseCodeSignatureOutput(`
Identifier=com.spark-agent.desktop.computer-host
TeamIdentifier=ABCDE12345
`)

    expect(
      createNativeHostManifest({
        executable: Buffer.from('signed-host'),
        architecture: 'arm64',
        signature,
      }),
    ).toEqual({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion: '0.1.0',
      platform: 'macos',
      architecture: 'arm64',
      executableFileName: 'SparkComputerHost',
      sha256: '62a23a30cea7e12173df48fdeaf6a4427df900374fe788bf9be6ac180baadacc',
      signingIdentifier: 'com.spark-agent.desktop.computer-host',
      signingTeamIdentifier: 'ABCDE12345',
    })
  })

  it('rejects ad-hoc or ambiguously identified code signatures', () => {
    expect(() =>
      parseCodeSignatureOutput('Identifier=SparkComputerHost\nTeamIdentifier=not set'),
    ).toThrow('Native Host signature does not contain a trusted identifier and Team ID')
  })

  it('binds the signed Windows executable to its SHA-256 publisher certificate', () => {
    const publisherThumbprint = normalizePublisherThumbprint(
      'DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD DD',
    )

    expect(
      createWindowsNativeHostManifest({
        executable: Buffer.from('signed-windows-host'),
        architecture: 'x64',
        publisherThumbprint,
      }),
    ).toEqual({
      schemaVersion: 1,
      protocolVersion: 1,
      hostVersion: '0.1.0',
      platform: 'windows',
      architecture: 'x64',
      executableFileName: 'SparkComputerHost.exe',
      sha256: '6ce03e0af490061c422eaa509d8f1dfd867b2eb44185a04fa4c0e263f0b82305',
      signingPublisherThumbprint: 'd'.repeat(64),
    })
  })

  it('creates hash-bound local manifests when no publisher certificate is available', () => {
    expect(
      createLocalNativeHostManifest({
        executable: Buffer.from('local-macos-host'),
        architecture: 'arm64',
      }),
    ).toMatchObject({ trustMode: 'local', platform: 'macos', architecture: 'arm64' })
    expect(
      createLocalWindowsNativeHostManifest({
        executable: Buffer.from('local-windows-host'),
        architecture: 'x64',
      }),
    ).toMatchObject({ trustMode: 'local', platform: 'windows', architecture: 'x64' })
  })

  it('forces local macOS Host trust when signing discovery is disabled', () => {
    expect(resolveMacNativeHostTrustMode).toBeTypeOf('function')
    expect(
      resolveMacNativeHostTrustMode({
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        CSC_NAME: 'Developer ID Application: Example (ABCDE12345)',
      }),
    ).toBe('local')
  })

  it('uses local Windows Host trust unless outer-package signing credentials are complete', () => {
    expect(resolveWindowsNativeHostTrustMode).toBeTypeOf('function')
    expect(
      resolveWindowsNativeHostTrustMode({
        SPARK_WINDOWS_PUBLISHER_THUMBPRINT: 'd'.repeat(64),
      }),
    ).toBe('local')
    expect(
      resolveWindowsNativeHostTrustMode({
        SPARK_NATIVE_HOST_TRUST_MODE: 'signed',
        SPARK_WINDOWS_PUBLISHER_THUMBPRINT: 'd'.repeat(64),
      }),
    ).toBe('signed')
  })

  it('clears all Native Host publisher metadata before an unsigned Windows retry', () => {
    const retryScript = readFileSync(
      join(__dirname, '../../../../scripts/build-win-release.sh'),
      'utf8',
    )
    const retryBody = retryScript.slice(
      retryScript.indexOf('retry_windows_package_without_signing()'),
      retryScript.indexOf('step "0/5 Build parameters"'),
    )

    expect(retryBody).toContain('SPARK_WINDOWS_PUBLISHER_THUMBPRINT')
    expect(retryBody).toContain('SPARK_NATIVE_HOST_TRUST_MODE="local"')
  })

  it('derives the signed Windows publisher fingerprint from the actual PFX', () => {
    const releaseScript = readFileSync(
      join(__dirname, '../../../../scripts/build-win-release.sh'),
      'utf8',
    )
    const prepareIndex = releaseScript.lastIndexOf('\nprepare_windows_signing\n')
    const deriveIndex = releaseScript.lastIndexOf('\nderive_windows_publisher_thumbprint\n')

    expect(releaseScript).toContain('ComputeHash($certificate.RawData)')
    expect(prepareIndex).toBeGreaterThan(-1)
    expect(deriveIndex).toBeGreaterThan(prepareIndex)
  })

  it('uses the electron-builder 26 signIf API for the Windows Native Host', async () => {
    const signIf = vi.fn(async () => true)

    await expect(
      signWindowsNativeHost({ signIf }, 'C:\\SparkComputerHost.exe'),
    ).resolves.toBeUndefined()
    expect(signIf).toHaveBeenCalledWith('C:\\SparkComputerHost.exe')
  })

  it('fails closed when electron-builder skips Windows Native Host signing', async () => {
    await expect(
      signWindowsNativeHost({ signIf: async () => false }, 'C:\\SparkComputerHost.exe'),
    ).rejects.toThrow('electron-builder did not sign the Windows Native Host executable')
  })

  it('passes the Windows Authenticode path through the PowerShell environment', async () => {
    const runCommand = vi.fn(async () => ({
      stdout: `${Buffer.alloc(32, 0xdd).toString('base64')}\n1\n`,
      stderr: '',
    }))

    await expect(
      inspectWindowsAuthenticode('D:\\SparkComputerHost.exe', {
        environment: { SystemRoot: 'C:\\Windows' },
        runCommand,
      }),
    ).resolves.toEqual({ publisherThumbprint: 'dd'.repeat(32), timestamped: true })
    expect(runCommand).toHaveBeenCalledWith(
      expect.stringMatching(/WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/),
      expect.arrayContaining(['-Command', expect.stringContaining('$env:SPARK_AUTHENTICODE_PATH')]),
      expect.objectContaining({
        env: expect.objectContaining({
          SPARK_AUTHENTICODE_PATH: 'D:\\SparkComputerHost.exe',
        }),
      }),
    )
    expect(runCommand.mock.calls[0]?.[1]).not.toContain('D:\\SparkComputerHost.exe')
  })

  it('publishes only supported desktop runner and architecture pairs', () => {
    const workflow = readFileSync(
      join(__dirname, '../../../../../../.github/workflows/publish-desktop-release.yml'),
      'utf8',
    )

    expect(workflow).toContain('"os":"macos-26-intel","name":"mac-x64"')
    expect(workflow).toContain('"os":"windows-2022","name":"win-x64"')
    expect(workflow).not.toContain('win-arm64')
    expect(workflow).not.toContain('SPARK_WINDOWS_PUBLISHER_THUMBPRINT: ${{ secrets.')
  })

  it('verifies the final SparkWork.exe and packaged host share the timestamped publisher', async () => {
    const windowsRoot = mkdtempSync(join(tmpdir(), 'spark-windows-after-sign-'))
    const hostDirectory = join(windowsRoot, 'resources', 'native-host', 'windows-x64')
    mkdirSync(hostDirectory, { recursive: true })
    const appExecutable = join(windowsRoot, 'SparkWork.exe')
    const hostExecutable = join(hostDirectory, 'SparkComputerHost.exe')
    const nodeExecutable = join(windowsRoot, 'resources', 'runtime', 'node', 'node.exe')
    const hostBytes = Buffer.from('signed-host')
    writeFileSync(appExecutable, 'signed-app')
    writeFileSync(hostExecutable, hostBytes)
    mkdirSync(join(windowsRoot, 'resources', 'runtime', 'node'), { recursive: true })
    writeFileSync(nodeExecutable, 'signed-node')
    writeFileSync(
      join(hostDirectory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        protocolVersion: 1,
        platform: 'windows',
        architecture: 'x64',
        executableFileName: 'SparkComputerHost.exe',
        sha256: '62a23a30cea7e12173df48fdeaf6a4427df900374fe788bf9be6ac180baadacc',
        signingPublisherThumbprint: 'd'.repeat(64),
      }),
    )
    const inspect = async () => ({ publisherThumbprint: 'd'.repeat(64), timestamped: true })

    try {
      await expect(
        verifyWindowsPackageSigners(
          {
            electronPlatformName: 'win32',
            arch: Arch.x64,
            appOutDir: windowsRoot,
            packager: { platformSpecificBuildOptions: { executableName: 'SparkWork' } },
          },
          { expectedPublisherThumbprint: 'd'.repeat(64), inspect },
        ),
      ).resolves.toBeUndefined()
    } finally {
      rmSync(windowsRoot, { recursive: true, force: true })
    }
  })
})

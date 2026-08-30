import type { NativeHostCapabilityManifest } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import type { VerifiedNativeHostArtifact } from './NativeHostArtifact.js'
import { createDefaultComputerUseBackend } from './NativeHostBackendFactory.js'
import type { NativeHostConnection } from './NativeHostComputerUseBackend.js'

describe('createDefaultComputerUseBackend', () => {
  it('resolves the architecture-specific packaged artifact and verifies it before connecting', async () => {
    const verifyArtifact = vi.fn(async () => ARTIFACT)
    const connectClient = vi.fn(async () => CONNECTION)
    const inspectAppCodeSignature = vi.fn(async () => ({
      identifier: 'com.spark-agent.desktop',
      teamIdentifier: 'ABCDE12345',
    }))
    const backend = createDefaultComputerUseBackend({
      resourcesPath: '/Applications/SparkWork.app/Contents/Resources',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      verifyArtifact,
      readArtifactTrustMode: async () => 'signed',
      connectClient,
      appExecutablePath: '/Applications/SparkWork.app/Contents/MacOS/Spark Agent',
      inspectAppCodeSignature,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({
      available: true,
      nativeHost: MANIFEST,
    })
    expect(verifyArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath:
          '/Applications/SparkWork.app/Contents/Helpers/SparkComputerHost',
        manifestPath:
          '/Applications/SparkWork.app/Contents/Resources/native-host/macos-arm64/manifest.json',
        platform: 'macos',
        architecture: 'arm64',
        expectedTeamIdentifier: 'ABCDE12345',
      }),
    )
    expect(inspectAppCodeSignature).toHaveBeenCalledWith(
      '/Applications/SparkWork.app/Contents/MacOS/Spark Agent',
    )
    expect(connectClient).toHaveBeenCalledWith(ARTIFACT)
  })

  it('keeps unsupported platforms and CPU architectures on the fail-closed backend', async () => {
    const verifyArtifact = vi.fn(async () => ARTIFACT)
    const backend = createDefaultComputerUseBackend({
      resourcesPath: '/resources',
      platform: 'darwin',
      architecture: 'riscv64',
      verifyArtifact,
      connectClient: async () => CONNECTION,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({
      available: false,
      nativeHost: null,
      unavailableReason: 'trusted_native_host_missing',
    })
    expect(verifyArtifact).not.toHaveBeenCalled()
  })

  it('connects a declared local-trust artifact without inspecting an application signature', async () => {
    const localArtifact = { ...ARTIFACT, trustMode: 'local' as const }
    const verifyLocalArtifact = vi.fn(async () => localArtifact)
    const inspectAppCodeSignature = vi.fn()
    const connectClient = vi.fn(async () => CONNECTION)
    const backend = createDefaultComputerUseBackend({
      resourcesPath: '/workspace/resources',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: false,
      readArtifactTrustMode: async () => 'local',
      verifyLocalArtifact,
      inspectAppCodeSignature,
      connectClient,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({ available: true })
    expect(verifyLocalArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'macos', architecture: 'arm64' }),
    )
    expect(inspectAppCodeSignature).not.toHaveBeenCalled()
    expect(connectClient).toHaveBeenCalledWith(localArtifact)
  })

  it('rejects a replacement local manifest when the packaged macOS app has a publisher identity', async () => {
    const verifyLocalArtifact = vi.fn(async () => ({ ...ARTIFACT, trustMode: 'local' as const }))
    const inspectAppCodeSignature = vi.fn(async () => ({
      identifier: 'com.spark-agent.desktop',
      teamIdentifier: 'ABCDE12345',
    }))
    const backend = createDefaultComputerUseBackend({
      resourcesPath: '/Applications/SparkWork.app/Contents/Resources',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      readArtifactTrustMode: async () => 'local',
      verifyLocalArtifact,
      inspectAppCodeSignature,
      connectClient: async () => CONNECTION,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({ available: false })
    expect(inspectAppCodeSignature).toHaveBeenCalledOnce()
    expect(verifyLocalArtifact).not.toHaveBeenCalled()
  })

  it('accepts local trust for an unsigned packaged macOS app', async () => {
    const localArtifact = { ...ARTIFACT, trustMode: 'local' as const }
    const verifyLocalArtifact = vi.fn(async () => localArtifact)
    const inspectAppCodeSignature = vi.fn(async () => {
      throw new Error('code object is not signed at all')
    })
    const backend = createDefaultComputerUseBackend({
      resourcesPath: '/Applications/SparkWork.app/Contents/Resources',
      platform: 'darwin',
      architecture: 'arm64',
      packaged: true,
      readArtifactTrustMode: async () => 'local',
      verifyLocalArtifact,
      inspectAppCodeSignature,
      connectClient: async () => CONNECTION,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({ available: true })
    expect(inspectAppCodeSignature).toHaveBeenCalledOnce()
    expect(verifyLocalArtifact).toHaveBeenCalledOnce()
  })

  it.each(['x64', 'arm64'] as const)(
    'selects and verifies the signed Windows %s native host',
    async (architecture) => {
      const verifyArtifact = vi.fn(async () => ARTIFACT)
      const connectClient = vi.fn(async () => CONNECTION)
      const inspectWindowsCodeSignature = vi.fn(async () => ({
        publisherThumbprint: 'd'.repeat(64),
      }))
      const backend = createDefaultComputerUseBackend({
        resourcesPath: 'C:\\Program Files\\SparkWork\\resources',
        platform: 'win32',
        architecture,
        packaged: true,
        verifyWindowsArtifact: verifyArtifact,
        readArtifactTrustMode: async () => 'signed',
        connectClient,
        appExecutablePath: 'C:\\Program Files\\SparkWork\\SparkWork.exe',
        inspectWindowsCodeSignature,
      })

      await expect(backend.getCapabilities()).resolves.toMatchObject({ available: true })
      expect(inspectWindowsCodeSignature).toHaveBeenCalledWith(
        'C:\\Program Files\\SparkWork\\SparkWork.exe',
      )
      expect(verifyArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          executablePath: expect.stringContaining(
            `native-host/windows-${architecture}/SparkComputerHost.exe`,
          ),
          manifestPath: expect.stringContaining(
            `native-host/windows-${architecture}/manifest.json`,
          ),
          platform: 'windows',
          architecture,
          expectedPublisherThumbprint: 'd'.repeat(64),
        }),
      )
      expect(connectClient).toHaveBeenCalledWith(ARTIFACT)
    },
  )

  it('rejects a replacement local manifest when the packaged Windows app is signed', async () => {
    const verifyLocalArtifact = vi.fn(async () => ({ ...ARTIFACT, trustMode: 'local' as const }))
    const inspectWindowsCodeSignature = vi.fn(async () => ({
      publisherThumbprint: 'd'.repeat(64),
    }))
    const backend = createDefaultComputerUseBackend({
      resourcesPath: 'C:\\Program Files\\SparkWork\\resources',
      platform: 'win32',
      architecture: 'x64',
      packaged: true,
      readArtifactTrustMode: async () => 'local',
      verifyLocalArtifact,
      inspectWindowsCodeSignature,
      connectClient: async () => CONNECTION,
    })

    await expect(backend.getCapabilities()).resolves.toMatchObject({ available: false })
    expect(inspectWindowsCodeSignature).toHaveBeenCalledOnce()
    expect(verifyLocalArtifact).not.toHaveBeenCalled()
  })
})

const MANIFEST: NativeHostCapabilityManifest = {
  protocolVersion: 1,
  hostVersion: '0.1.0',
  platform: 'macos',
  architecture: 'arm64',
  backends: {
    screen: 'screen_capture_kit',
    accessibility: 'unavailable',
    input: 'unavailable',
  },
  features: {
    listWindows: true,
    captureWindow: true,
    fullTree: false,
    diffTree: false,
    semanticActions: false,
    absolutePointer: false,
    keyboard: false,
    clipboard: false,
  },
  permissions: {
    screen: 'granted',
    accessibility: 'not_determined',
    input: 'unsupported',
  },
  limits: {
    maxMessageBytes: 67_108_864,
    maxScreenshotWidth: 16_384,
    maxScreenshotHeight: 16_384,
    maxTreeElements: 100_000,
  },
}

const ARTIFACT: VerifiedNativeHostArtifact = {
  executablePath: '/resources/native-host/macos-arm64/SparkComputerHost',
  manifestPath: '/resources/native-host/macos-arm64/manifest.json',
  manifest: {
    schemaVersion: 1,
    protocolVersion: 1,
    hostVersion: '0.1.0',
    platform: 'macos',
    architecture: 'arm64',
    executableFileName: 'SparkComputerHost',
    sha256: 'a'.repeat(64),
    signingIdentifier: 'com.spark-agent.desktop.computer-host',
    signingTeamIdentifier: 'ABCDE12345',
  },
}

const CONNECTION: NativeHostConnection = {
  getCapabilities: async () => MANIFEST,
  requestPermissions: async () => MANIFEST,
  listWindows: async () => [],
  captureWindow: async () => ({
    snapshotId: 'snapshot-1',
    width: 1,
    height: 1,
    payload: { kind: 'image_png', byteLength: 3, sha256: 'a'.repeat(64) },
    bytes: Buffer.from('png'),
  }),
  observe: async () => {
    throw new Error('not implemented by this snapshot-only fixture')
  },
  executeAction: async () => {
    throw new Error('not implemented by this snapshot-only fixture')
  },
  cancelSession: async () => undefined,
  close: async () => undefined,
}

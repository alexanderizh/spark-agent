import { join } from 'node:path'
import type { NativeHostPlatform } from '@spark/protocol'
import { UnavailableComputerUseBackend, currentNativeHostPlatform } from './ComputerUseBackend.js'
import {
  verifyNativeHostArtifact,
  verifyWindowsNativeHostArtifact,
  inspectMacCodeSignature,
  inspectWindowsCodeSignature,
  type NativeHostCodeSignature,
  type WindowsNativeHostCodeSignature,
  type VerifiedNativeHostArtifact,
} from './NativeHostArtifact.js'
import { NativeHostClient } from './NativeHostClient.js'
import {
  NativeHostComputerUseBackend,
  type NativeHostConnection,
  type NativeObservationEvidenceSink,
} from './NativeHostComputerUseBackend.js'

export type DefaultComputerUseBackend = UnavailableComputerUseBackend | NativeHostComputerUseBackend

export function createDefaultComputerUseBackend(
  options: {
    resourcesPath?: string
    platform?: NodeJS.Platform
    architecture?: string
    verifyArtifact?: typeof verifyNativeHostArtifact
    verifyWindowsArtifact?: typeof verifyWindowsNativeHostArtifact
    connectClient?: (artifact: VerifiedNativeHostArtifact) => Promise<NativeHostConnection>
    appExecutablePath?: string
    inspectAppCodeSignature?: (executablePath: string) => Promise<NativeHostCodeSignature>
    inspectWindowsCodeSignature?: (
      executablePath: string,
    ) => Promise<WindowsNativeHostCodeSignature>
    evidenceSink?: NativeObservationEvidenceSink
  } = {},
): DefaultComputerUseBackend {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    return new UnavailableComputerUseBackend()
  }

  const nativeArchitecture: 'x64' | 'arm64' = architecture
  const nativePlatform: NativeHostPlatform = platform === 'darwin' ? 'macos' : 'windows'
  const root =
    options.resourcesPath ??
    (typeof process.resourcesPath === 'string' ? process.resourcesPath : process.cwd())
  const artifactDirectory = join(root, 'native-host', `${nativePlatform}-${nativeArchitecture}`)
  const verifyArtifact = options.verifyArtifact ?? verifyNativeHostArtifact
  const verifyWindowsArtifact = options.verifyWindowsArtifact ?? verifyWindowsNativeHostArtifact
  const appExecutablePath = options.appExecutablePath ?? process.execPath
  const inspectAppCodeSignature = options.inspectAppCodeSignature ?? inspectMacCodeSignature
  const inspectWindowsAppCodeSignature =
    options.inspectWindowsCodeSignature ?? inspectWindowsCodeSignature
  const connectClient =
    options.connectClient ??
    ((artifact: VerifiedNativeHostArtifact) => NativeHostClient.connect({ artifact }))

  return new NativeHostComputerUseBackend({
    platform: nativePlatform,
    ...(options.evidenceSink == null ? {} : { evidenceSink: options.evidenceSink }),
    connect: async () => {
      const artifact =
        nativePlatform === 'macos'
          ? await verifyMacArtifact()
          : await verifyWindowsArtifact({
              executablePath: join(artifactDirectory, 'SparkComputerHost.exe'),
              manifestPath: join(artifactDirectory, 'manifest.json'),
              platform: 'windows',
              architecture: nativeArchitecture,
              expectedPublisherThumbprint: (await inspectWindowsAppCodeSignature(appExecutablePath))
                .publisherThumbprint,
            })
      return connectClient(artifact)
    },
  })

  async function verifyMacArtifact(): Promise<VerifiedNativeHostArtifact> {
    const appSignature = await inspectAppCodeSignature(appExecutablePath)
    return verifyArtifact({
      executablePath: join(artifactDirectory, 'SparkComputerHost'),
      manifestPath: join(artifactDirectory, 'manifest.json'),
      platform: 'macos',
      architecture: nativeArchitecture,
      expectedTeamIdentifier: appSignature.teamIdentifier,
    })
  }
}

export function defaultNativeHostPlatform(platform = process.platform): NativeHostPlatform {
  return currentNativeHostPlatform(platform)
}

import { join } from 'node:path'
import type { NativeHostPlatform } from '@spark/protocol'
import { UnavailableComputerUseBackend, currentNativeHostPlatform } from './ComputerUseBackend.js'
import {
  verifyNativeHostArtifact,
  verifyWindowsNativeHostArtifact,
  verifyLocalNativeHostArtifact,
  readNativeHostArtifactTrustMode,
  inspectMacCodeSignature,
  inspectWindowsCodeSignature,
  NativeHostArtifactError,
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
import { isHostSupervisorEnabled } from './computerUseV2Flags.js'
import type { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'
import { computerUseV2RolloutController } from './ComputerUseV2RolloutController.js'

export type DefaultComputerUseBackend = UnavailableComputerUseBackend | NativeHostComputerUseBackend

export function createDefaultComputerUseBackend(
  options: {
    resourcesPath?: string
    platform?: NodeJS.Platform
    architecture?: string
    packaged?: boolean
    verifyArtifact?: typeof verifyNativeHostArtifact
    verifyWindowsArtifact?: typeof verifyWindowsNativeHostArtifact
    verifyLocalArtifact?: typeof verifyLocalNativeHostArtifact
    readArtifactTrustMode?: typeof readNativeHostArtifactTrustMode
    connectClient?: (artifact: VerifiedNativeHostArtifact) => Promise<NativeHostConnection>
    appExecutablePath?: string
    inspectAppCodeSignature?: (executablePath: string) => Promise<NativeHostCodeSignature>
    inspectWindowsCodeSignature?: (
      executablePath: string,
    ) => Promise<WindowsNativeHostCodeSignature>
    evidenceSink?: NativeObservationEvidenceSink
    /** Override the V2 host-supervisor flag (tests). Production reads the env. */
    hostSupervisorEnabled?: boolean
    metrics?: ComputerUseMetricsCollector
    appVersion?: string
  } = {},
): DefaultComputerUseBackend {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  const packaged = options.packaged ?? false
  if (
    (platform !== 'darwin' && platform !== 'win32') ||
    (architecture !== 'arm64' && architecture !== 'x64')
  ) {
    return new UnavailableComputerUseBackend()
  }

  const nativeArchitecture: 'x64' | 'arm64' = architecture
  const nativePlatform: 'macos' | 'windows' = platform === 'darwin' ? 'macos' : 'windows'
  const root =
    options.resourcesPath ??
    (typeof process.resourcesPath === 'string' ? process.resourcesPath : process.cwd())
  const artifactDirectory = join(root, 'native-host', `${nativePlatform}-${nativeArchitecture}`)
  const executablePath =
    nativePlatform === 'macos' && packaged
      ? join(root, '..', 'Helpers', 'SparkComputerHost')
      : join(
          artifactDirectory,
          nativePlatform === 'macos' ? 'SparkComputerHost' : 'SparkComputerHost.exe',
        )
  const manifestPath = join(artifactDirectory, 'manifest.json')
  const verifyArtifact = options.verifyArtifact ?? verifyNativeHostArtifact
  const verifyWindowsArtifact = options.verifyWindowsArtifact ?? verifyWindowsNativeHostArtifact
  const verifyLocalArtifact = options.verifyLocalArtifact ?? verifyLocalNativeHostArtifact
  const readArtifactTrustMode = options.readArtifactTrustMode ?? readNativeHostArtifactTrustMode
  const appExecutablePath = options.appExecutablePath ?? process.execPath
  const inspectAppCodeSignature = options.inspectAppCodeSignature ?? inspectMacCodeSignature
  const inspectWindowsAppCodeSignature =
    options.inspectWindowsCodeSignature ?? inspectWindowsCodeSignature
  const connectClient =
    options.connectClient ??
    ((artifact: VerifiedNativeHostArtifact) => NativeHostClient.connect({ artifact }))
  let activeTrustMode = 'unknown'
  let activeHostVersion = 'unknown'

  return new NativeHostComputerUseBackend({
    platform: nativePlatform,
    ...(options.evidenceSink == null ? {} : { evidenceSink: options.evidenceSink }),
    enableHostSupervisor: options.hostSupervisorEnabled ?? isHostSupervisorEnabled(),
    ...(options.metrics == null ? {} : { metrics: options.metrics }),
    metricDimensions: () => ({
      platform: nativePlatform,
      architecture: nativeArchitecture,
      appVersion: options.appVersion ?? 'unknown',
      hostVersion: activeHostVersion,
      trustMode: activeTrustMode,
    }),
    connect: async () => {
      let artifact: VerifiedNativeHostArtifact
      try {
        const trustMode = await readArtifactTrustMode(manifestPath)
        activeTrustMode = trustMode
        artifact =
          trustMode === 'local'
            ? await verifyLocalArtifactAfterAppTrustCheck()
            : nativePlatform === 'macos'
              ? await verifyMacArtifact()
              : await verifyWindowsArtifact({
                  executablePath,
                  manifestPath,
                  platform: 'windows',
                  architecture: nativeArchitecture,
                  expectedPublisherThumbprint: (
                    await inspectWindowsAppCodeSignature(appExecutablePath)
                  ).publisherThumbprint,
                })
        computerUseV2RolloutController.recordInstalledArtifactCheck(false)
      } catch (error) {
        if (error instanceof NativeHostArtifactError) {
          computerUseV2RolloutController.recordInstalledArtifactCheck(true)
        }
        throw error
      }
      activeHostVersion = artifact.manifest.hostVersion
      return connectClient(artifact)

      async function verifyLocalArtifactAfterAppTrustCheck(): Promise<VerifiedNativeHostArtifact> {
        if (packaged) {
          const signedApplication = await hasApplicationPublisherIdentity()
          if (signedApplication) {
            throw new NativeHostArtifactError(
              'native_host_untrusted',
              'A signed SparkWork application cannot load a local-trust Native Host artifact',
            )
          }
        }
        return verifyLocalArtifact({
          executablePath,
          manifestPath,
          platform: nativePlatform,
          architecture: nativeArchitecture,
        })
      }

      async function hasApplicationPublisherIdentity(): Promise<boolean> {
        try {
          if (nativePlatform === 'macos') {
            await inspectAppCodeSignature(appExecutablePath)
          } else {
            await inspectWindowsAppCodeSignature(appExecutablePath)
          }
          return true
        } catch {
          return false
        }
      }
    },
  })

  async function verifyMacArtifact(): Promise<VerifiedNativeHostArtifact> {
    const appSignature = await inspectAppCodeSignature(appExecutablePath)
    return verifyArtifact({
      executablePath,
      manifestPath,
      platform: 'macos',
      architecture: nativeArchitecture,
      expectedTeamIdentifier: appSignature.teamIdentifier,
    })
  }
}

export function defaultNativeHostPlatform(platform = process.platform): NativeHostPlatform {
  return currentNativeHostPlatform(platform)
}

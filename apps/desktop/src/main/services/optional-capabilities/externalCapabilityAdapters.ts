import type {
  OptionalCapabilityErrorCode,
  OptionalCapabilityId,
  OptionalCapabilityPhase,
} from '@spark/protocol'
import type { SparkInstallManifest } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'
import {
  checkCodexRuntimeIntegrity,
  configureCodexRuntimeEnvironment,
  installCodexRuntime,
  selectCodexArtifact,
} from '../CodexRuntimeIntegrityService.js'
import { codexTargetTriple } from '../../../../../../packages/agent-runtime/src/sdk/codex-runtime.js'
import {
  detectFfmpegIntegrity,
  installFfmpegFromSparkManifest,
  selectFfmpegArtifact,
} from '../FfmpegIntegrityService.js'
import { detectIntegrity as detectPlaywrightIntegrity, installBrowser } from '../PlaywrightIntegrityService.js'
import {
  checkVoiceIntegrity,
  installVoicePack,
  selectVoiceModelArtifact,
  selectVoiceNativeArtifact,
} from '../VoiceIntegrityService.js'
import type {
  SupportedDesktopArch,
  SupportedDesktopPlatform,
} from './definitions.js'

export interface ExternalCapabilityContext {
  manifest: SparkInstallManifest
  platform: SupportedDesktopPlatform
  arch: SupportedDesktopArch
  signal: AbortSignal
}

export type ExternalCapabilityId = Exclude<OptionalCapabilityId, 'office-viewer' | 'local-depth'>

export interface ExternalCapabilityDescription {
  state: OptionalCapabilityPhase
  installedVersion: string | null
  targetVersion: string | null
  downloadSize: number
  installedSize: number | null
  error?: string
  errorCode?: OptionalCapabilityErrorCode
  retryable?: boolean
}

export interface ExternalCapabilityProgressReporter {
  (
    phase: OptionalCapabilityPhase,
    downloaded: number,
    total: number,
    message: string,
    version?: string,
  ): void
}

export interface ExternalCapabilityInstallResult {
  success: boolean
  message: string
  errorCode?: OptionalCapabilityErrorCode
  retryable?: boolean
}

export interface ExternalCapabilityAdapter {
  describe(context: ExternalCapabilityContext): Promise<ExternalCapabilityDescription>
  install(
    context: ExternalCapabilityContext,
    report: ExternalCapabilityProgressReporter,
  ): Promise<ExternalCapabilityInstallResult>
}

const CHROMIUM_ESTIMATED_DOWNLOAD_SIZE = 150 * 1024 * 1024

const adapters: Record<ExternalCapabilityId, ExternalCapabilityAdapter> = {
  'codex-runtime': {
    async describe({ manifest, platform, arch }) {
      configureCodexRuntimeEnvironment()
      const sdkVersion = process.env.SPARK_CODEX_SDK_VERSION ?? null
      const targetTriple = codexTargetTriple()
      const runtime = await checkCodexRuntimeIntegrity(false, sdkVersion)
      const artifact = targetTriple
        ? selectCodexArtifact(manifest.artifacts, targetTriple, sdkVersion, platform, arch)
        : undefined
      const targetVersion = artifact?.version ?? runtime.installedVersion
      const state = runtime.installed
        ? runtime.installedVersion != null &&
            runtime.installedVersion !== 'bundled' &&
            artifact &&
            isVersionNewer(artifact.version, runtime.installedVersion)
          ? 'update_available'
          : 'ready'
        : artifact
          ? 'missing'
          : 'error'
      return {
        state,
        installedVersion: runtime.installedVersion,
        targetVersion,
        downloadSize: artifact?.size ?? 0,
        installedSize: null,
        ...(runtime.error
          ? { error: runtime.error, errorCode: 'internal_error' as const, retryable: true }
          : {}),
        ...(state === 'error' && !runtime.error
          ? {
              error: `当前平台暂无与 Codex SDK 匹配的运行环境 (${targetTriple ?? 'unsupported'})`,
              errorCode: 'artifact_unavailable' as const,
              retryable: false,
            }
          : {}),
      }
    },
    async install({ signal }, report) {
      throwIfAborted(signal)
      const result = await installCodexRuntime(process.env.SPARK_CODEX_SDK_VERSION ?? null, (progress) => {
        report(
          mapSdkPhase(progress.state),
          progress.downloaded,
          progress.total,
          progress.message,
          progress.version,
        )
      })
      return {
        success: result.success,
        message: result.message,
        ...(result.success
          ? {}
          : { errorCode: 'download_failed' as const, retryable: true }),
      }
    },
  },
  ffmpeg: {
    async describe({ manifest, platform, arch }) {
      const state = await detectFfmpegIntegrity()
      const artifact = selectFfmpegArtifact(manifest.artifacts, platform, arch)
      const installedVersion = state.ffmpegVersion
      const targetVersion = artifact?.version ?? installedVersion
      const updateAvailable =
        state.ffmpegSource === 'managed' &&
        installedVersion != null &&
        artifact != null &&
        isVersionNewer(artifact.version, installedVersion)
      return {
        state: updateAvailable
          ? 'update_available'
          : state.ffmpegReady && state.ffprobeReady
            ? 'ready'
            : artifact
              ? 'missing'
              : 'error',
        installedVersion,
        targetVersion,
        downloadSize: artifact?.size ?? 0,
        installedSize: null,
        ...(state.lastError
          ? { error: state.lastError, errorCode: 'internal_error' as const, retryable: true }
          : {}),
        ...(!artifact && !state.ffmpegReady
          ? {
              error: `当前平台暂无可用的 FFmpeg 安装包 (${platform}-${arch})`,
              errorCode: 'artifact_unavailable' as const,
              retryable: false,
            }
          : {}),
      }
    },
    async install({ signal }, report) {
      throwIfAborted(signal)
      report('downloading', 0, 0, '正在准备下载 FFmpeg')
      const result = await installFfmpegFromSparkManifest((downloaded, total) => {
        report('downloading', downloaded, total, '正在下载 FFmpeg')
      })
      if (!result.success) {
        return { success: false, message: result.message ?? 'FFmpeg 安装失败', errorCode: 'download_failed', retryable: true }
      }
      report('verifying', 0, 0, '正在校验 FFmpeg')
      return { success: true, message: result.message ?? 'FFmpeg 安装成功' }
    },
  },
  chromium: {
    async describe() {
      const state = detectPlaywrightIntegrity()
      return {
        state: state.browserReady ? 'ready' : 'missing',
        installedVersion: state.browserReady ? 'chromium' : null,
        targetVersion: state.browserReady ? 'chromium' : 'chromium',
        downloadSize: state.browserReady ? 0 : CHROMIUM_ESTIMATED_DOWNLOAD_SIZE,
        installedSize: null,
        ...(state.lastError
          ? { error: state.lastError, errorCode: 'internal_error' as const, retryable: true }
          : {}),
      }
    },
    async install({ signal }, report) {
      throwIfAborted(signal)
      report('downloading', 0, CHROMIUM_ESTIMATED_DOWNLOAD_SIZE, '正在下载 Chromium')
      const result = await installBrowser((line) => {
        const percent = parsePercent(line)
        report(
          percent == null ? 'downloading' : 'downloading',
          percent == null ? 0 : Math.round((CHROMIUM_ESTIMATED_DOWNLOAD_SIZE * percent) / 100),
          CHROMIUM_ESTIMATED_DOWNLOAD_SIZE,
          '正在下载 Chromium',
        )
      })
      if (!result.success) {
        return { success: false, message: result.message, errorCode: 'download_failed', retryable: true }
      }
      report('ready', CHROMIUM_ESTIMATED_DOWNLOAD_SIZE, CHROMIUM_ESTIMATED_DOWNLOAD_SIZE, result.message)
      return { success: true, message: result.message }
    },
  },
  'voice-pack': {
    async describe({ manifest, platform, arch }) {
      const state = await checkVoiceIntegrity(false)
      const native = selectVoiceNativeArtifact(manifest.artifacts, platform, arch)
      const model = selectVoiceModelArtifact(manifest.artifacts)
      const installedVersion = joinVersions(
        state.components.find((item) => item.component === 'native')?.installedVersion,
        state.components.find((item) => item.component === 'model')?.installedVersion,
      )
      const targetVersion = joinVersions(native?.version, model?.version)
      const ready = state.ready
      const updateAvailable = ready && targetVersion != null && targetVersion !== installedVersion
      return {
        state: updateAvailable ? 'update_available' : ready ? 'ready' : native && model ? 'missing' : 'error',
        installedVersion,
        targetVersion,
        downloadSize: (native?.size ?? 0) + (model?.size ?? 0),
        installedSize: null,
        ...(state.lastError
          ? { error: state.lastError, errorCode: 'internal_error' as const, retryable: true }
          : {}),
        ...(!native || !model
          ? {
              error: `当前平台暂无完整的语音输入资源 (${platform}-${arch})`,
              errorCode: 'artifact_unavailable' as const,
              retryable: false,
            }
          : {}),
      }
    },
    async install({ signal }, report) {
      throwIfAborted(signal)
      const result = await installVoicePack(false, (progress) => {
        const phase = mapVoicePhase(progress.state)
        report(phase, progress.downloaded, progress.total, progress.message, progress.version)
      })
      if (!result.success) {
        return { success: false, message: result.message, errorCode: 'download_failed', retryable: true }
      }
      return { success: true, message: result.message }
    },
  },
}

export function getExternalCapabilityAdapter(
  id: ExternalCapabilityId,
): ExternalCapabilityAdapter {
  return adapters[id]
}

export function getExternalCapabilityAdapters(): Record<ExternalCapabilityId, ExternalCapabilityAdapter> {
  return adapters
}

function mapSdkPhase(state: 'preparing' | 'downloading' | 'verifying' | 'activating' | 'done' | 'error'): OptionalCapabilityPhase {
  if (state === 'preparing' || state === 'downloading') return 'downloading'
  if (state === 'done') return 'ready'
  return state
}

function mapVoicePhase(state: 'preparing' | 'downloading' | 'verifying' | 'activating' | 'done' | 'error'): OptionalCapabilityPhase {
  if (state === 'preparing' || state === 'downloading') return 'downloading'
  if (state === 'done') return 'ready'
  return state
}

function parsePercent(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)%/)
  if (!match) return null
  const percent = Number(match[1])
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null
}

function joinVersions(...versions: Array<string | null | undefined>): string | null {
  const values = versions.filter((version): version is string => Boolean(version))
  return values.length > 0 ? values.join('+') : null
}

function isVersionNewer(latest: string, installed: string): boolean {
  if (installed === 'bundled') return false
  const left = latest.replace(/^v/, '').split(/[.+-]/).map(Number)
  const right = installed.replace(/^v/, '').split(/[.+-]/).map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('安装已取消')
}

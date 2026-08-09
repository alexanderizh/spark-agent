import type { OptionalCapabilityId } from '@spark/protocol'
import type {
  SparkInstallArtifact,
  SparkInstallManifest,
} from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'

export type SupportedDesktopPlatform = 'darwin' | 'linux' | 'win32'
export type SupportedDesktopArch = 'arm64' | 'x64'

export interface OptionalCapabilityDefinition {
  id: OptionalCapabilityId
  displayName: string
  description: string
  source: 'archive' | 'external'
  cancellable: boolean
  supportsUninstall: boolean
  selectArtifacts(
    manifest: SparkInstallManifest,
    platform: SupportedDesktopPlatform,
    arch: SupportedDesktopArch,
  ): SparkInstallArtifact[]
}

function isCompatible(
  artifact: SparkInstallArtifact,
  platform: SupportedDesktopPlatform,
  arch: SupportedDesktopArch,
): boolean {
  return (
    (artifact.platform == null || artifact.platform === 'any' || artifact.platform === platform) &&
    (artifact.arch == null || artifact.arch === 'any' || artifact.arch === arch) &&
    typeof artifact.sha256 === 'string' &&
    /^[0-9a-f]{64}$/i.test(artifact.sha256) &&
    Number.isSafeInteger(artifact.size) &&
    (artifact.size ?? 0) > 0
  )
}

function latest(artifacts: SparkInstallArtifact[]): SparkInstallArtifact | null {
  return (
    [...artifacts].sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    )[0] ?? null
  )
}

function selectByPrefix(
  manifest: SparkInstallManifest,
  prefix: string,
  type: SparkInstallArtifact['type'],
  platform: SupportedDesktopPlatform,
  arch: SupportedDesktopArch,
): SparkInstallArtifact | null {
  return latest(
    manifest.artifacts.filter(
      (artifact) =>
        artifact.type === type &&
        artifact.id.startsWith(prefix) &&
        isCompatible(artifact, platform, arch),
    ),
  )
}

export const OPTIONAL_CAPABILITY_DEFINITIONS: OptionalCapabilityDefinition[] = [
  {
    id: 'codex-runtime',
    displayName: 'Codex 本地运行环境',
    description: '为本地 Codex Agent 提供与应用内 SDK 匹配的原生运行时。',
    source: 'external',
    cancellable: false,
    supportsUninstall: false,
    selectArtifacts: () => [],
  },
  {
    id: 'office-viewer',
    displayName: '离线 Office 预览',
    description: '在本机预览 DOCX、XLSX、PPT 和 PPTX 文件所需的 Worker、WASM 与字体。',
    source: 'archive',
    cancellable: true,
    supportsUninstall: true,
    selectArtifacts(manifest, platform, arch) {
      const artifact = selectByPrefix(
        manifest,
        'archive.optional-office-viewer-',
        'archive',
        platform,
        arch,
      )
      return artifact ? [artifact] : []
    },
  },
  {
    id: 'local-depth',
    displayName: '本地深度处理',
    description: '在本机生成深度图和深度视频转换结果所需的推理 Runtime 与模型。',
    source: 'archive',
    cancellable: true,
    supportsUninstall: true,
    selectArtifacts(manifest, platform, arch) {
      const runtime = selectByPrefix(
        manifest,
        'runtime.optional-depth-',
        'runtime',
        platform,
        arch,
      )
      const model = selectByPrefix(
        manifest,
        'model.depth-anything-v2-small-int8-',
        'model',
        platform,
        arch,
      )
      return runtime && model ? [runtime, model] : []
    },
  },
  {
    id: 'ffmpeg',
    displayName: 'FFmpeg',
    description: '为视频剪辑、关键帧提取和转码提供本地 FFmpeg/ffprobe。',
    source: 'external',
    cancellable: false,
    supportsUninstall: false,
    selectArtifacts: () => [],
  },
  {
    id: 'chromium',
    displayName: 'Chromium 浏览器运行环境',
    description: '为 Playwright 网页自动化提供独立的 Chromium 浏览器。',
    source: 'external',
    cancellable: false,
    supportsUninstall: false,
    selectArtifacts: () => [],
  },
  {
    id: 'voice-pack',
    displayName: '语音输入资源',
    description: '为离线语音输入提供本地推理运行时与语音识别模型。',
    source: 'external',
    cancellable: false,
    supportsUninstall: false,
    selectArtifacts: () => [],
  },
]

export function getOptionalCapabilityDefinition(
  id: OptionalCapabilityId,
): OptionalCapabilityDefinition {
  const definition = OPTIONAL_CAPABILITY_DEFINITIONS.find((item) => item.id === id)
  if (!definition) throw new Error(`Unsupported optional capability: ${id}`)
  return definition
}

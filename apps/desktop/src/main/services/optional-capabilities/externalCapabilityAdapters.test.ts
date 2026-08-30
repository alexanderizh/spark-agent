import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  codexTargetTriple: vi.fn(() => 'aarch64-apple-darwin'),
  configureCodexRuntimeEnvironment: vi.fn(),
  checkCodexRuntimeIntegrity: vi.fn(async () => ({
    installed: true,
    installedVersion: '1.0.0',
    latestVersion: null,
    updateAvailable: false,
    latestChecked: false,
    targetTriple: 'aarch64-apple-darwin',
    artifactId: null,
  })),
  selectCodexArtifact: vi.fn(() => ({ version: '2.0.0', size: 20 })),
  detectFfmpegIntegrity: vi.fn(async () => ({
    ffmpegReady: true,
    ffmpegSource: 'managed' as const,
    ffmpegVersion: '1.0.0',
    ffprobeReady: true,
    binaryPath: '/tmp/ffmpeg',
    ffprobePath: '/tmp/ffprobe',
    lastError: null,
  })),
  selectFfmpegArtifact: vi.fn(() => ({ version: '2.0.0', size: 20 })),
  detectPlaywrightIntegrity: vi.fn(() => ({
    mcpInstalled: true,
    mcpVersion: '1.0.0',
    playwrightInstalled: true,
    browserReady: false,
    browserSource: 'none' as const,
    lastError: null,
  })),
  checkVoiceIntegrity: vi.fn(async () => ({
    ready: true,
    downloading: false,
    supported: true,
    unsupportedReason: null,
    components: [
      { component: 'native', installedVersion: '1.0.0' },
      { component: 'model', installedVersion: '1.0.0' },
    ],
    lastError: null,
  })),
  selectVoiceNativeArtifact: vi.fn(() => ({ version: '2.0.0', size: 10 })),
  selectVoiceModelArtifact: vi.fn(() => ({ version: '2.0.0', size: 10 })),
}))

vi.mock('../CodexRuntimeIntegrityService.js', () => ({
  checkCodexRuntimeIntegrity: mocks.checkCodexRuntimeIntegrity,
  configureCodexRuntimeEnvironment: mocks.configureCodexRuntimeEnvironment,
  installCodexRuntime: vi.fn(),
  selectCodexArtifact: mocks.selectCodexArtifact,
}))
vi.mock('../../../../../../packages/agent-runtime/src/sdk/codex-runtime.js', () => ({
  codexTargetTriple: mocks.codexTargetTriple,
}))
vi.mock('../FfmpegIntegrityService.js', () => ({
  detectFfmpegIntegrity: mocks.detectFfmpegIntegrity,
  installFfmpegFromSparkManifest: vi.fn(),
  selectFfmpegArtifact: mocks.selectFfmpegArtifact,
}))
vi.mock('../PlaywrightIntegrityService.js', () => ({
  detectIntegrity: mocks.detectPlaywrightIntegrity,
  installBrowser: vi.fn(),
}))
vi.mock('../VoiceIntegrityService.js', () => ({
  checkVoiceIntegrity: mocks.checkVoiceIntegrity,
  installVoicePack: vi.fn(),
  selectVoiceModelArtifact: mocks.selectVoiceModelArtifact,
  selectVoiceNativeArtifact: mocks.selectVoiceNativeArtifact,
}))

import { getExternalCapabilityAdapter } from './externalCapabilityAdapters'

const context = {
  manifest: { schemaVersion: 1, updatedAt: '2026-08-10', artifacts: [] },
  platform: 'darwin' as const,
  arch: 'arm64' as const,
  signal: new AbortController().signal,
}

describe('external capability adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the manifest version as targetVersion when a managed component has an update', async () => {
    await expect(getExternalCapabilityAdapter('codex-runtime').describe(context)).resolves.toMatchObject({
      state: 'update_available',
      installedVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    await expect(getExternalCapabilityAdapter('ffmpeg').describe(context)).resolves.toMatchObject({
      state: 'update_available',
      installedVersion: '1.0.0',
      targetVersion: '2.0.0',
    })
    await expect(getExternalCapabilityAdapter('voice-pack').describe(context)).resolves.toMatchObject({
      state: 'update_available',
      installedVersion: '1.0.0+1.0.0',
      targetVersion: '2.0.0+2.0.0',
    })
  })
})

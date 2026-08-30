import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({ userData: '' }))
const serviceMocks = vi.hoisted(() => ({
  fetchManifest: vi.fn(),
  installBinaryArchive: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMocks.userData,
  },
}))

vi.mock(
  '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js',
  () => ({
    fetchSparkInstallManifest: serviceMocks.fetchManifest,
    resolveArtifactUrl: (_manifest: unknown, artifact: { url: string }) => artifact.url,
    resolveArtifactUrlString: (_manifest: unknown, url: string) => url,
  }),
)

vi.mock(
  '../../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js',
  () => ({ installBinaryArchive: serviceMocks.installBinaryArchive }),
)

import {
  checkVoiceIntegrity,
  installVoicePack,
  voicePlatformKey,
} from '../VoiceIntegrityService.js'

let tempRoot = ''

beforeEach(() => {
  vi.clearAllMocks()
  tempRoot = mkdtempSync(join(tmpdir(), 'spark-voice-integrity-'))
  electronMocks.userData = tempRoot
  serviceMocks.fetchManifest.mockResolvedValue({
    schemaVersion: 1,
    updatedAt: '2026-07-19T00:00:00.000Z',
    artifacts: [
      {
        id: `voice.native.${process.platform}-${process.arch}`,
        type: 'voice',
        name: 'Voice native',
        version: '1.0.0',
        url: 'https://example.test/native.tar.gz',
        sha256: 'a'.repeat(64),
        size: 10,
        platform: process.platform,
        arch: process.arch,
        archive: { format: 'tar.gz' },
      },
      {
        id: 'voice.model.paraformer',
        type: 'voice',
        name: 'Voice model',
        version: '1.0.0',
        url: 'https://example.test/model.tar.gz',
        sha256: 'b'.repeat(64),
        size: 20,
        archive: { format: 'tar.gz' },
      },
    ],
  })
  serviceMocks.installBinaryArchive.mockImplementation(async (params: { destDir: string }) => {
    mkdirSync(params.destDir, { recursive: true })
    if (basename(params.destDir) === 'model') {
      writeFileSync(join(params.destDir, 'model-package.json'), '{}')
    } else {
      writeFileSync(join(params.destDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
      writeFileSync(join(params.destDir, 'index.js'), 'module.exports = {}')
    }
    return { destPath: params.destDir, fileCount: 1, entries: [] }
  })
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('VoiceIntegrityService', () => {
  function seedNativeRuntime(platformKey: string): void {
    const nativeDir = join(tempRoot, 'voice', 'native', `1.0.0-${platformKey}`)
    mkdirSync(nativeDir, { recursive: true })
    writeFileSync(join(nativeDir, 'package.json'), JSON.stringify({ main: 'index.js' }))
    writeFileSync(join(nativeDir, 'index.js'), 'module.exports = {}')
    mkdirSync(join(tempRoot, 'voice'), { recursive: true })
    writeFileSync(
      join(tempRoot, 'voice', 'voice-state.json'),
      JSON.stringify({
        native: { version: '1.0.0', platformKey, artifactId: `voice.native.${platformKey}` },
      }),
    )
  }

  it('reports an installed native runtime independently when the model is missing', async () => {
    const platformKey = voicePlatformKey()
    if (!platformKey) return
    seedNativeRuntime(platformKey)

    const status = await checkVoiceIntegrity(false)

    expect(status.ready).toBe(false)
    expect(status.components.find((item) => item.component === 'native')?.state).toBe('ready')
    expect(status.components.find((item) => item.component === 'model')?.state).toBe('missing')
  })

  it('downloads only the missing model instead of reinstalling the native runtime', async () => {
    const platformKey = voicePlatformKey()
    if (!platformKey) return
    seedNativeRuntime(platformKey)

    const result = await installVoicePack(false)

    expect(result.success).toBe(true)
    expect(serviceMocks.installBinaryArchive).toHaveBeenCalledTimes(1)
    expect(serviceMocks.installBinaryArchive.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://example.test/model.tar.gz',
    })
    expect(result.status.ready).toBe(true)
  })

  it('recovers an installed model without state and downloads only the missing native runtime', async () => {
    const platformKey = voicePlatformKey()
    if (!platformKey) return
    const modelDir = join(tempRoot, 'voice', 'model', '1.0.0')
    mkdirSync(modelDir, { recursive: true })
    writeFileSync(join(modelDir, 'model-package.json'), '{}')

    const result = await installVoicePack(false)

    expect(result.success).toBe(true)
    expect(serviceMocks.installBinaryArchive).toHaveBeenCalledTimes(1)
    expect(serviceMocks.installBinaryArchive.mock.calls[0]?.[0]).toMatchObject({
      url: 'https://example.test/native.tar.gz',
    })
    expect(result.status.ready).toBe(true)
  })
})

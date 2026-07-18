import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  userData: '',
  fetchManifest: vi.fn(),
  installArchive: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => mocks.userData) },
}))

vi.mock('@spark/shared', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}))

vi.mock('../SafeFileProtocol.js', () => ({
  toSafeFileUrl: (filePath: string) => `safe-file://test/${encodeURIComponent(filePath)}`,
}))

vi.mock('@spark/agent-runtime', () => ({
  fetchSparkInstallManifest: mocks.fetchManifest,
  findSparkInstallArtifact: (manifest: { artifacts: Array<{ id: string }> }, id: string) => {
    const artifact = manifest.artifacts.find((item) => item.id === id)
    if (artifact == null) throw new Error(`missing ${id}`)
    return artifact
  },
  installBinaryArchive: mocks.installArchive,
  resolveArtifactUrl: (_manifest: unknown, artifact: { url: string }) => artifact.url,
  resolveArtifactUrlString: (_manifest: unknown, url: string) => url,
}))

const FONT_PATHS = [
  'geist/Geist-Light.woff2',
  'geist/Geist-Regular.woff2',
  'geist/Geist-Medium.woff2',
  'geist/Geist-Bold.woff2',
  'geist-mono/GeistMono-Regular.otf',
  'geist-mono/GeistMono-Italic.otf',
  'geist-mono/GeistMono-Bold.otf',
  'geist-mono/GeistMono-BoldItalic.otf',
  'harmony-sans-sc/HarmonyOS_Sans_SC_Light.woff2',
  'harmony-sans-sc/HarmonyOS_Sans_SC_Regular.woff2',
  'harmony-sans-sc/HarmonyOS_Sans_SC_Medium.woff2',
  'harmony-sans-sc/HarmonyOS_Sans_SC_Bold.woff2',
]

describe('FontAssetService', () => {
  beforeEach(() => {
    mocks.userData = mkdtempSync(join(tmpdir(), 'spark-font-assets-'))
    mocks.fetchManifest.mockReset()
    mocks.installArchive.mockReset()
    mocks.fetchManifest.mockResolvedValue({
      schemaVersion: 1,
      updatedAt: '2026-07-18',
      artifacts: [{
        id: 'archive.desktop-fonts',
        type: 'archive',
        name: 'Spark Desktop Fonts',
        version: '1.0.0',
        url: 'https://example.test/fonts.zip',
        sha256: 'abc123',
        archive: { format: 'zip', contentRoot: 'spark-desktop-fonts-1.0.0' },
      }],
    })
    mocks.installArchive.mockImplementation(async (options: {
      destDir: string
      onProgress?: (downloaded: number, total: number) => void
    }) => {
      options.onProgress?.(50, 100)
      for (const relativePath of FONT_PATHS) {
        const target = join(options.destDir, relativePath)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, 'font')
      }
      return { destPath: options.destDir, fileCount: FONT_PATHS.length, entries: [] }
    })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(mocks.userData, { recursive: true, force: true })
  })

  it('installs a verified version atomically and preserves it when an update check fails', async () => {
    const service = await import('../FontAssetService.js')

    expect(service.getManagedFontAssetStatus().state).toBe('missing')
    const installed = await service.installManagedFontAssets({ force: true })

    expect(installed.success).toBe(true)
    expect(installed.status).toMatchObject({ state: 'ready', version: '1.0.0' })
    expect(installed.status.fonts).toHaveLength(FONT_PATHS.length)
    expect(installed.status.fonts.every((font) => font.url.startsWith('safe-file://test/'))).toBe(true)
    expect(mocks.installArchive).toHaveBeenCalledTimes(1)

    const activePath = join(mocks.userData, 'assets', 'fonts', 'active.json')
    expect(existsSync(activePath)).toBe(true)
    expect(JSON.parse(readFileSync(activePath, 'utf8'))).toMatchObject({
      artifactId: 'archive.desktop-fonts',
      version: '1.0.0',
      sha256: 'abc123',
    })

    mocks.fetchManifest.mockRejectedValueOnce(new Error('offline'))
    const failedUpgrade = await service.installManagedFontAssets({ force: true })
    expect(failedUpgrade.success).toBe(false)
    expect(failedUpgrade.status.state).toBe('ready')
    expect(failedUpgrade.status.fonts).toHaveLength(FONT_PATHS.length)
  })
})

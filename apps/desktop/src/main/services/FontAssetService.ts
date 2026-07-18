import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  fetchSparkInstallManifest,
  findSparkInstallArtifact,
  installBinaryArchive,
  resolveArtifactUrl,
  resolveArtifactUrlString,
} from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import type {
  FontAssetsInstallResponse,
  FontAssetsStatusResponse,
  ManagedFontFaceSource,
} from '@spark/protocol'
import { toSafeFileUrl } from './SafeFileProtocol.js'

const log = createLogger('font-assets')
const FONT_ARTIFACT_ID = 'archive.desktop-fonts'
const ACTIVE_FILE_NAME = 'active.json'

type FontFileDefinition = Omit<ManagedFontFaceSource, 'url'> & { relativePath: string }

const FONT_FILES: readonly FontFileDefinition[] = [
  { family: 'Geist', relativePath: 'geist/Geist-Light.woff2', format: 'woff2', weight: '300', style: 'normal' },
  { family: 'Geist', relativePath: 'geist/Geist-Regular.woff2', format: 'woff2', weight: '400', style: 'normal' },
  { family: 'Geist', relativePath: 'geist/Geist-Medium.woff2', format: 'woff2', weight: '500', style: 'normal' },
  { family: 'Geist', relativePath: 'geist/Geist-Bold.woff2', format: 'woff2', weight: '700', style: 'normal' },
  { family: 'Geist Mono', relativePath: 'geist-mono/GeistMono-Regular.otf', format: 'opentype', weight: '400', style: 'normal' },
  { family: 'Geist Mono', relativePath: 'geist-mono/GeistMono-Italic.otf', format: 'opentype', weight: '400', style: 'italic' },
  { family: 'Geist Mono', relativePath: 'geist-mono/GeistMono-Bold.otf', format: 'opentype', weight: '700', style: 'normal' },
  { family: 'Geist Mono', relativePath: 'geist-mono/GeistMono-BoldItalic.otf', format: 'opentype', weight: '700', style: 'italic' },
  { family: 'HarmonyOS Sans SC', relativePath: 'harmony-sans-sc/HarmonyOS_Sans_SC_Light.woff2', format: 'woff2', weight: '300', style: 'normal' },
  { family: 'HarmonyOS Sans SC', relativePath: 'harmony-sans-sc/HarmonyOS_Sans_SC_Regular.woff2', format: 'woff2', weight: '400', style: 'normal' },
  { family: 'HarmonyOS Sans SC', relativePath: 'harmony-sans-sc/HarmonyOS_Sans_SC_Medium.woff2', format: 'woff2', weight: '500', style: 'normal' },
  { family: 'HarmonyOS Sans SC', relativePath: 'harmony-sans-sc/HarmonyOS_Sans_SC_Bold.woff2', format: 'woff2', weight: '700', style: 'normal' },
]

interface ActiveFontInstallation {
  artifactId: string
  version: string
  directory: string
  sha256: string | null
  installedAt: string
}

type StatusListener = (status: FontAssetsStatusResponse) => void

let installInFlight: Promise<FontAssetsInstallResponse> | null = null
let lastError: string | null = null
let transientStatus: FontAssetsStatusResponse | null = null
const statusListeners = new Set<StatusListener>()

function fontsRoot(): string {
  return join(app.getPath('userData'), 'assets', 'fonts')
}

function activeFilePath(): string {
  return join(fontsRoot(), ACTIVE_FILE_NAME)
}

function isSafeDirectoryName(value: string): boolean {
  return value.length > 0 && basename(value) === value && value !== '.' && value !== '..'
}

function readActiveInstallation(): ActiveFontInstallation | null {
  try {
    const value = JSON.parse(readFileSync(activeFilePath(), 'utf8')) as Partial<ActiveFontInstallation>
    if (
      value.artifactId !== FONT_ARTIFACT_ID ||
      typeof value.version !== 'string' ||
      typeof value.directory !== 'string' ||
      !isSafeDirectoryName(value.directory)
    ) {
      return null
    }
    const root = join(fontsRoot(), value.directory)
    if (!FONT_FILES.every((file) => existsSync(join(root, file.relativePath)))) return null
    return {
      artifactId: FONT_ARTIFACT_ID,
      version: value.version,
      directory: value.directory,
      sha256: typeof value.sha256 === 'string' ? value.sha256 : null,
      installedAt: typeof value.installedAt === 'string' ? value.installedAt : '',
    }
  } catch {
    return null
  }
}

function installedFontSources(active: ActiveFontInstallation): ManagedFontFaceSource[] {
  const root = join(fontsRoot(), active.directory)
  return FONT_FILES.map(({ relativePath, ...font }) => ({
    ...font,
    url: toSafeFileUrl(join(root, relativePath)),
  }))
}

function readyStatus(active: ActiveFontInstallation): FontAssetsStatusResponse {
  return {
    state: 'ready',
    version: active.version,
    percent: 100,
    message: lastError == null ? '字体资源已就绪' : '字体可用，但最近一次更新检查失败',
    lastError,
    fonts: installedFontSources(active),
  }
}

export function getManagedFontAssetStatus(): FontAssetsStatusResponse {
  if (transientStatus?.state === 'downloading') return transientStatus
  const active = readActiveInstallation()
  if (active != null) return readyStatus(active)
  return {
    state: lastError == null ? 'missing' : 'error',
    version: null,
    percent: null,
    message: lastError == null ? '字体资源尚未下载，将使用系统字体' : '字体资源下载失败，已回退系统字体',
    lastError,
    fonts: [],
  }
}

function emitStatus(status: FontAssetsStatusResponse): void {
  transientStatus = status.state === 'downloading' ? status : null
  for (const listener of statusListeners) listener(status)
}

export function subscribeManagedFontAssetStatus(listener: StatusListener): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

function writeActiveInstallation(active: ActiveFontInstallation): void {
  const root = fontsRoot()
  const tmpPath = join(root, `${ACTIVE_FILE_NAME}.${randomUUID()}.tmp`)
  writeFileSync(tmpPath, `${JSON.stringify(active, null, 2)}\n`, 'utf8')
  renameSync(tmpPath, activeFilePath())
}

async function cleanupOldInstallations(activeDirectory: string): Promise<void> {
  let entries: string[]
  try {
    entries = readdirSync(fontsRoot())
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((entry) => entry !== ACTIVE_FILE_NAME && entry !== activeDirectory)
      .map((entry) => rm(join(fontsRoot(), entry), { recursive: true, force: true }).catch(() => undefined)),
  )
}

function downloadingStatus(percent: number | null, message: string): FontAssetsStatusResponse {
  const active = readActiveInstallation()
  return {
    state: 'downloading',
    version: active?.version ?? null,
    percent,
    message,
    lastError: null,
    fonts: active == null ? [] : installedFontSources(active),
  }
}

async function performInstall(force: boolean): Promise<FontAssetsInstallResponse> {
  const current = readActiveInstallation()
  try {
    emitStatus(downloadingStatus(0, '正在检查云端字体版本'))
    const manifest = await fetchSparkInstallManifest()
    const artifact = findSparkInstallArtifact(manifest, FONT_ARTIFACT_ID)
    if (artifact.type !== 'archive') {
      throw new Error(`字体产物类型无效: ${artifact.type}`)
    }
    if (!force && current?.version === artifact.version && current.sha256 === (artifact.sha256 ?? null)) {
      lastError = null
      const status = readyStatus(current)
      emitStatus(status)
      return { success: true, message: '字体资源已是最新版本', status }
    }

    await mkdir(fontsRoot(), { recursive: true })
    const stagingDirectory = `.staging-${randomUUID()}`
    const stagingPath = join(fontsRoot(), stagingDirectory)
    const resolvedUrl = resolveArtifactUrl(manifest, artifact)
    const fallbackUrls = artifact.fallbackUrls?.map((url) => resolveArtifactUrlString(manifest, url))
    try {
      await installBinaryArchive({
        url: resolvedUrl,
        ...(fallbackUrls?.length ? { fallbackUrls } : {}),
        ...(artifact.sha256 != null ? { sha256: artifact.sha256 } : {}),
        ...(artifact.archive?.format != null ? { format: artifact.archive.format } : {}),
        ...(artifact.archive?.contentRoot != null ? { contentRoot: artifact.archive.contentRoot } : {}),
        destDir: stagingPath,
        onProgress: (downloaded, total) => {
          const percent = total > 0 ? Math.min(99, Math.round((downloaded / total) * 100)) : null
          emitStatus(downloadingStatus(percent, percent == null ? '正在下载字体资源' : `正在下载字体资源 ${percent}%`))
        },
      })
      const missingFile = FONT_FILES.find((file) => !existsSync(join(stagingPath, file.relativePath)))
      if (missingFile != null) throw new Error(`字体归档缺少文件: ${missingFile.relativePath}`)

      const safeVersion = artifact.version.replace(/[^a-zA-Z0-9._-]/g, '-') || 'unknown'
      const directory = `${safeVersion}-${(artifact.sha256 ?? randomUUID()).slice(0, 12)}-${Date.now()}`
      renameSync(stagingPath, join(fontsRoot(), directory))
      const active: ActiveFontInstallation = {
        artifactId: FONT_ARTIFACT_ID,
        version: artifact.version,
        directory,
        sha256: artifact.sha256 ?? null,
        installedAt: new Date().toISOString(),
      }
      writeActiveInstallation(active)
      lastError = null
      const status = readyStatus(active)
      emitStatus(status)
      void cleanupOldInstallations(directory)
      return { success: true, message: `字体资源 ${artifact.version} 安装成功`, status }
    } finally {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    log.warn(`Managed font install failed: ${lastError}`)
    const active = readActiveInstallation()
    const status = active == null
      ? {
          state: 'error' as const,
          version: null,
          percent: null,
          message: '字体资源下载失败，已回退系统字体',
          lastError,
          fonts: [],
        }
      : readyStatus(active)
    emitStatus(status)
    return { success: false, message: lastError, status }
  }
}

export function installManagedFontAssets(
  options: { force?: boolean } = {},
): Promise<FontAssetsInstallResponse> {
  if (installInFlight != null) return installInFlight
  installInFlight = performInstall(options.force ?? false).finally(() => {
    installInFlight = null
  })
  return installInFlight
}

/** Background update used after the main window is available. Never throws into app startup. */
export async function updateManagedFontAssetsInBackground(): Promise<FontAssetsInstallResponse> {
  return installManagedFontAssets({ force: false })
}

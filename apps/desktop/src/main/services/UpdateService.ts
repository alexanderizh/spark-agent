/**
 * UpdateService — GitHub Release 资产更新服务
 *
 * 基于 GitHub Releases 直接实现跨平台更新：
 *   - 启动时自动检查最新 Release
 *   - 按平台选择安装包（macOS: dmg，Windows: exe）
 *   - 后台下载安装包并同步进度
 *   - 下载完成后按平台启动安装流程
 *
 * 说明：
 *   - 这套实现不依赖 electron-updater 的 zip / yml 元数据解析。
 *   - macOS 采用 dmg 安装镜像：下载完成后打开镜像并退出当前实例，由用户把新 .app 拖入替换。
 *   - Windows 采用 exe 安装器，下载完成后会启动安装器并退出当前应用。
 *   - 两端在启动安装包后都会退出当前实例（否则旧实例残留会导致安装无法进行）。
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type {
  UpdateStatus,
  UpdateInfo,
  UpdateProgressInfo,
  UpdateChannel,
} from '@spark/protocol'

const log = createLogger('update-service')

const STARTUP_CHECK_DELAY_MS = 5_000
const FOCUS_RECHECK_THRESHOLD_MS = 2 * 60 * 60 * 1000
/** macOS：启动 dmg 后延迟退出，给安装镜像挂载/弹窗留时间 */
const MAC_INSTALL_QUIT_DELAY_MS = 1_200
const RELEASE_REQUEST_USER_AGENT = 'Spark-Agent-Updater'
const DEFAULT_RELEASE_OWNER = 'alexanderizh'
const DEFAULT_RELEASE_REPO = 'spark-agent'
const DEFAULT_UPDATER_CACHE_DIR = 'spark-agent-updater'
const DEFAULT_RELEASES_API_BASE = 'https://spark.yiqibyte.com'

export interface UpdatePreferences {
  autoCheck: boolean
  autoDownload: boolean
  autoInstall: boolean
  channel: UpdateChannel
}

export interface UpdateServiceInitOptions {
  handler?: StatusChangeHandler
  preferences?: Partial<UpdatePreferences>
  lastCheckedAt?: string | null
  onLastCheckedChange?: (iso: string) => void
  onUpdateAvailable?: (info: UpdateInfo, preferences: UpdatePreferences) => void
  onUpdateDownloaded?: (info: UpdateInfo, preferences: UpdatePreferences) => void
  onUpdateError?: (message: string) => void
  /**
   * 请求退出应用以让安装包完成替换安装。
   * 由 main 进程注入：内部需先置位退出守卫（isQuitting）再 app.quit()，
   * 否则窗口 close 处理器会 preventDefault 阻止退出，导致旧实例残留、安装无法进行。
   */
  onRequestQuit?: () => void
}

interface GithubReleaseFeedConfig {
  provider: 'github'
  owner: string
  repo: string
  updaterCacheDirName: string
  token?: string
  releasesApiBase?: string
}

interface LoadedReleaseFeedConfig {
  config: GithubReleaseFeedConfig
  source: string
}

interface GithubReleaseAsset {
  name: string
  browser_download_url: string
  size?: number
  content_type?: string
}

interface GithubRelease {
  tag_name: string
  prerelease: boolean
  draft: boolean
  body: string | null
  published_at: string
  assets: GithubReleaseAsset[]
  source?: 'github' | 'version-center'
}

interface ResolvedReleaseAsset {
  asset: GithubReleaseAsset
  source: 'github' | 'version-center'
}

interface VersionCenterRelease {
  version: string
  channel: string
  platform: 'mac' | 'win' | 'linux'
  arch: 'arm64' | 'x64' | 'universal'
  fileName: string
  fileSize: number
  publicUrl: string
  releaseNotes: string | null
  publishedAt: string | null
}

interface ParsedVersion {
  core: number[]
  prerelease: Array<number | string> | null
}

interface GitHubRateLimitState {
  message: string
  retryAt: number | null
}

const DEFAULT_PREFERENCES: UpdatePreferences = {
  autoCheck: true,
  autoDownload: false,
  autoInstall: false,
  channel: 'stable',
}

function resolveDevUpdateConfigPath(): string | null {
  const candidates = [
    join(process.cwd(), 'dev-app-update.yml'),
    resolve(__dirname, '..', '..', '..', 'dev-app-update.yml'),
    resolve(__dirname, '..', '..', 'dev-app-update.yml'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function resolvePackagedUpdateConfigPath(): string | null {
  const candidate = join(process.resourcesPath, 'app-update.yml')
  return existsSync(candidate) ? candidate : null
}

function loadReleaseFeedConfig(): LoadedReleaseFeedConfig {
  const fallback: GithubReleaseFeedConfig = {
    provider: 'github',
    owner: DEFAULT_RELEASE_OWNER,
    repo: DEFAULT_RELEASE_REPO,
    updaterCacheDirName: DEFAULT_UPDATER_CACHE_DIR,
    releasesApiBase: DEFAULT_RELEASES_API_BASE,
  }

  const configPath = app.isPackaged ? resolvePackagedUpdateConfigPath() : resolveDevUpdateConfigPath()
  if (configPath == null) {
    return {
      config: fallback,
      source: 'built-in defaults',
    }
  }

  try {
    const raw = readFileSync(configPath, 'utf8')
    const parsed = parseFlatYaml(raw)
    if (parsed == null || typeof parsed !== 'object') {
      return { config: fallback, source: `fallback (invalid config: ${configPath})` }
    }
    const record = parsed as Record<string, unknown>
    const owner = typeof record.owner === 'string' && record.owner.trim().length > 0
      ? record.owner.trim()
      : fallback.owner
    const repo = typeof record.repo === 'string' && record.repo.trim().length > 0
      ? record.repo.trim()
      : fallback.repo
    const updaterCacheDirName =
      typeof record.updaterCacheDirName === 'string' && record.updaterCacheDirName.trim().length > 0
        ? record.updaterCacheDirName.trim()
        : fallback.updaterCacheDirName
    const token = typeof record.token === 'string' && record.token.trim().length > 0
      ? record.token.trim()
      : undefined
    const releasesApiBase = typeof record.releasesApiBase === 'string' && record.releasesApiBase.trim().length > 0
      ? record.releasesApiBase.trim().replace(/\/$/, '')
      : fallback.releasesApiBase
    return {
      config: {
        provider: 'github',
        owner,
        repo,
        updaterCacheDirName,
        ...(token != null ? { token } : {}),
        ...(releasesApiBase != null ? { releasesApiBase } : {}),
      },
      source: configPath,
    }
  } catch (error) {
    log.warn(`Failed to parse update config, falling back to defaults: ${String(error)}`)
    return { config: fallback, source: `fallback (parse failed: ${configPath})` }
  }
}

function parseFlatYaml(raw: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue
    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) continue
    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (key.length > 0) {
      result[key] = value
    }
  }
  return result
}

function normalizeTagVersion(tag: string): string {
  return tag.trim().replace(/^v/i, '')
}

function parseVersion(value: string): ParsedVersion {
  const normalized = normalizeTagVersion(value)
  const [coreRaw, prereleasePart] = normalized.split('-', 2)
  const corePart = coreRaw ?? normalized
  const core = corePart.split('.').map((segment) => {
    const parsed = Number.parseInt(segment, 10)
    return Number.isFinite(parsed) ? parsed : 0
  })
  const prerelease = prereleasePart == null || prereleasePart.length === 0
    ? null
    : prereleasePart.split('.').map((segment) => {
      if (/^\d+$/.test(segment)) return Number.parseInt(segment, 10)
      return segment
    })
  return { core, prerelease }
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  const maxLength = Math.max(a.core.length, b.core.length, 3)
  for (let index = 0; index < maxLength; index += 1) {
    const diff = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }

  if (a.prerelease == null && b.prerelease == null) return 0
  if (a.prerelease == null) return 1
  if (b.prerelease == null) return -1

  const prereleaseLength = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart == null) return -1
    if (rightPart == null) return 1
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart > rightPart ? 1 : -1
    }
    if (typeof leftPart === 'number') return -1
    if (typeof rightPart === 'number') return 1
    return leftPart.localeCompare(rightPart)
  }

  return 0
}

function getPlatformLabel(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    default:
      return process.platform
  }
}

function getVersionCenterPlatform(): VersionCenterRelease['platform'] | null {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'linux') return 'linux'
  return null
}

function getVersionCenterArch(): VersionCenterRelease['arch'] {
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

function toGithubLikeRelease(release: VersionCenterRelease): GithubRelease {
  return {
    tag_name: release.version,
    prerelease: release.channel !== 'stable',
    draft: false,
    body: release.releaseNotes,
    published_at: release.publishedAt ?? new Date().toISOString(),
    source: 'version-center',
    assets: [
      {
        name: release.fileName,
        browser_download_url: release.publicUrl,
        size: release.fileSize,
      },
    ],
  }
}

function normalizeUpdateErrorMessage(message: string): string {
  if (message.includes('GitHub API rate limit')) {
    return message
  }
  if (message.includes('No supported release asset found')) {
    return `当前 Release 缺少适用于 ${getPlatformLabel()} 的安装包，请确认已上传对应平台的 dmg / exe 资产。`
  }
  if (message.includes('No published releases found')) {
    return '当前仓库还没有可用的正式发布版本。'
  }
  return message
}

function formatRetryAtLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
  })
}

function buildGitHubRateLimitMessage(retryAt: number | null): string {
  if (retryAt != null && Number.isFinite(retryAt)) {
    return `GitHub 更新检查触发了频率限制，请在 ${formatRetryAtLabel(retryAt)} 后重试。`
  }
  return 'GitHub 更新检查触发了频率限制，请稍后再试。'
}

function parseGitHubRateLimitState(response: Response, responseText: string): GitHubRateLimitState | null {
  if (response.status !== 403 && response.status !== 429) return null

  const retryAfterHeader = response.headers.get('retry-after')
  const retryAfterSeconds = retryAfterHeader == null ? Number.NaN : Number.parseInt(retryAfterHeader, 10)
  const retryAtFromRetryAfter = Number.isFinite(retryAfterSeconds)
    ? Date.now() + retryAfterSeconds * 1000
    : null

  const remainingHeader = response.headers.get('x-ratelimit-remaining')
  const remaining = remainingHeader == null ? Number.NaN : Number.parseInt(remainingHeader, 10)
  const resetHeader = response.headers.get('x-ratelimit-reset')
  const resetEpochSeconds = resetHeader == null ? Number.NaN : Number.parseInt(resetHeader, 10)
  const retryAtFromReset = Number.isFinite(resetEpochSeconds)
    ? resetEpochSeconds * 1000
    : null

  const lowerText = responseText.toLowerCase()
  const looksLikeRateLimit =
    response.status === 429
    || retryAtFromRetryAfter != null
    || (remaining === 0 && retryAtFromReset != null)
    || lowerText.includes('secondary rate limit')
    || lowerText.includes('api rate limit exceeded')

  if (!looksLikeRateLimit) return null

  const retryAt = retryAtFromRetryAfter ?? retryAtFromReset ?? (lowerText.includes('secondary rate limit') ? Date.now() + 60_000 : null)

  return {
    message: buildGitHubRateLimitMessage(retryAt),
    retryAt,
  }
}

function toUpdateInfo(release: GithubRelease, asset: GithubReleaseAsset): UpdateInfo {
  const result: UpdateInfo = {
    version: normalizeTagVersion(release.tag_name),
    releaseDate: release.published_at,
  }
  if (typeof release.body === 'string' && release.body.trim().length > 0) {
    result.releaseNotes = release.body
  }
  if (asset.size != null) {
    result.fileSize = asset.size
  }
  return result
}

function scoreMacAsset(name: string): number {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.dmg') || lower.endsWith('.dmg.blockmap')) return Number.POSITIVE_INFINITY
  const arch = process.arch
  const universalScore = lower.includes('universal') ? 0 : 10
  if (arch === 'arm64') {
    if (lower.includes('arm64')) return 1
    if (lower.includes('x64')) return 4
    return universalScore
  }
  if (lower.includes('x64')) return 0
  if (lower.includes('arm64')) return 4
  return universalScore
}

function scoreWindowsAsset(name: string): number {
  const lower = name.toLowerCase()
  if (!lower.endsWith('.exe') || lower.endsWith('.exe.blockmap')) return Number.POSITIVE_INFINITY
  let score = 10
  if (lower.includes('setup')) score -= 5
  if (lower.includes('portable')) score += 6
  return score
}

function resolveReleaseAsset(
  assets: GithubReleaseAsset[],
  source: ResolvedReleaseAsset['source'] = 'github',
): ResolvedReleaseAsset | null {
  if (process.platform === 'darwin') {
    const best = [...assets]
      .sort((left, right) => scoreMacAsset(left.name) - scoreMacAsset(right.name))
      .find((asset) => Number.isFinite(scoreMacAsset(asset.name)))
    return best == null ? null : { asset: best, source }
  }

  if (process.platform === 'win32') {
    const best = [...assets]
      .sort((left, right) => scoreWindowsAsset(left.name) - scoreWindowsAsset(right.name))
      .find((asset) => Number.isFinite(scoreWindowsAsset(asset.name)))
    return best == null ? null : { asset: best, source }
  }

  return null
}

type StatusChangeHandler = (status: UpdateStatus) => void

export class UpdateService {
  private status: UpdateStatus
  private startupCheckTimer: ReturnType<typeof setTimeout> | null = null
  private onStatusChange: StatusChangeHandler | null = null
  private onLastCheckedChange: ((iso: string) => void) | null = null
  private onUpdateAvailable: ((info: UpdateInfo, preferences: UpdatePreferences) => void) | null = null
  private onUpdateDownloaded: ((info: UpdateInfo, preferences: UpdatePreferences) => void) | null = null
  private onUpdateError: ((message: string) => void) | null = null
  private onRequestQuit: (() => void) | null = null
  private initialized = false
  private preferences: UpdatePreferences = { ...DEFAULT_PREFERENCES }
  private releaseFeedConfig: GithubReleaseFeedConfig = {
    provider: 'github',
    owner: DEFAULT_RELEASE_OWNER,
    repo: DEFAULT_RELEASE_REPO,
    updaterCacheDirName: DEFAULT_UPDATER_CACHE_DIR,
    releasesApiBase: DEFAULT_RELEASES_API_BASE,
  }
  private releaseAsset: ResolvedReleaseAsset | null = null
  private releaseInfo: UpdateInfo | null = null
  private downloadedFilePath: string | null = null
  private installLaunchInProgress = false
  private rateLimitedUntil: number | null = null
  private readonly onWindowFocus = () => {
    if (!this.preferences.autoCheck) return
    if (this.status.state === 'checking' || this.status.state === 'downloading') return
    const lastCheckedAt = this.status.lastCheckedAt
    if (lastCheckedAt == null) return
    const elapsed = Date.now() - new Date(lastCheckedAt).getTime()
    if (!Number.isFinite(elapsed) || elapsed < FOCUS_RECHECK_THRESHOLD_MS) return
    void this.checkForUpdates('focus')
  }
  private readonly onWillQuit = () => {
    if (!this.preferences.autoInstall) return
    if (process.platform !== 'win32') return
    if (this.status.state !== 'downloaded') return
    if (this.downloadedFilePath == null) return
    if (this.installLaunchInProgress) return
    const launched = this.launchInstaller(this.downloadedFilePath)
    if (launched) {
      this.installLaunchInProgress = true
    }
  }

  constructor() {
    this.status = {
      state: 'idle',
      currentVersion: app.getVersion(),
      updateInfo: null,
      progress: null,
      error: null,
      lastCheckedAt: null,
      updateSource: null,
      downloadSource: null,
    }
  }

  initialize(options: UpdateServiceInitOptions = {}): void {
    if (this.initialized) return
    this.initialized = true

    this.onStatusChange = options.handler ?? null
    this.onLastCheckedChange = options.onLastCheckedChange ?? null
    this.onUpdateAvailable = options.onUpdateAvailable ?? null
    this.onUpdateDownloaded = options.onUpdateDownloaded ?? null
    this.onUpdateError = options.onUpdateError ?? null
    this.onRequestQuit = options.onRequestQuit ?? null
    this.preferences = this.sanitizePreferences({
      ...DEFAULT_PREFERENCES,
      ...options.preferences,
    })
    if (options.lastCheckedAt != null) {
      this.status.lastCheckedAt = options.lastCheckedAt
    }

    const loadedConfig = loadReleaseFeedConfig()
    this.releaseFeedConfig = loadedConfig.config
    log.info(`Update feed configured from ${loadedConfig.source} -> ${loadedConfig.config.owner}/${loadedConfig.config.repo}`)

    app.on('browser-window-focus', this.onWindowFocus)
    app.on('will-quit', this.onWillQuit)

    if (this.preferences.autoCheck) {
      this.startAutoCheck()
    }

    log.info('UpdateService initialized')
  }

  startAutoCheck(): void {
    if (!this.preferences.autoCheck) {
      this.stopAutoCheck()
      return
    }
    this.scheduleStartupCheck()
    log.info('Auto-check scheduled for startup only')
  }

  stopAutoCheck(): void {
    if (this.startupCheckTimer != null) {
      clearTimeout(this.startupCheckTimer)
      this.startupCheckTimer = null
    }
  }

  async checkForUpdates(_reason: 'manual' | 'startup' | 'interval' | 'focus' = 'manual'): Promise<UpdateStatus> {
    if (this.status.state === 'checking' || this.status.state === 'downloading') {
      return this.status
    }

    if (this.rateLimitedUntil != null && this.rateLimitedUntil > Date.now()) {
      const message = buildGitHubRateLimitMessage(this.rateLimitedUntil)
      this.updateStatus({ state: 'error', error: message, progress: null })
      this.onUpdateError?.(message)
      return this.status
    }

    try {
      const lastCheckedAt = new Date().toISOString()
      this.updateStatus({ state: 'checking', error: null, lastCheckedAt })
      this.onLastCheckedChange?.(lastCheckedAt)

      const release = await this.fetchTargetRelease()
      if (release == null) {
        this.clearResolvedRelease()
        this.updateStatus({
          state: 'not-available',
          updateInfo: null,
          progress: null,
          error: null,
          updateSource: null,
          downloadSource: null,
        })
        return this.status
      }

      const version = normalizeTagVersion(release.tag_name)
      if (compareVersions(version, this.status.currentVersion) <= 0) {
        this.clearResolvedRelease()
        this.updateStatus({
          state: 'not-available',
          updateInfo: null,
          progress: null,
          error: null,
          updateSource: release.source ?? 'github',
          downloadSource: null,
        })
        return this.status
      }

      const resolvedAsset = resolveReleaseAsset(release.assets, release.source ?? 'github')
      if (resolvedAsset == null) {
        throw new Error(`No supported release asset found for ${getPlatformLabel()}`)
      }

      const updateInfo = toUpdateInfo(release, resolvedAsset.asset)
      this.releaseAsset = resolvedAsset
      this.releaseInfo = updateInfo
      const cachedPath = await this.resolveCachedDownloadPath(version, resolvedAsset.asset.name)
      if (cachedPath != null) {
        this.downloadedFilePath = cachedPath
        this.updateStatus({
          state: 'downloaded',
          updateInfo,
          progress: null,
          error: null,
          updateSource: release.source ?? 'github',
          downloadSource: resolvedAsset.source,
        })
        this.onUpdateDownloaded?.(updateInfo, this.getPreferences())
        return this.status
      }

      this.downloadedFilePath = null
      this.updateStatus({
        state: 'available',
        updateInfo,
        progress: null,
        error: null,
        updateSource: release.source ?? 'github',
        downloadSource: resolvedAsset.source,
      })
      this.onUpdateAvailable?.(updateInfo, this.getPreferences())
      if (this.preferences.autoDownload) {
        await this.downloadUpdate()
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const message = normalizeUpdateErrorMessage(rawMessage)
      log.error(`Check for updates failed: ${message}`)
      this.updateStatus({ state: 'error', error: message, progress: null })
      this.onUpdateError?.(message)
    }

    return this.status
  }

  async downloadUpdate(): Promise<boolean> {
    if ((this.status.state !== 'available' && this.status.state !== 'downloaded') || this.releaseAsset == null || this.releaseInfo == null) {
      log.warn(`Cannot download: current state is ${this.status.state}`)
      return false
    }

    if (this.downloadedFilePath != null && this.status.state === 'downloaded') {
      return true
    }

    try {
      const version = this.releaseInfo.version
      const targetDir = join(app.getPath('userData'), this.releaseFeedConfig.updaterCacheDirName, version)
      const finalPath = join(targetDir, this.releaseAsset.asset.name)
      const tempPath = `${finalPath}.download`

      await mkdir(targetDir, { recursive: true })
      this.updateStatus({
        state: 'downloading',
        progress: null,
        error: null,
        downloadSource: this.releaseAsset.source,
      })

      const response = await fetch(this.releaseAsset.asset.browser_download_url, {
        headers: this.getDownloadRequestHeaders(this.releaseAsset.source),
      })
      if (!response.ok || response.body == null) {
        throw new Error(`下载更新失败：服务器返回 ${response.status}`)
      }

      const total = Number.parseInt(
        response.headers.get('content-length') ?? `${this.releaseAsset.asset.size ?? 0}`,
        10,
      )
      const writer = createWriteStream(tempPath)
      const reader = response.body.getReader()
      let transferred = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value == null) continue
          transferred += value.byteLength
          if (!writer.write(Buffer.from(value))) {
            await once(writer, 'drain')
          }
          const progressInfo: UpdateProgressInfo = {
            bytesPerSecond: 0,
            percent: total > 0 ? Math.round((transferred / total) * 10_000) / 100 : 0,
            transferred,
            total: total > 0 ? total : transferred,
          }
          this.updateStatus({
            state: 'downloading',
            progress: progressInfo,
            error: null,
            downloadSource: this.releaseAsset.source,
          })
        }
        const finishPromise = Promise.race([
          once(writer, 'finish').then(() => undefined),
          once(writer, 'error').then(([error]) => Promise.reject(error)),
        ])
        writer.end()
        await finishPromise
      } catch (error) {
        writer.destroy()
        await rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }

      await rm(finalPath, { force: true })
      await rename(tempPath, finalPath)

      this.downloadedFilePath = finalPath
      this.updateStatus({
        state: 'downloaded',
        updateInfo: this.releaseInfo,
        progress: null,
        error: null,
        downloadSource: this.releaseAsset.source,
      })
      this.onUpdateDownloaded?.(this.releaseInfo, this.getPreferences())
      return true
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const message = normalizeUpdateErrorMessage(rawMessage)
      log.error(`Download update failed: ${message}`)
      this.updateStatus({
        state: 'error',
        error: message,
        progress: null,
      })
      this.onUpdateError?.(message)
      return false
    }
  }

  installAndRestart(): boolean {
    if (this.status.state !== 'downloaded' || this.downloadedFilePath == null) {
      log.warn(`Cannot install: current state is ${this.status.state}`)
      return false
    }

    const launched = this.launchInstaller(this.downloadedFilePath)
    if (!launched) return false

    // 安装包已启动后必须退出当前实例，否则安装无法进行：
    //   - Windows: 安装器无法覆盖正在运行的可执行文件
    //   - macOS: dmg 内的新 .app 无法替换正在运行的旧实例
    this.installLaunchInProgress = true
    if (process.platform === 'darwin') {
      // 给 `open` 一点时间挂载 dmg / 弹出 Finder 再退出，避免界面瞬间消失。
      // 子进程已 detached + unref，父进程退出不影响安装镜像。
      setTimeout(() => this.requestQuit(), MAC_INSTALL_QUIT_DELAY_MS)
    } else {
      this.requestQuit()
    }

    return true
  }

  /**
   * 退出应用：优先走 main 进程注入的 onRequestQuit（会置位退出守卫），
   * 否则回落到 app.quit()。直接 app.quit() 在 macOS 上可能被窗口 close
   * 守卫拦截，因此安装场景务必提供 onRequestQuit。
   */
  private requestQuit(): void {
    if (this.onRequestQuit != null) {
      this.onRequestQuit()
      return
    }
    app.quit()
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  getPreferences(): UpdatePreferences {
    return { ...this.preferences }
  }

  setAutoCheck(enabled: boolean): void {
    this.preferences.autoCheck = enabled
    log.info(`Auto-check ${enabled ? 'enabled' : 'disabled'}`)
    if (enabled) {
      this.startAutoCheck()
    } else {
      this.stopAutoCheck()
    }
  }

  setAutoDownload(enabled: boolean): void {
    this.preferences.autoDownload = enabled
    log.info(`Auto-download ${enabled ? 'enabled' : 'disabled'}`)
    if (enabled && this.status.state === 'available') {
      void this.downloadUpdate()
    }
  }

  setAutoInstall(enabled: boolean): void {
    const nextEnabled = process.platform === 'win32' && enabled
    this.preferences.autoInstall = nextEnabled
    log.info(`Auto-install-on-quit ${nextEnabled ? 'enabled' : 'disabled'}`)
  }

  setChannel(channel: UpdateChannel): void {
    this.preferences.channel = channel
    log.info(`Update channel set to: ${channel}`)
    if (this.preferences.autoCheck) {
      this.scheduleStartupCheck(1_500)
    }
  }

  destroy(): void {
    this.stopAutoCheck()
    app.removeListener('browser-window-focus', this.onWindowFocus)
    app.removeListener('will-quit', this.onWillQuit)
    this.initialized = false
    log.info('UpdateService destroyed')
  }

  private updateStatus(patch: Partial<UpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
    }
    this.onStatusChange?.(this.status)
  }

  private scheduleStartupCheck(delayMs: number = STARTUP_CHECK_DELAY_MS): void {
    if (!this.preferences.autoCheck) return
    if (this.startupCheckTimer != null) {
      clearTimeout(this.startupCheckTimer)
    }
    this.startupCheckTimer = setTimeout(() => {
      this.startupCheckTimer = null
      void this.checkForUpdates('startup')
    }, delayMs)
  }

  private sanitizePreferences(preferences: UpdatePreferences): UpdatePreferences {
    return {
      ...preferences,
      autoDownload: preferences.autoDownload,
      autoInstall: process.platform === 'win32' ? preferences.autoInstall : false,
    }
  }

  private getRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': RELEASE_REQUEST_USER_AGENT,
    }
    if (this.releaseFeedConfig.token != null) {
      headers.authorization = `Bearer ${this.releaseFeedConfig.token}`
    }
    return headers
  }

  private getDownloadRequestHeaders(source: ResolvedReleaseAsset['source']): Record<string, string> {
    if (source === 'github') return this.getRequestHeaders()
    return {
      'user-agent': RELEASE_REQUEST_USER_AGENT,
    }
  }

  private async fetchTargetRelease(): Promise<GithubRelease | null> {
    const versionCenterRelease = await this.fetchVersionCenterRelease().catch((error: unknown) => {
      log.warn(`Version center update check failed, falling back to GitHub: ${String(error)}`)
      return null
    })
    if (versionCenterRelease != null) {
      return versionCenterRelease
    }

    if (this.preferences.channel === 'stable') {
      const url = `https://api.github.com/repos/${encodeURIComponent(this.releaseFeedConfig.owner)}/${encodeURIComponent(this.releaseFeedConfig.repo)}/releases/latest`
      return await this.fetchGithubJson<GithubRelease>(url)
    }

    const url = `https://api.github.com/repos/${encodeURIComponent(this.releaseFeedConfig.owner)}/${encodeURIComponent(this.releaseFeedConfig.repo)}/releases?per_page=20`
    const releases = await this.fetchGithubJson<GithubRelease[]>(url)
    return releases.find((release) => !release.draft) ?? null
  }

  private async fetchVersionCenterRelease(): Promise<GithubRelease | null> {
    const base = this.releaseFeedConfig.releasesApiBase?.replace(/\/$/, '')
    const platform = getVersionCenterPlatform()
    if (base == null || base.length === 0 || platform == null) return null

    const url = new URL('/api/v1/desktop/releases/latest', base)
    url.searchParams.set('channel', this.preferences.channel)
    url.searchParams.set('platform', platform)
    url.searchParams.set('arch', getVersionCenterArch())

    const response = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        'user-agent': RELEASE_REQUEST_USER_AGENT,
      },
    })
    if (!response.ok) {
      throw new Error(`version center returned ${response.status}`)
    }

    const json = (await response.json()) as {
      code: number
      message?: string
      data?: VersionCenterRelease | null
    }
    if (json.code !== 0) {
      throw new Error(json.message || 'version center returned non-zero code')
    }
    return json.data == null ? null : toGithubLikeRelease(json.data)
  }

  private async fetchGithubJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: this.getRequestHeaders() })
    if (response.ok) {
      this.rateLimitedUntil = null
      return (await response.json()) as T
    }

    const responseText = await response.text()

    if (response.status === 404) {
      throw new Error('No published releases found')
    }

    const rateLimitState = parseGitHubRateLimitState(response, responseText)
    if (rateLimitState != null) {
      this.rateLimitedUntil = rateLimitState.retryAt
      throw new Error(rateLimitState.message)
    }

    let remoteMessage = ''
    try {
      const parsed = JSON.parse(responseText) as { message?: unknown }
      if (typeof parsed.message === 'string' && parsed.message.trim().length > 0) {
        remoteMessage = parsed.message.trim()
      }
    } catch {
      remoteMessage = ''
    }

    const suffix = remoteMessage.length > 0 ? `：${remoteMessage}` : ''
    throw new Error(`检查更新失败：GitHub 返回 ${response.status}${suffix}`)
  }

  private async resolveCachedDownloadPath(version: string, assetName: string): Promise<string | null> {
    const candidate = join(app.getPath('userData'), this.releaseFeedConfig.updaterCacheDirName, version, assetName)
    if (!existsSync(candidate)) return null
    try {
      const info = await stat(candidate)
      return info.isFile() ? candidate : null
    } catch {
      return null
    }
  }

  private clearResolvedRelease(): void {
    this.releaseAsset = null
    this.releaseInfo = null
    this.downloadedFilePath = null
  }

  private launchInstaller(filePath: string): boolean {
    try {
      if (process.platform === 'darwin') {
        const child = spawn('open', [filePath], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        return true
      }

      if (process.platform === 'win32') {
        const child = spawn(filePath, [], {
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        return true
      }

      log.warn(`Unsupported install platform: ${process.platform}`)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(`Failed to launch installer: ${message}`)
      this.updateStatus({
        state: 'error',
        error: `启动安装包失败：${message}`,
      })
      return false
    }
  }
}

let _instance: UpdateService | null = null

export function getUpdateService(): UpdateService {
  if (_instance == null) {
    _instance = new UpdateService()
  }
  return _instance
}

/**
 * UpdateService — 自动更新服务
 *
 * 基于 electron-updater 实现应用的自动更新功能：
 *   - 自动检查更新（启动时 + 定时检查）
 *   - 后台下载更新包
 *   - 更新就绪通知
 *   - 用户可控的更新行为
 *
 * 注意：electron-updater 只在打包后的应用中生效。
 * 开发模式下会静默降级，不产生错误。
 */

import { autoUpdater } from 'electron-updater'
import type { UpdateInfo as ElectronUpdateInfo, UpdateDownloadedEvent } from 'electron-updater'
import { app } from 'electron'
import { createLogger } from '@spark/shared'
import type {
  UpdateStatus,
  UpdateInfo,
  UpdateProgressInfo,
  UpdateChannel,
} from '@spark/protocol'

const log = createLogger('update-service')

/** 自动检查间隔（4 小时） */
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/**
 * 将 electron-updater 的 UpdateInfo 转换为协议定义的 UpdateInfo
 *
 * 注意：exactOptionalPropertyTypes 要求不显式设置 optional 字段为 undefined
 */
function toUpdateInfo(info: ElectronUpdateInfo): UpdateInfo {
  const result: UpdateInfo = {
    version: info.version,
    releaseDate: info.releaseDate,
  }
  if (typeof info.releaseNotes === 'string') {
    result.releaseNotes = info.releaseNotes
  }
  const fileSize = info.files?.[0]?.size
  if (fileSize != null) {
    result.fileSize = fileSize
  }
  return result
}

type StatusChangeHandler = (status: UpdateStatus) => void

export class UpdateService {
  private status: UpdateStatus
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null
  private onStatusChange: StatusChangeHandler | null = null
  private initialized = false

  constructor() {
    this.status = {
      state: 'idle',
      currentVersion: app.getVersion(),
      updateInfo: null,
      progress: null,
      error: null,
    }
  }

  /**
   * 初始化更新服务
   *
   * 设置 electron-updater 配置和事件监听。
   * 应在窗口创建后调用。
   */
  initialize(handler?: StatusChangeHandler): void {
    if (this.initialized) return
    this.initialized = true

    this.onStatusChange = handler ?? null

    // 配置 electron-updater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.disableWebInstaller = false
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false

    // 在开发模式下禁用自动更新签名验证（开发时不会有签名）
    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = false
      log.info('Auto-updater disabled in development mode')
    }

    // ─── 事件监听 ───

    autoUpdater.on('checking-for-update', () => {
      log.info('Checking for updates...')
      this.updateStatus({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info: ElectronUpdateInfo) => {
      log.info(`Update available: ${info.version}`)
      this.updateStatus({
        state: 'available',
        updateInfo: toUpdateInfo(info),
      })
    })

    autoUpdater.on('update-not-available', (info: ElectronUpdateInfo) => {
      log.info(`No update available. Current: ${info.version}`)
      this.updateStatus({
        state: 'not-available',
        updateInfo: null,
        error: null,
      })
    })

    autoUpdater.on('error', (err: Error) => {
      log.error(`Auto-updater error: ${err.message}`)
      this.updateStatus({
        state: 'error',
        error: err.message,
      })
    })

    autoUpdater.on('download-progress', (progress: { bytesPerSecond: number; percent: number; transferred: number; total: number }) => {
      const progressInfo: UpdateProgressInfo = {
        bytesPerSecond: progress.bytesPerSecond,
        percent: Math.round(progress.percent * 100) / 100,
        transferred: progress.transferred,
        total: progress.total,
      }
      this.updateStatus({
        state: 'downloading',
        progress: progressInfo,
      })
    })

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      log.info(`Update downloaded: ${event.version}`)
      const updateInfo: UpdateInfo = {
        version: event.version,
        releaseDate: event.releaseDate,
      }
      if (typeof event.releaseNotes === 'string') {
        updateInfo.releaseNotes = event.releaseNotes
      }
      this.updateStatus({
        state: 'downloaded',
        updateInfo,
        progress: null,
      })
    })

    log.info('UpdateService initialized')
  }

  /**
   * 启动自动检查定时器
   */
  startAutoCheck(intervalMs: number = AUTO_CHECK_INTERVAL_MS): void {
    this.stopAutoCheck()
    this.autoCheckTimer = setInterval(() => {
      log.info('Auto-check triggered')
      void this.checkForUpdates()
    }, intervalMs)
    log.info(`Auto-check started (interval: ${intervalMs}ms)`)
  }

  /**
   * 停止自动检查
   */
  stopAutoCheck(): void {
    if (this.autoCheckTimer != null) {
      clearInterval(this.autoCheckTimer)
      this.autoCheckTimer = null
    }
  }

  /**
   * 检查更新
   */
  async checkForUpdates(): Promise<UpdateStatus> {
    if (!app.isPackaged) {
      log.info('Skipping update check in development mode')
      this.updateStatus({
        state: 'not-available',
        error: null,
      })
      return this.status
    }

    try {
      this.updateStatus({ state: 'checking', error: null })
      const result = await autoUpdater.checkForUpdates()
      if (result == null) {
        this.updateStatus({ state: 'not-available' })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Check for updates failed: ${message}`)
      this.updateStatus({ state: 'error', error: message })
    }

    return this.status
  }

  /**
   * 下载更新
   */
  async downloadUpdate(): Promise<boolean> {
    if (!app.isPackaged) {
      log.info('Skipping download in development mode')
      return false
    }

    if (this.status.state !== 'available' && this.status.state !== 'downloaded') {
      log.warn(`Cannot download: current state is ${this.status.state}`)
      return false
    }

    try {
      this.updateStatus({ state: 'downloading', progress: null, error: null })
      await autoUpdater.downloadUpdate()
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error(`Download update failed: ${message}`)
      this.updateStatus({ state: 'error', error: message })
      return false
    }
  }

  /**
   * 安装更新并重启
   */
  installAndRestart(): boolean {
    if (this.status.state !== 'downloaded') {
      log.warn(`Cannot install: current state is ${this.status.state}`)
      return false
    }

    log.info('Installing update and restarting...')
    // 使用 quitAndInstall: silent=false, forceRunAfter=true
    autoUpdater.quitAndInstall(false, true)
    return true
  }

  /**
   * 获取当前状态
   */
  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  /**
   * 设置自动下载
   */
  setAutoDownload(enabled: boolean): void {
    autoUpdater.autoDownload = enabled
    log.info(`Auto-download ${enabled ? 'enabled' : 'disabled'}`)
  }

  /**
   * 设置更新通道
   * 目前支持 stable/beta
   */
  setChannel(_channel: UpdateChannel): void {
    autoUpdater.allowPrerelease = _channel === 'beta'
    autoUpdater.channel = _channel === 'beta' ? 'beta' : 'latest'
    log.info(`Update channel set to: ${_channel}`)
  }

  /**
   * 销毁服务，清理资源
   */
  destroy(): void {
    this.stopAutoCheck()
    autoUpdater.removeAllListeners()
    this.initialized = false
    log.info('UpdateService destroyed')
  }

  /**
   * 更新状态并通知监听者
   */
  private updateStatus(patch: Partial<UpdateStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
    }
    this.onStatusChange?.(this.status)
  }
}

/** 单例实例 */
let _instance: UpdateService | null = null

export function getUpdateService(): UpdateService {
  if (_instance == null) {
    _instance = new UpdateService()
  }
  return _instance
}

/**
 * Spark Agent 主进程入口
 *
 * 职责：
 *   1. 管理 Electron 应用生命周期
 *   2. 创建主窗口（BrowserWindow）
 *   3. 初始化数据库（SQLite）
 *   4. 注册 IPC handlers
 *   5. 管理应用级状态
 *
 * 安全约束（ADR-003）：
 *   - contextIsolation: true
 *   - nodeIntegration: false
 *   - sandbox: true
 */

import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  type MenuItemConstructorOptions,
  dialog,
  globalShortcut,
  nativeImage,
  nativeTheme,
  shell,
} from 'electron'
import { join } from 'path'

// ─── EPIPE guard ─────────────────────────────────────────────────────────────
// 当主进程从控制台分离启动（Windows 上常见）或父进程关闭后，stdout/stderr 的管道
// 会断开，此后任何 console.* 写入都会抛出 EPIPE。若未处理便成为 uncaughtException，
// 触发 Electron 的崩溃弹窗（"A JavaScript error occurred in the main process"）。
// 这里在输出流上挂 'error' 监听，吞掉 EPIPE：有监听器后，流错误不会升级成
// uncaughtException，也就不会触发崩溃弹窗。其他流错误仍重新抛出，保留诊断能力。
const ignoreEpipe = (err: NodeJS.ErrnoException): void => {
  if (err?.code === 'EPIPE') return
  throw err
}
process.stdout?.on('error', ignoreEpipe)
process.stderr?.on('error', ignoreEpipe)

// ─── Overlay scrollbars ───────────────────────────────────────────────────
// 【关键】显式【禁用】OverlayScrollbar feature。
// 在 Windows 10/11 上，Chromium 默认就启用 OverlayScrollbar（即使你不写 enable-features）。
// 该 feature 一旦激活，Chromium 会接管滚动条渲染：
//   1) hover 时自动扩宽 thumb（绕过所有 CSS，"悬浮变宽"）；
//   2) thumb 形状由系统接管，::-webkit-scrollbar-thumb 的 border-radius 失效（方头）。
// 这正是历史上反复改 CSS 都改不好滚动条的根因。仅"不写 enable-features"是不够的——
// 必须用 disable-features 强制关闭它，Chromium 才会走经典 ::-webkit-scrollbar 路径，
// 此时 styles.css 中的 width / border-radius:999px / hover 颜色 才全部生效（圆头、不变宽）。
// 注意：这是主进程命令行开关，改后必须【完全退出应用】重启（不能只刷新窗口）。
app.commandLine.appendSwitch(
  'disable-features',
  'OverlayScrollbar,OverlayScrollbarFlashAfterAnyScrollUpdate,OverlayScrollbarFlashWhenMouseEnter,OverlayScrollbarWinStyle',
)

// ─── Dev userData isolation ────────────────────────────────────────────────
// 必须在任何 userData 消费者（单实例锁、数据库、各服务）之前执行：
// dev 运行时把数据目录切到 @spark/desktop-dev，避免开发构建与生产安装包
// 共写同一个 spark.db（曾触发在线恢复 split-brain 丢数据）。详见 data-profile.ts。
const devUserDataDir = applyDevUserData(app, !app.isPackaged, process.env)
if (devUserDataDir) {
  console.warn(`[data-profile] dev run detected, using isolated userData: ${devUserDataDir}`)
}

import { is } from '@electron-toolkit/utils'
import { applyDevUserData } from './data-profile.js'
import { getDatabasePath, setDatabaseInstance, closeDatabase } from './db.js'
import { startBackgroundMaintenanceWorker } from './services/background-maintenance-worker.js'
import { startSnapshotVaultMaintenance } from './services/computer-use/SnapshotVaultMaintenance.js'
import { TempMediaFilesMaintenance } from './services/TempMediaFilesMaintenance.js'
import {
  disposeComputerUseServices,
  getComputerUseServices,
  initializeComputerUseServices,
} from './services/computer-use/ComputerUseServices.js'
import { runComputerUsePackagedSmoke } from './services/computer-use/ComputerUsePackagedSmoke.js'
import { ComputerControlTrayService } from './services/computer-use/ComputerControlTrayService.js'
import { disposeComputerUseMcpProvider } from './services/computer-use/ComputerUseMcpProvider.js'
import {
  registerAllIpcHandlers,
  ensureNoProjectDirectoryExists,
  getMcpService,
} from './ipc/index.js'
import { getCustomToolService } from './ipc/registerCustomToolsIpc.js'
import { CustomToolsRuntimeService } from './services/CustomToolsRuntimeService.js'
import {
  getMainWindow,
  getPreferredAppWindow,
  revealAppWindow,
  setMainWindow,
  sendToMainWindow,
} from './windows/index.js'
import { buildWindowChromeOptions } from './window-chrome.js'
import { getFileWatcherService } from './services/FileWatcherService.js'
import { getTerminalService } from './services/TerminalService.js'
import { getUpdateService } from './services/UpdateService.js'
import { checkSdkIntegrity } from './services/SdkIntegrityService.js'
import { configureCodexRuntimeEnvironment } from './services/CodexRuntimeIntegrityService.js'
import {
  initializeShellEnvironment,
  getShellEnvironmentStatus,
} from './services/ShellEnvironmentService.js'
import {
  ensureRegistered as ensurePlaywrightRegistered,
  readRegistration as readPlaywrightRegistration,
} from './services/PlaywrightMcpRegistration.js'
import { detectIntegrity as detectPlaywrightIntegrity } from './services/PlaywrightIntegrityService.js'
import { getSubAppBrowserService } from './services/SubAppBrowserService.js'
import { getCanvasWindowService } from './services/CanvasWindowService.js'
import { installWebviewPopupRouter } from './services/BrowserPanelWindowService.js'
import { attachAppUnreadBadgeTray } from './services/AppUnreadBadgeService.js'
import { registerAppUnreadBadgeIpc } from './ipc/registerAppUnreadBadgeIpc.js'
import { registerBrowserPanelDevtoolsIpc } from './ipc/registerBrowserPanelDevtoolsIpc.js'
import { registerNotificationIpc } from './ipc/registerNotificationIpc.js'
import {
  initNotificationService,
  type NotificationService,
} from './services/Notifications/index.js'
import { getOptionalCapabilityManager } from './ipc/registerOptionalCapabilityIpc.js'
import { ensureBundledBrowserEnv } from './services/PlaywrightEnvironment.js'
import { detectFfmpegIntegrity } from './services/FfmpegIntegrityService.js'
import { updateManagedFontAssetsInBackground } from './services/FontAssetService.js'
import { registerSafeFileProtocol } from './services/SafeFileProtocol.js'
import { registerCapabilityAssetProtocol } from './services/CapabilityAssetProtocol.js'
import { registerSnapshotProtocol } from './services/computer-use/SnapshotProtocol.js'
import { registerPrivilegedProtocolSchemes } from './services/PrivilegedProtocolSchemes.js'
import { isWebviewSourceAllowed, openExternalUrlSafely } from './services/ExternalUrlPolicy.js'
import {
  ensurePreMigrationBackup,
  restoreDatabaseBackup,
} from './services/DatabaseBackupService.js'
import {
  applyPendingProductionDbInheritance,
  setProductionDbInheritQuitRequester,
} from './services/ProductionDbInheritService.js'
import { installSingleInstanceLock } from './single-instance.js'
import { getDatabase } from './db.js'
import { getRecentSessionsForTray } from './ipc/index.js'
import { createLogger } from '@spark/shared'
import type { UpdateInfo, UpdateStatus } from '@spark/protocol'
import { ProviderService, resolveProviderApiKey, SettingsService } from '@spark/agent-runtime'
import { ProviderProfileRepository, SettingsRepository } from '@spark/storage'
import { startSparkCliBridge, type SparkCliBridge } from './services/SparkCliBridgeService.js'
import { initAuthService, getAuthService } from './services/Auth/AuthService.js'
import { getPlatformModelService } from './services/PlatformModel/index.js'
import {
  findPlatformModelRedeemCode,
  parsePlatformModelRedeemDeepLink,
} from './services/PlatformModel/PlatformModelDeepLink.js'
import {
  createAppShutdownCoordinator,
  registerEmergencySessionShutdown,
  runShutdownCleanupSteps,
} from './app-shutdown.js'
import { disposeSessionServiceForShutdown } from './session-service-shutdown.js'
import {
  resolveAuthKeytarService,
  shouldEnableSingleInstanceLock,
  shouldRegisterDefaultProtocolClient,
} from './startup-isolation.js'

const log = createLogger('main')

// ─── Uncaught error guard ────────────────────────────────────────────────────
// 此前主进程没有任何 uncaughtException / unhandledRejection 兜底：任何未捕获异常
// 都会触发 Electron 崩溃弹窗（"A JavaScript error occurred in the main process"）
// 并让整个应用直接退出——退出不走 before-quit 清理，事后文件日志也无任何错误
// 记录可查（如 2026-08-26 取消深度视频任务后整应用退出、日志却毫无痕迹的事件）。
// 这里统一记入文件日志（ERROR 级别必落盘 <logs>/main.log）并保持应用存活，把
// "无声整应用退出"变成可诊断的日志证据；前缀 [main-uncaught] 便于检索。
const formatUncaughtError = (error: unknown): string => {
  if (error instanceof Error) return `${error.message}\n${error.stack ?? '(no stack)'}`
  return String(error)
}
process.on('uncaughtException', (error) => {
  log.error(`[main-uncaught] uncaughtException: ${formatUncaughtError(error)}`)
})
process.on('unhandledRejection', (reason) => {
  log.error(`[main-uncaught] unhandledRejection: ${formatUncaughtError(reason)}`)
})

// 退出取证：应用内主动退出只有托盘菜单/更新安装等少数入口，但 before-quit 事件
// 本身不带来源信息。在退出关键节点记录窗口快照与触发事件，复发"整应用意外退出"
// 时可直接从 main.log 还原退出时刻的窗口状态与先后顺序。前缀 [quit-forensics]。
const formatWindowSnapshot = (): string => {
  const windows = BrowserWindow.getAllWindows()
  if (windows.length === 0) return 'none(全部窗口已销毁)'
  return windows
    .map((win) => `#${win.id}[${win.isVisible() ? 'visible' : 'hidden'}]${win.title}`)
    .join(', ')
}
let tray: Tray | null = null
let computerControlTray: ComputerControlTrayService | null = null
let unsubscribeComputerControlStatus: (() => void) | null = null
let computerControlTrayRefreshTimer: ReturnType<typeof setTimeout> | null = null
let isQuitting = false
let requestedQuitReason: string | null = null
let downloadedPromptVersion: string | null = null
const BROWSER_ZOOM_CHANGED_EVENT = 'spark:browser-zoom-changed'
const UI_ZOOM_MIN = 80
const UI_ZOOM_MAX = 150
const UI_ZOOM_STEP = 5

registerEmergencySessionShutdown(process, disposeSessionServiceForShutdown)

function requestApplicationQuit(reason: string): void {
  requestedQuitReason = reason
  isQuitting = true
  log.warn(`[quit-forensics] request-quit; reason=${reason}; windows=${formatWindowSnapshot()}`)
  app.quit()
}

// 继承安装版数据：stage 完成后由 IPC 层触发 relaunch + 完整关闭链退出
setProductionDbInheritQuitRequester(() => requestApplicationQuit('inherit-production-db'))

function requestApplicationExit(reason: string, exitCode: number): void {
  requestedQuitReason = reason
  isQuitting = true
  log.warn(
    `[quit-forensics] request-exit; reason=${reason}; code=${exitCode}; windows=${formatWindowSnapshot()}`,
  )
  app.exit(exitCode)
}

// ─── Quit guard ──────────────────────────────────────────────────────────────
// 无论从哪里发起退出（macOS Dock 右键"退出" / ⌘Q、托盘菜单"退出"、自动更新
// 安装），`before-quit` 都会先于各窗口的 `close` 事件触发。这里统一置位
// isQuitting，确保主窗口 close 处理器（见 createWindow）不再 preventDefault
// + hide()，从而让窗口真正销毁、应用真正退出。
//
// 修复：此前 isQuitting 只在「托盘菜单退出」(见 refreshTrayMenu) 和「更新安装」
// (见 UpdateService onRequestQuit) 两处置位。macOS Dock 右键"退出"会触发
// before-quit → 关闭主窗口 → close 处理器发现 isQuitting 仍为 false →
// preventDefault + hide()，退出被吞，应用无法真正退出。
app.on('before-quit', () => {
  isQuitting = true
  log.warn(
    `[quit-forensics] before-quit; reason=${requestedQuitReason ?? 'external-app-event'}; windows=${formatWindowSnapshot()}`,
  )
  unsubscribeComputerControlStatus?.()
  unsubscribeComputerControlStatus = null
  if (computerControlTrayRefreshTimer != null) clearTimeout(computerControlTrayRefreshTimer)
  computerControlTrayRefreshTimer = null
})

// ─── Custom protocol registration ───────────────────────────────────────────
// 所有特权协议必须在 app.whenReady() 之前通过 Electron 唯一允许的一次调用注册，
// 否则较晚的调用会使较早协议丢失 fetch/CORS 等权限。
registerPrivilegedProtocolSchemes()

function getResourcePath(fileName: string): string {
  return is.dev
    ? join(__dirname, '../../resources', fileName)
    : join(process.resourcesPath, fileName)
}
function showMainWindow(): void {
  if (revealAppWindow(getMainWindow())) return
  createWindow()
}

function showPreferredAppWindow(): void {
  if (revealAppWindow(getPreferredAppWindow())) return
  showMainWindow()
}

const pendingRedeemCodes = new Set<string>()
let platformRedeemReady = false

function queuePlatformRedeemDeepLink(value: string): void {
  const code = parsePlatformModelRedeemDeepLink(value)
  if (!code) return
  pendingRedeemCodes.add(code)
  if (app.isReady()) showMainWindow()
  if (platformRedeemReady) void processPendingPlatformRedeemCodes()
}

async function processPendingPlatformRedeemCodes(): Promise<void> {
  if (!platformRedeemReady || !getAuthService().getCurrentUserId()) return
  for (const code of [...pendingRedeemCodes]) {
    pendingRedeemCodes.delete(code)
    try {
      const result = await getPlatformModelService().redeem(code)
      if (Notification.isSupported()) {
        new Notification({ title: '兑换成功', body: result.message }).show()
      }
    } catch (error) {
      if (Notification.isSupported()) {
        new Notification({
          title: '兑换未完成',
          body: error instanceof Error ? error.message : '请打开账户中心后手动兑换',
        }).show()
      }
    }
  }
}

if (shouldRegisterDefaultProtocolClient(process.env)) {
  if (is.dev && process.argv[1]) {
    app.setAsDefaultProtocolClient('spark-agent', process.execPath, [process.argv[1]])
  } else {
    app.setAsDefaultProtocolClient('spark-agent')
  }
}

app.on('open-url', (event, value) => {
  event.preventDefault()
  queuePlatformRedeemDeepLink(value)
})

const ownsSingleInstanceLock = installSingleInstanceLock(
  app,
  showMainWindow,
  (commandLine) => {
    const code = findPlatformModelRedeemCode(commandLine)
    if (code) queuePlatformRedeemDeepLink(`spark-agent://redeem?code=${encodeURIComponent(code)}`)
  },
  shouldEnableSingleInstanceLock(is.dev, process.env),
  () => requestApplicationQuit('single-instance-lock-not-owned'),
)

const initialRedeemCode = findPlatformModelRedeemCode(process.argv)
if (initialRedeemCode) pendingRedeemCodes.add(initialRedeemCode)

function isAppZoomShortcut(input: Electron.Input): 'in' | 'out' | 'reset' | null {
  const hasModifier = process.platform === 'darwin' ? input.meta : input.control
  if (!hasModifier || input.alt || input.isAutoRepeat) return null

  const key = input.key.toLowerCase()
  const code = input.code
  if (key === '+' || key === '=' || code === 'Equal' || code === 'NumpadAdd') return 'in'
  if (key === '-' || key === '_' || code === 'Minus' || code === 'NumpadSubtract') return 'out'
  if (key === '0' || code === 'Digit0' || code === 'Numpad0') return 'reset'
  return null
}

function setBrowserZoom(win: BrowserWindow, action: 'in' | 'out' | 'reset'): void {
  const current = Math.round(win.webContents.getZoomFactor() * 100)
  const requested =
    action === 'reset' ? 100 : current + (action === 'in' ? UI_ZOOM_STEP : -UI_ZOOM_STEP)
  const zoomPercent = Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, requested))
  win.webContents.setZoomFactor(zoomPercent / 100)

  const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(BROWSER_ZOOM_CHANGED_EVENT)}, { detail: ${JSON.stringify({ zoomPercent })} }))`
  win.webContents.executeJavaScript(script).catch((err) => {
    log.warn('Failed to persist browser zoom shortcut', err)
  })
}

function bindBrowserZoomShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    const action = isAppZoomShortcut(input)
    if (action == null) return
    event.preventDefault()
    setBrowserZoom(win, action)
  })
}

type PersistedUpdateSettings = {
  autoCheck?: boolean
  autoDownload?: boolean
  autoInstall?: boolean
  channel?: 'stable' | 'beta'
}

type PersistedGeneralSettings = {
  notifyNewVersion?: boolean
}

/** 清理旧版本保存过的 edu-server base URL，云端地址现在只能走内置默认值/环境变量。*/
function clearPersistedEduServerBaseUrl(): void {
  try {
    const existing = getSettingsService().get('cloudAuth', 'data') as
      | { eduServerBaseUrl?: string }
      | undefined
    const settings =
      existing != null && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {}
    if (!('eduServerBaseUrl' in settings)) return
    delete settings.eduServerBaseUrl
    getSettingsService().set('cloudAuth', 'data', settings)
  } catch (err) {
    log.warn(`Failed to clear persisted cloud auth base URL: ${String(err)}`)
  }
}

function getSettingsService(): SettingsService {
  return new SettingsService(new SettingsRepository(getDatabase()))
}

function readPersistedUpdateSettings(): PersistedUpdateSettings {
  const value = getSettingsService().get('updates', 'data')
  if (value == null || typeof value !== 'object') return {}
  return value as PersistedUpdateSettings
}

function readPersistedGeneralSettings(): PersistedGeneralSettings {
  const value = getSettingsService().get('general', 'data')
  if (value == null || typeof value !== 'object') return {}
  return value as PersistedGeneralSettings
}

function readPersistedLastCheckedAt(): string | null {
  const value = getSettingsService().get('updates', 'lastChecked')
  return typeof value === 'string' && value.length > 0 ? value : null
}

function persistLastCheckedAt(iso: string): void {
  getSettingsService().set('updates', 'lastChecked', iso)
}

function shouldNotifyNewVersion(): boolean {
  const general = readPersistedGeneralSettings()
  return general.notifyNewVersion !== false
}

function showUpdateNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title,
    body,
    silent: true,
  })
  notification.on('click', () => {
    showMainWindow()
  })
  notification.show()
}

async function promptForDownloadedUpdate(info: UpdateInfo, autoInstall: boolean): Promise<void> {
  if (!shouldNotifyNewVersion()) return
  if (downloadedPromptVersion === info.version) return
  downloadedPromptVersion = info.version

  showUpdateNotification(
    '更新已下载完成',
    process.platform === 'darwin'
      ? `SparkWork v${info.version} 安装镜像已下载完成`
      : autoInstall
        ? `SparkWork v${info.version} 已准备好，退出应用时会自动启动安装器`
        : `SparkWork v${info.version} 安装包已下载完成`,
  )

  const mainWindow = getMainWindow()
  if (mainWindow == null || mainWindow.isDestroyed()) return

  const installButtonLabel = process.platform === 'darwin' ? '打开安装镜像' : '安装更新'
  const detail =
    process.platform === 'darwin'
      ? '现在打开 dmg 安装镜像，随后请将镜像中的应用拖到 Applications 并替换现有版本。'
      : autoInstall
        ? '现在启动安装器，或稍后退出应用时自动启动安装器。'
        : '现在启动安装器，或稍后手动安装。'

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '更新已就绪',
    message: `SparkWork v${info.version} 安装包已下载完成`,
    detail,
    buttons:
      process.platform === 'darwin'
        ? [installButtonLabel, '稍后']
        : autoInstall
          ? [installButtonLabel, '稍后（退出时自动启动安装器）']
          : [installButtonLabel, '稍后'],
    defaultId: 0,
    cancelId: 1,
  })
  if (result.response === 0) {
    getUpdateService().installAndRestart()
  }
}

function createTray(): void {
  if (tray != null) return

  const iconPath = getResourcePath(
    process.platform === 'darwin' ? 'trayTemplate.png' : 'trayIconWin.png',
  )
  let image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    image = image.resize({ width: 18, height: 18, quality: 'best' })
    image.setTemplateImage(true)
  } else if (process.platform === 'win32') {
    image = image.resize({ width: 24, height: 24, quality: 'best' })
  } else {
    image = image.resize({ width: 22, height: 22, quality: 'best' })
  }

  tray = new Tray(image)
  attachAppUnreadBadgeTray(tray)
  const computerUse = getComputerUseServices()
  computerControlTray = new ComputerControlTrayService(
    computerUse.sessions,
    computerUse.broker,
    computerUse.coordinator,
  )
  unsubscribeComputerControlStatus ??= computerUse.sessions.subscribeStatus(
    scheduleComputerControlTrayRefresh,
  )
  refreshTrayMenu().catch((err) => log.warn('Failed to refresh tray menu on init', err))
  tray.on('click', () => {
    // 每次点击前刷新菜单（最近会话变化），再展示主窗口
    refreshTrayMenu().catch((err) => log.warn('Failed to refresh tray menu on click', err))
    showMainWindow()
  })
}

/**
 * 重新构建托盘右键菜单。
 *
 * 最近会话来自 SessionService（与 sidebar 共享同一实例）；点击时通过 stream 事件
 * 通知渲染端切换/新建会话，主进程仅负责显示主窗口。
 */
async function refreshTrayMenu(): Promise<void> {
  if (tray == null) return

  let recentItems: Array<{
    id: string
    title: string
    updatedAt: string
    status: string
    messageCount: number
  }> = []
  try {
    recentItems = await getRecentSessionsForTray(8)
  } catch (err) {
    log.warn('Failed to list recent sessions for tray menu', err)
  }

  const recentSubmenu =
    recentItems.length === 0
      ? [{ label: '（暂无会话）', enabled: false }]
      : recentItems.map((item) => ({
          label: formatSessionLabel(item.title, item.status, item.messageCount),
          click: () => {
            showMainWindow()
            sendToMainWindow('stream:tray:open-session', { sessionId: item.id })
          },
        }))

  const canvasWindowAvailable = getCanvasWindowService().getWindow() != null
  const computerControlSubmenu = buildComputerControlSubmenu()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: showMainWindow },
      {
        label: '打开画布',
        visible: canvasWindowAvailable,
        click: () => {
          getCanvasWindowService().focus()
        },
      },
      { type: 'separator' },
      {
        label: '新建会话',
        click: () => {
          showMainWindow()
          sendToMainWindow('stream:tray:new-session', {})
        },
      },
      {
        label: '最近会话',
        submenu: recentSubmenu,
      },
      {
        label: 'Computer Use',
        submenu: computerControlSubmenu,
      },
      { type: 'separator' },
      {
        label: '打开内部控制台',
        click: () => {
          const win = getPreferredAppWindow()
          if (win == null) {
            showMainWindow()
            return
          }
          revealAppWindow(win)
          win.webContents.openDevTools({ mode: 'detach' })
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => requestApplicationQuit('tray-menu'),
      },
    ]),
  )
}

function scheduleComputerControlTrayRefresh(): void {
  if (computerControlTrayRefreshTimer != null) return
  computerControlTrayRefreshTimer = setTimeout(() => {
    computerControlTrayRefreshTimer = null
    void refreshTrayMenu().catch((error) =>
      log.warn('Failed to refresh Computer Use tray status', error),
    )
  }, 100)
  computerControlTrayRefreshTimer.unref()
}

function buildComputerControlSubmenu(): MenuItemConstructorOptions[] {
  const sessions = computerControlTray?.list() ?? []
  if (sessions.length === 0) return [{ label: '（未在控制）', enabled: false }]
  return sessions.map((session) => ({
    label: `正在控制：${session.label} · ${formatComputerStatus(session.status)}`,
    submenu: [
      {
        label: '暂停 Agent',
        enabled: session.canPause,
        click: () =>
          runComputerControlAction('pause', () =>
            computerControlTray?.pause(session.computerSessionId),
          ),
      },
      {
        label: '立即接管',
        enabled: session.canPause,
        click: () =>
          runComputerControlAction('takeover', () =>
            computerControlTray?.takeover(session.computerSessionId),
          ),
      },
      {
        label: '停止控制',
        click: () =>
          runComputerControlAction('stop', () =>
            computerControlTray?.stop(session.computerSessionId),
          ),
      },
    ],
  }))
}

function runComputerControlAction(
  action: string,
  operation: () => Promise<void> | undefined,
): void {
  void Promise.resolve(operation())
    .then(() => refreshTrayMenu())
    .catch((error) => log.warn(`Computer Use tray ${action} failed`, error))
}

function formatComputerStatus(status: string): string {
  switch (status) {
    case 'paused':
    case 'handoff_required':
      return '已暂停'
    case 'waiting_approval':
      return '等待确认'
    case 'verifying':
      return '正在验证'
    default:
      return '运行中'
  }
}

function formatSessionLabel(title: string, status: string, messageCount: number): string {
  const safeTitle = (title?.trim() || '新会话').slice(0, 32)
  const statusTag = status === 'running' ? ' ●' : status === 'error' ? ' ✕' : ''
  const countTag = messageCount > 0 ? ` · ${messageCount}条` : ''
  return `${safeTitle}${statusTag}${countTag}`
}

const SPLASH_BG_LIGHT = '#fdfdfc'
const SPLASH_BG_DARK = '#1f1f1f'

/** 当前系统深浅对应的窗口底色（Win/Linux 纯色兜底用）。 */
function pickWindowBg(): string {
  return nativeTheme.shouldUseDarkColors ? SPLASH_BG_DARK : SPLASH_BG_LIGHT
}

/** 平台分流的 BrowserWindow 毛玻璃/底色选项。 */
function buildNativeSplashOptions(isDarwin: boolean): {
  transparent?: boolean
  vibrancy?:
    | 'titlebar'
    | 'selection'
    | 'menu'
    | 'popover'
    | 'sidebar'
    | 'header'
    | 'sheet'
    | 'window'
    | 'hud'
    | 'fullscreen-ui'
    | 'tooltip'
    | 'content'
    | 'under-window'
    | 'under-page'
  visualEffectState?: 'followWindow' | 'active' | 'inactive'
  backgroundColor?: string
  backgroundMaterial?: 'auto' | 'none' | 'mica' | 'acrylic' | 'tabbed'
} {
  if (isDarwin) {
    // macOS：交给 NSVisualEffectView，渲染层 .boot-splash 半透明即可透出 vibrancy。
    return {
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    }
  }
  if (process.platform === 'win32') {
    // Windows 11 acrylic（10 自动降级为 backgroundColor 纯色，无副作用）。
    return {
      backgroundColor: pickWindowBg(),
      backgroundMaterial: 'acrylic',
    }
  }
  // Linux：无原生模糊，纯色兜底。
  return { backgroundColor: pickWindowBg() }
}

function createWindow(): BrowserWindow {
  const iconPath = getResourcePath(process.platform === 'win32' ? 'taskbarIcon.png' : 'icon.png')

  const isDarwin = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    title: 'SparkWork',
    width: 1310,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    hasShadow: true,
    ...buildWindowChromeOptions(process.platform),
    icon: iconPath,
    // 启动页原生毛玻璃 / 深浅底色（平台分流，见 buildNativeSplashOptions）。
    ...buildNativeSplashOptions(isDarwin),
    webPreferences: {
      // ADR-003 安全约束：三项强制配置，不可协商
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // 必须：隔离 preload 和 renderer 的 JS 上下文
      nodeIntegration: false, // 必须：renderer 无法直接访问 Node.js API
      sandbox: true, // 必须：renderer 进程沙盒化（contextBridge 在 sandbox 下完全可用）
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true, // 侧边栏嵌入式浏览器
    },
  })

  bindBrowserZoomShortcuts(mainWindow)

  // 系统深浅模式在运行时切换时，实时刷新 Win/Linux 的窗口纯色底色，
  // 让启动页（以及后续 React 挂载前的首帧）始终跟随系统。
  // macOS vibrancy 原生跟随系统，无需此处干预。
  nativeTheme.on('updated', () => {
    if (process.platform === 'win32' || process.platform === 'linux') {
      mainWindow.setBackgroundColor(pickWindowBg())
    }
  })

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // 在系统默认浏览器中打开外部链接，不在 Electron 窗口内导航
  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternalUrlSafely(details.url, (url) => shell.openExternal(url))
    return { action: 'deny' }
  })

  // 内嵌浏览器保留任意站点与调试能力，但远程页面不能通过标签属性注入 preload
  // 或重新开启 Node。这样不缩小网页能力，同时隔离主进程与本地文件权限。
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isWebviewSourceAllowed(params.src ?? '')) {
      log.warn(`Blocked unsafe webview source: ${(params.src ?? '').slice(0, 200)}`)
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    delete (webPreferences as typeof webPreferences & { preloadURL?: string }).preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })

  // 开发模式：加载 Vite dev server；生产模式：加载打包后的 HTML
  if (is.dev && process.env['ELECTRON_RENDERER_URL'] != null) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 保存引用到 windows 模块
  setMainWindow(mainWindow)

  return mainWindow
}

/**
 * 推送 Playwright 完整性状态到渲染进程。
 * 抽取为独立函数避免重复代码。
 */
function pushPlaywrightStatus(): void {
  try {
    const integrity = detectPlaywrightIntegrity()
    const registration = readPlaywrightRegistration(getDatabase())
    sendToMainWindow('stream:playwright:status', {
      mcpInstalled: integrity.mcpInstalled,
      mcpVersion: integrity.mcpVersion,
      playwrightInstalled: integrity.playwrightInstalled,
      browserReady: integrity.browserReady,
      browserSource: integrity.browserSource,
      mcpRegistered: registration.registered,
      mcpEnabled: registration.enabled,
      mode: registration.mode,
      viewOpen: false,
      cdpEndpoint: null,
      lastError: integrity.lastError,
    })
  } catch (err) {
    log.warn(`Failed to push Playwright status: ${String(err)}`)
  }
}

/**
 * 初始化主进程核心服务
 *
 * 启动顺序：
 *   1. 初始化 SQLite 数据库（migration + WAL）
 *   2. 注册 IPC handlers
 *   3. 创建主窗口
 */
async function initializeApp(): Promise<void> {
  log.info('Initializing Spark Agent...')

  // Codex native runtime is managed outside the application bundle. Set the path
  // before IPC/session services are initialized so the first Codex turn can use it.
  configureCodexRuntimeEnvironment()

  // 0a. Configure bundled chromium env (must be BEFORE any playwright MCP subprocess starts)
  try {
    ensureBundledBrowserEnv()
  } catch (err) {
    log.warn(`Failed to set up bundled browser env (non-fatal): ${String(err)}`)
  }

  // 0. 修复 PATH（必须在所有子进程创建之前执行）
  // Electron 从桌面启动时继承的是 Explorer 环境，缺少 node/python 等 PATH 条目
  try {
    await initializeShellEnvironment()
  } catch (err) {
    log.warn(`Shell environment initialization failed (non-fatal): ${String(err)}`)
  }

  // 1. 初始化数据库
  const dbPath = getDatabasePath()
  // 消息通知轮询服务（auth 初始化完成后赋值启动；提前声明供数据库 try 块内注册的退出清理引用）
  let notificationService: NotificationService | null = null
  let sparkCliBridge: SparkCliBridge | null = null
  let customToolsRuntime: CustomToolsRuntimeService | null = null
  log.info(`Database path: ${dbPath}`)
  // 「继承安装版数据」：设置页 stage 的快照在此次启动、建库之前替换当前库。
  // 失败仅告警并清除 marker，用现有数据库继续启动，绝不阻塞。
  try {
    const inherited = await applyPendingProductionDbInheritance({
      databasePath: dbPath,
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
    })
    if (inherited.applied) {
      log.warn(`Inherited production db applied; previous db at ${inherited.backupDirectory ?? '?'}`)
    }
  } catch (err) {
    log.warn(`Apply pending inherited db failed (non-fatal): ${String(err)}`)
  }
  let databaseBackup: Awaited<ReturnType<typeof ensurePreMigrationBackup>>
  try {
    databaseBackup = await ensurePreMigrationBackup({
      databasePath: dbPath,
      backupRoot: join(app.getPath('userData'), 'backups', 'database'),
      appVersion: app.getVersion(),
    })
  } catch (error) {
    log.error(`Failed to create pre-migration database backup: ${String(error)}`)
    dialog.showErrorBox(
      'SparkWork 无法创建升级恢复点',
      '现有数据库无法安全备份，应用将退出且不会执行迁移。请检查磁盘空间和应用数据目录权限后重试。',
    )
    throw error
  }

  try {
    const { createDatabase } = await import('@spark/storage')
    const migrationsDir = is.dev ? undefined : join(process.resourcesPath, 'migrations')
    const db = createDatabase(dbPath, migrationsDir)
    setDatabaseInstance(db)
    initializeComputerUseServices(db, {
      shortcutRegistrar: globalShortcut,
      onKillSwitchError: (error) => {
        log.error(`Computer Use kill switch failed: ${String(error)}`)
      },
    })
    const packagedSmoke = await runComputerUsePackagedSmoke({
      services: getComputerUseServices(),
    })
    if (packagedSmoke.requested) {
      await disposeComputerUseServices()
      closeDatabase()
      requestApplicationExit('computer-use-packaged-smoke', packagedSmoke.exitCode)
      return
    }
    const backgroundMaintenanceWorker = startBackgroundMaintenanceWorker(dbPath)
    customToolsRuntime = new CustomToolsRuntimeService(db, getMcpService())
    const snapshotVaultMaintenance = startSnapshotVaultMaintenance(db)
    // 临时媒体目录（粘贴/预览副本）周期清理：按 mtime 保留 7 天，6 小时一跑。
    const tempMediaFilesMaintenance = new TempMediaFilesMaintenance()
    tempMediaFilesMaintenance.start()
    app.on('before-quit', () => {
      tempMediaFilesMaintenance.stop()
    })
    log.info('Database initialized successfully')

    // 061 会话搜索 FTS 索引的存量事件回填（幂等）。
    // 迁移只建表，回填需要 JS 侧 segmentCjk 分词，必须在代码侧分批做。
    // 这里 fire-and-forget：用户首次启动后即可用历史会话搜索，不阻塞主流程。
    // 失败/表不存在都不影响应用启动——searchByContent 自带 LIKE 兜底。
    void (async () => {
      try {
        const { EventRepository } = await import('@spark/storage')
        const repo = new EventRepository(db)
        const processed = await repo.backfillSearchIndexIfNeeded()
        if (processed > 0) {
          log.info(`Session search FTS backfill completed: ${processed} events indexed`)
        }
      } catch (err) {
        log.warn('Session search FTS backfill failed (LIKE fallback will be used)', {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })()

    // 关闭数据库连接在应用退出时
    app.on(
      'before-quit',
      createAppShutdownCoordinator({
        app,
        disposeSessionService: disposeSessionServiceForShutdown,
        cleanup: () =>
          runShutdownCleanupSteps(
            [
              {
                name: 'terminals',
                run: () => getTerminalService().disposeAll(),
              },
              {
                name: 'file watchers',
                run: () => getFileWatcherService().stopAll(),
              },
              {
                name: 'update service',
                run: () => getUpdateService().destroy(),
              },
              {
                name: 'background maintenance worker',
                run: () => backgroundMaintenanceWorker.dispose(),
              },
              {
                name: 'snapshot vault maintenance',
                run: () => snapshotVaultMaintenance.dispose(),
              },
              {
                name: 'notification polling',
                run: () => notificationService?.dispose() ?? Promise.resolve(),
              },
              {
                name: 'computer use agent bridge',
                run: () => disposeComputerUseMcpProvider(),
              },
              {
                name: 'computer use services',
                run: () => disposeComputerUseServices(),
              },
              {
                name: 'spark CLI provider bridge',
                run: () => sparkCliBridge?.stop() ?? Promise.resolve(),
              },
              {
                name: 'custom tools runtime',
                run: () => customToolsRuntime?.stop() ?? Promise.resolve(),
              },
              {
                name: 'database',
                run: () => closeDatabase(),
              },
            ],
            (stepName, err) => {
              log.warn(`Failed to clean up ${stepName} on quit: ${String(err)}`)
            },
          ),
        onError: (err) => {
          log.warn(`Application shutdown cleanup failed: ${String(err)}`)
        },
      }),
    )
  } catch (err) {
    log.error(`Database initialization failed: ${String(err)}`)
    let restored = false
    if (databaseBackup?.createdThisStartup === true) {
      try {
        await restoreDatabaseBackup(databaseBackup)
        restored = true
        log.warn(`Database restored from pre-migration backup: ${databaseBackup.directory}`)
      } catch (restoreError) {
        log.error(`Database backup restore failed: ${String(restoreError)}`)
      }
    }
    dialog.showErrorBox(
      'SparkWork 数据库启动失败',
      restored
        ? `升级前数据已自动恢复。应用将退出，请保留以下恢复点并联系支持：\n${databaseBackup!.directory}`
        : '数据库无法安全初始化，应用将退出以避免继续写入或扩大损坏。请保留应用数据后联系支持。',
    )
    throw err
  }

  // 快照协议按 snapshot ID 查询数据库并解密，必须在数据库初始化后、窗口创建前注册。
  registerSnapshotProtocol()

  // 2. 注册 IPC handlers
  registerAllIpcHandlers()
  registerAppUnreadBadgeIpc()
  registerBrowserPanelDevtoolsIpc()

  // 2.05 初始化 Cloud Auth（对接 spark-edugen/edu-server）
  // 默认 base URL：生产环境 https://spark.yiqibyte.com/；本地开发可通过
  // 环境变量 SPARK_EDUGEN_BASE_URL 覆盖。
  try {
    initAuthService({
      defaultBaseUrl: process.env.SPARK_EDUGEN_BASE_URL?.trim() || 'https://spark.yiqibyte.com/',
      keytarService: resolveAuthKeytarService(process.env),
      requestTimeoutMs: 30_000,
    })
    await getAuthService().start({
      // 全新安装没有任何旧会话可迁移，不应为了探测不存在的条目访问系统钥匙串。
      // 已有数据库的升级安装仍允许读取一次旧 keytar 会话并写入加密备份。
      allowLegacyKeytarFallback: databaseBackup != null,
    })
    getPlatformModelService()
    getAuthService().addLoginHook(async () => processPendingPlatformRedeemCodes())
    platformRedeemReady = true
    await processPendingPlatformRedeemCodes()
    clearPersistedEduServerBaseUrl()
    log.info('Cloud auth service started')
  } catch (err) {
    log.error(`Cloud auth service init failed: ${String(err)}`)
  }

  // 终端与桌面端共享同一份 Provider 权威数据。必须等 IPC 初始化完成（凭据 vault
  // 已注入）及平台凭据恢复器就绪后再发布 bridge descriptor，避免 CLI 抢跑时回退到
  // 直接 Keychain 读取或把托管渠道误判为缺少凭据。
  try {
    const providerRepository = new ProviderProfileRepository(getDatabase())
    const providerService = new ProviderService(providerRepository)
    sparkCliBridge = await startSparkCliBridge({
      listProviders: () => providerService.listProviders(),
      resolveCredential: async (providerId) => {
        const provider = providerRepository.get(providerId)
        if (provider == null) throw new Error(`Provider not found: ${providerId}`)
        return resolveProviderApiKey(provider)
      },
    })
    log.info('Spark CLI provider bridge started')
  } catch (error) {
    log.warn(`Spark CLI provider bridge failed to start: ${String(error)}`)
  }

  // 2.06 消息通知（站内信 + 平台公告）：注册 IPC 并启动 60s 轮询。
  // 依赖 AuthService 的 EduServerClient 与登录态，必须在 auth 初始化后启动。
  try {
    notificationService = initNotificationService()
    notificationService.start()
    registerNotificationIpc()
    log.info('Notification service started')
  } catch (err) {
    log.error(`Notification service init failed: ${String(err)}`)
  }

  // 2.1 启动定时任务调度器（使用 IPC 层的同一个 ScheduledTaskService 实例）
  try {
    const { getScheduledTaskService } = await import('./ipc/index.js')
    const taskService = getScheduledTaskService()
    taskService.startScheduler()
    log.info('Scheduled task scheduler started')
    app.on('before-quit', () => {
      taskService.stopScheduler()
    })
  } catch (err) {
    log.warn(`Failed to start scheduled task scheduler: ${String(err)}`)
  }

  // 2.5 确保无项目会话目录已初始化（避免首次启动时目录不存在导致错误）
  await ensureNoProjectDirectoryExists()

  // 3. 创建主窗口
  createWindow()
  createTray()

  // 3.1 安装内置浏览器 webview 的 popup 路由（window.open → 新 tab）
  installWebviewPopupRouter()

  // 3.5 注册 Playwright MCP（不在启动时打开嵌入式视图 / 不复用 Electron CDP）
  //
  // 之前的设计是启动隐藏自动化窗口并把 Electron CDP 注入 Playwright MCP，
  // 但 Electron 会同时暴露主窗口、侧边栏 webview、自动化窗口等多个 target，
  // Playwright 经常挑错目标导致 agent 无法控制浏览器。现在 Playwright MCP
  // 直接拉起自己的 Chromium；应用内可见窗口由 spark_browser 内置 MCP 提供。
  try {
    await customToolsRuntime?.start()
  } catch (err) {
    log.warn(`Failed to start custom tools runtime: ${String(err)}`)
  }

  try {
    ensurePlaywrightRegistered(getDatabase(), {
      force: true,
      cdpEndpoint: null,
    })
    getSubAppBrowserService().bindLifecycle()
  } catch (err) {
    log.warn(`Failed to register Playwright MCP: ${String(err)}`)
  }

  // 3.6 启动所有已启用的用户/项目级 MCP 服务器(Managed 域除外 — Playwright 走
  // ensurePlaywrightRegistered 路径,启动后会被 startAllEnabled 一起拉起)。
  // 必须放在 Playwright 注册之后,否则重启后已启用的 MCP 不会自动恢复连接。
  try {
    await getMcpService().startAllEnabled()
  } catch (err) {
    log.warn(`Failed to start enabled MCP servers: ${String(err)}`)
  }

  // 3.7 初始化技能系统：自动软链宿主机 Claude/Codex 技能、登记内置、
  //     重建原生托管插件目录，并注入给 SessionService。
  try {
    const { initializeAppSkills } = await import('./ipc/index.js')
    initializeAppSkills()
  } catch (err) {
    log.warn(`Failed to initialize app skills: ${String(err)}`)
  }

  // 4. 初始化自动更新服务
  const updateService = getUpdateService()
  updateService.initialize({
    preferences: readPersistedUpdateSettings(),
    lastCheckedAt: readPersistedLastCheckedAt(),
    onLastCheckedChange: persistLastCheckedAt,
    onUpdateDownloaded: (info, preferences) => {
      void promptForDownloadedUpdate(info, preferences.autoInstall)
    },
    onRequestQuit: () => {
      // 安装更新前必须置位退出守卫，否则窗口 close 处理器会 preventDefault，
      // 导致 app.quit() 无法真正退出，旧实例残留使安装无法进行。
      requestApplicationQuit('update-install')
    },
    handler: (status: UpdateStatus) => {
      // 推送状态变化到渲染进程
      sendToMainWindow('stream:update:status', status)

      // 根据状态推送特定事件
      switch (status.state) {
        case 'available':
          if (status.updateInfo != null) {
            sendToMainWindow('stream:update:available', status.updateInfo)
          }
          break
        case 'downloading':
          if (status.progress != null) {
            sendToMainWindow('stream:update:progress', status.progress)
          }
          break
        case 'downloaded':
          if (status.updateInfo != null) {
            sendToMainWindow('stream:update:downloaded', status.updateInfo)
          }
          break
      }
    },
  })

  // 5. SDK 完整性自检（延迟 5 秒，确保窗口已加载完成）
  setTimeout(() => {
    void checkSdkIntegrity({ checkLatest: false })
      .then((result) => {
        log.info(
          `SDK integrity check completed: ${result.sdks.map((s) => `${s.packageName}=${s.installed ? s.installedVersion : 'missing'}`).join(', ')}`,
        )
        sendToMainWindow('stream:sdk:integrity', result)
      })
      .catch((err) => {
        log.warn(`SDK integrity check failed: ${String(err)}`)
      })
  }, 5_000)

  // 6. 推送运行时环境状态到渲染进程（延迟 3 秒）
  setTimeout(() => {
    void getShellEnvironmentStatus()
      .then((status) => {
        sendToMainWindow('stream:env:status', status)
      })
      .catch((err) => {
        log.warn(`Failed to push shell environment status: ${String(err)}`)
      })
  }, 3_000)

  // 6.5 字体不再打进安装包：启动后后台检查并下载/升级。
  // 下载失败只回退系统字体，设置 → 外观中可手动重试。
  setTimeout(() => {
    void updateManagedFontAssetsInBackground().then((result) => {
      if (!result.success) log.warn(`Managed font update skipped: ${result.message}`)
    })
  }, 2_000)

  // 7. 检测 Playwright 完整性并推送状态（延迟 6 秒，与 SDK 自检错开）
  // 启动阶段只检测，不隐式下载 Chromium；下载由 Agent 按需恢复或用户在完整性页手动触发。
  setTimeout(() => {
    pushPlaywrightStatus()
  }, 6_000)

  // 8. 检测 FFmpeg 完整性并推送状态（延迟 8 秒，排在 Playwright 之后）
  //    仅检测不自动下载——ffmpeg 按需安装（首次使用视频工作台时提示）
  setTimeout(() => {
    void detectFfmpegIntegrity()
      .then((state) => {
        sendToMainWindow('stream:ffmpeg:status', {
          ffmpegReady: state.ffmpegReady,
          ffmpegSource: state.ffmpegSource,
          ffmpegVersion: state.ffmpegVersion,
          ffprobeReady: state.ffprobeReady,
          binaryPath: state.binaryPath,
          lastError: state.lastError,
        })
      })
      .catch((err) => {
        log.warn(`FFmpeg integrity check failed: ${String(err)}`)
      })
  }, 8_000)

  // 9. 检查可选 Office / 深度资源。只读取小型 manifest，不自动下载大组件；
  // renderer 根据缺失项和用户的提示冷却设置决定是否展示选择弹窗。
  setTimeout(() => {
    void getOptionalCapabilityManager()
      .check(false)
      .then((snapshot) => {
        sendToMainWindow('stream:optional-capability:snapshot', snapshot)
      })
      .catch((err) => {
        log.warn(`Optional capability check failed: ${String(err)}`)
      })
  }, 9_000)

  log.info('Spark Agent initialized')
}

/**
 * 设置应用菜单。
 *
 * macOS 自带默认菜单（已含 ⌘⌥I 切换 DevTools），无需覆盖；
 * Windows / Linux 在无边框窗口 + 未设置菜单的情况下，F12 / Ctrl+R 等开发者
 * 快捷键不可用（Chromium 的默认 DevTools 快捷键依赖应用菜单 role）。这里
 * 补一个最小菜单：F12 切换 DevTools、Ctrl+R 刷新，同时附带缩放/全屏。
 * `autoHideMenuBar: true` 让菜单栏默认隐藏，按 Alt 才显示，accelerator 始终生效。
 */
function setupApplicationMenu(): void {
  if (process.platform === 'darwin') return

  const zoomFocusedWindow = (action: 'in' | 'out' | 'reset') => {
    const win = BrowserWindow.getFocusedWindow() ?? getPreferredAppWindow()
    if (win != null) setBrowserZoom(win, action)
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '视图',
      submenu: [
        { role: 'reload', accelerator: 'Ctrl+R' },
        { role: 'toggleDevTools', accelerator: 'F12' },
        { type: 'separator' },
        { label: '重置缩放', click: () => zoomFocusedWindow('reset') },
        { label: '放大', click: () => zoomFocusedWindow('in') },
        { label: '缩小', click: () => zoomFocusedWindow('out') },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: 'F11' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (ownsSingleInstanceLock) {
  // Electron 生命周期：所有窗口就绪时初始化应用
  app.whenReady().then(() => {
    // 必须在 createWindow() 之前注册协议 handler，
    // 否则首次加载的 HTML 里的 <img src="safe-file://..."> 会得到 ERR_UNKNOWN_URL_SCHEME
    registerSafeFileProtocol()
    registerCapabilityAssetProtocol()

    // 注册应用菜单，使 F12 切换 DevTools 等快捷键生效
    setupApplicationMenu()

    initializeApp().catch((err) => {
      log.error(`Failed to initialize app: ${String(err)}`)
      requestApplicationQuit('initialization-failed')
    })

    // macOS：已有可见窗口时交给系统保持最近使用窗口；仅所有窗口都不可见时，
    // 恢复应用内最后聚焦的窗口，并在没有可用窗口时回退到主窗口。
    app.on('activate', (_event, hasVisibleWindows) => {
      if (hasVisibleWindows) return
      showPreferredAppWindow()
    })
  })

  // Windows / Linux：所有窗口关闭时退出应用
  // macOS：由 'activate' 事件处理，不在此退出
  app.on('window-all-closed', () => {
    log.warn(`[quit-forensics] window-all-closed; isQuitting=${isQuitting}`)
    if (process.platform !== 'darwin' && isQuitting) {
      requestApplicationQuit(requestedQuitReason ?? 'window-all-closed')
    }
  })
}

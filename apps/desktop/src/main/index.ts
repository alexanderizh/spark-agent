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

import { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, nativeTheme, shell } from 'electron'
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
app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar,OverlayScrollbarFlashAfterAnyScrollUpdate,OverlayScrollbarFlashWhenMouseEnter,OverlayScrollbarWinStyle')

import { is } from '@electron-toolkit/utils'
import { getDatabasePath, setDatabaseInstance, closeDatabase } from './db.js'
import { startBackgroundMaintenanceWorker } from './services/background-maintenance-worker.js'
import { registerAllIpcHandlers, ensureNoProjectDirectoryExists } from './ipc/index.js'
import { setMainWindow, sendToMainWindow } from './windows/index.js'
import { getFileWatcherService } from './services/FileWatcherService.js'
import { getTerminalService } from './services/TerminalService.js'
import { getUpdateService } from './services/UpdateService.js'
import { checkSdkIntegrity } from './services/SdkIntegrityService.js'
import { initializeShellEnvironment, getShellEnvironmentStatus } from './services/ShellEnvironmentService.js'
import { ensureRegistered as ensurePlaywrightRegistered, readRegistration as readPlaywrightRegistration } from './services/PlaywrightMcpRegistration.js'
import { detectIntegrity as detectPlaywrightIntegrity, installBrowser as autoInstallBrowser, invalidateCache as invalidatePlaywrightCache } from './services/PlaywrightIntegrityService.js'
import { getInternalBrowserService } from './services/InternalBrowserService.js'
import { ensureBundledBrowserEnv, resetBundledBrowsersPathCache } from './services/PlaywrightEnvironment.js'
import { detectFfmpegIntegrity } from './services/FfmpegIntegrityService.js'
import {
  registerSafeFileProtocol,
  registerSafeFileSchemes,
} from './services/SafeFileProtocol.js'
import { installSingleInstanceLock } from './single-instance.js'
import { getDatabase } from './db.js'
import { getRecentSessionsForTray } from './ipc/index.js'
import { createLogger } from '@spark/shared'
import type { UpdateInfo, UpdateStatus } from '@spark/protocol'
import { SettingsService } from '@spark/agent-runtime'
import { SettingsRepository } from '@spark/storage'
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

const log = createLogger('main')
let tray: Tray | null = null
let isQuitting = false
let downloadedPromptVersion: string | null = null
const BROWSER_ZOOM_CHANGED_EVENT = 'spark:browser-zoom-changed'
const UI_ZOOM_MIN = 80
const UI_ZOOM_MAX = 150
const UI_ZOOM_STEP = 5

registerEmergencySessionShutdown(process, disposeSessionServiceForShutdown)

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
})

// ─── Custom protocol registration ───────────────────────────────────────────
// `safe-file://` 让渲染进程能读取 userData 下的本地图片（生成的图、附件等），
// 必须在 app.whenReady() 之前调用，否则特权声明会失效。
registerSafeFileSchemes()

function getResourcePath(fileName: string): string {
  return is.dev
    ? join(__dirname, '../../resources', fileName)
    : join(process.resourcesPath, fileName)
}

function showMainWindow(): void {
  const existing = BrowserWindow.getAllWindows()[0]
  if (existing != null) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  createWindow()
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

if (is.dev && process.argv[1]) {
  app.setAsDefaultProtocolClient('spark-agent', process.execPath, [process.argv[1]])
} else {
  app.setAsDefaultProtocolClient('spark-agent')
}

app.on('open-url', (event, value) => {
  event.preventDefault()
  queuePlatformRedeemDeepLink(value)
})

const ownsSingleInstanceLock = installSingleInstanceLock(app, showMainWindow, (commandLine) => {
  const code = findPlatformModelRedeemCode(commandLine)
  if (code) queuePlatformRedeemDeepLink(`spark-agent://redeem?code=${encodeURIComponent(code)}`)
}, !is.dev)

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
  const requested = action === 'reset'
    ? 100
    : current + (action === 'in' ? UI_ZOOM_STEP : -UI_ZOOM_STEP)
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

  const mainWindow = BrowserWindow.getAllWindows()[0] ?? null
  if (mainWindow == null || mainWindow.isDestroyed()) return

  const installButtonLabel =
    process.platform === 'darwin'
      ? '打开安装镜像'
      : '安装更新'
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

  const iconPath = getResourcePath(process.platform === 'darwin' ? 'trayTemplate.png' : 'trayIconWin.png')
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
  tray.setToolTip('SparkWork')
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

  let recentItems: Array<{ id: string; title: string; updatedAt: string; status: string; messageCount: number }> = []
  try {
    recentItems = await getRecentSessionsForTray(8)
  } catch (err) {
    log.warn('Failed to list recent sessions for tray menu', err)
  }

  const recentSubmenu = recentItems.length === 0
    ? [{ label: '（暂无会话）', enabled: false }]
    : recentItems.map((item) => ({
        label: formatSessionLabel(item.title, item.status, item.messageCount),
        click: () => {
          showMainWindow()
          sendToMainWindow('stream:tray:open-session', { sessionId: item.id })
        },
      }))

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 SparkWork', click: showMainWindow },
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
    { type: 'separator' },
    {
      label: '打开内部控制台',
      click: () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win == null) {
          showMainWindow()
          return
        }
        win.show()
        win.focus()
        win.webContents.openDevTools({ mode: 'detach' })
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
}

function formatSessionLabel(title: string, status: string, messageCount: number): string {
  const safeTitle = (title?.trim() || '新会话').slice(0, 32)
  const statusTag = status === 'running' ? ' ●' : status === 'error' ? ' ✕' : ''
  const countTag = messageCount > 0 ? ` · ${messageCount}条` : ''
  return `${safeTitle}${statusTag}${countTag}`
}

/**
 * 创建主窗口
 *
 * 安全配置说明：
 *   - contextIsolation: true — preload 和 renderer 的 JS 上下文完全隔离
 *   - nodeIntegration: false — renderer 无法直接访问 Node.js API
 *   - sandbox: true — renderer 进程运行在沙盒中，只能通过 contextBridge 暴露的 API 与主进程通信
 *   - webSecurity: true — 启用同源策略
 *   - allowRunningInsecureContent: false — 禁止加载 HTTP 资源
 */
// ─── 启动期窗口原生毛玻璃 / 深浅底色 ─────────────────────────────────────────
// 启动页（GateAwareShell → .boot-splash）需要跟随系统深浅模式，并叠加原生毛玻璃
// 效果。三个平台对透明性的要求不一致，必须分流配置：
//   - macOS：vibrancy 由 NSVisualEffectView 提供，原生跟随系统深浅。
//            需要 transparent: true 且不要 backgroundColor，否则会盖住模糊层。
//   - Windows 11：backgroundMaterial: 'acrylic' 需要【不透明】窗口，
//            配合 backgroundColor 给纯色兜底；Windows 10 不识别 acrylic，自动降级为纯色。
//   - Linux：无原生模糊，仅按 nativeTheme 深浅给纯色 backgroundColor。
// nativeTheme.shouldUseDarkColors 在窗口创建时即确定，保证首帧底色与系统一致。
const SPLASH_BG_LIGHT = '#fdfdfc'
const SPLASH_BG_DARK = '#1f1f1f'

/** 当前系统深浅对应的窗口底色（Win/Linux 纯色兜底用）。 */
function pickWindowBg(): string {
  return nativeTheme.shouldUseDarkColors ? SPLASH_BG_DARK : SPLASH_BG_LIGHT
}

/** 平台分流的 BrowserWindow 毛玻璃/底色选项。 */
function buildNativeSplashOptions(
  isDarwin: boolean,
): {
  transparent?: boolean
  vibrancy?: 'titlebar' | 'selection' | 'menu' | 'popover' | 'sidebar' | 'header' | 'sheet' | 'window' | 'hud' | 'fullscreen-ui' | 'tooltip' | 'content' | 'under-window' | 'under-page'
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

  // macOS: hiddenInset + trafficLightPosition places native traffic lights
  // inside the floating sidebar panel area (top-left corner).
  // The Panel sits at left:12px, so traffic lights at x:22 land inside it.
  // Windows & Linux: frameless window with custom HTML title bar and window controls.
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
    titleBarStyle: isDarwin ? 'hiddenInset' : 'hidden',
    ...(isDarwin ? { trafficLightPosition: { x: 22, y: 20 } } : {}),
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
    // 开发模式下自动打开 DevTools
    if (is.dev) {
      mainWindow.webContents.openDevTools()
    }
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  // 在系统默认浏览器中打开外部链接，不在 Electron 窗口内导航
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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
  log.info(`Database path: ${dbPath}`)

  try {
    const { createDatabase } = await import('@spark/storage')
    const migrationsDir = is.dev ? undefined : join(process.resourcesPath, 'migrations')
    const db = createDatabase(dbPath, migrationsDir)
    setDatabaseInstance(db)
    const backgroundMaintenanceWorker = startBackgroundMaintenanceWorker(dbPath)
    log.info('Database initialized successfully')

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
    // 数据库初始化失败不阻止应用启动，但大部分功能不可用
    // 用户会看到错误提示
  }

  // 2. 注册 IPC handlers
  registerAllIpcHandlers()

  // 2.05 初始化 Cloud Auth（对接 spark-edugen/edu-server）
  // 默认 base URL：生产环境 https://spark.yiqibyte.com/；本地开发可通过
  // 环境变量 SPARK_EDUGEN_BASE_URL 覆盖。
  try {
    initAuthService({
      defaultBaseUrl:
        process.env.SPARK_EDUGEN_BASE_URL?.trim() || 'https://spark.yiqibyte.com/',
      keytarService: 'SparkAgent.CloudAuth',
      requestTimeoutMs: 30_000,
    })
    await getAuthService().start()
    getPlatformModelService()
    getAuthService().addLoginHook(async () => processPendingPlatformRedeemCodes())
    platformRedeemReady = true
    await processPendingPlatformRedeemCodes()
    clearPersistedEduServerBaseUrl()
    log.info('Cloud auth service started')
  } catch (err) {
    log.error(`Cloud auth service init failed: ${String(err)}`)
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

  // 3.5 注册 Playwright MCP（不在启动时打开嵌入式视图 / 不复用 Electron CDP）
  //
  // 之前的设计是启动隐藏自动化窗口并把 Electron CDP 注入 Playwright MCP，
  // 但 Electron 会同时暴露主窗口、侧边栏 webview、自动化窗口等多个 target，
  // Playwright 经常挑错目标导致 agent 无法控制浏览器。现在 Playwright MCP
  // 直接拉起自己的 Chromium；应用内可见窗口由 spark_browser 内置 MCP 提供。
  try {
    ensurePlaywrightRegistered(getDatabase(), {
      force: true,
      cdpEndpoint: null,
    })
    getInternalBrowserService().bindLifecycle()
  } catch (err) {
    log.warn(`Failed to register Playwright MCP: ${String(err)}`)
  }

  // 3.6 启动所有已启用的用户/项目级 MCP 服务器(Managed 域除外 — Playwright 走
  // ensurePlaywrightRegistered 路径,启动后会被 startAllEnabled 一起拉起)。
  // 必须放在 Playwright 注册之后,否则重启后已启用的 MCP 不会自动恢复连接。
  try {
    const { getMcpService } = await import('./ipc/index.js')
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
      isQuitting = true
      app.quit()
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
    void checkSdkIntegrity({ checkLatest: false }).then((result) => {
      log.info(`SDK integrity check completed: ${result.sdks.map((s) => `${s.packageName}=${s.installed ? s.installedVersion : 'missing'}`).join(', ')}`)
      sendToMainWindow('stream:sdk:integrity', result)
    }).catch((err) => {
      log.warn(`SDK integrity check failed: ${String(err)}`)
    })
  }, 5_000)

  // 6. 推送运行时环境状态到渲染进程（延迟 3 秒）
  setTimeout(() => {
    void getShellEnvironmentStatus().then((status) => {
      sendToMainWindow('stream:env:status', status)
    }).catch((err) => {
      log.warn(`Failed to push shell environment status: ${String(err)}`)
    })
  }, 3_000)

  // 7. 检测 Playwright 完整性并推送状态（延迟 6 秒，与 SDK 自检错开）
  setTimeout(() => {
    pushPlaywrightStatus()

    // 7.5 如果浏览器未就绪，自动在后台下载到内置目录
    // 仅在 dev 模式下自动下载（打包模式下浏览器应已内置）
    if (is.dev) {
      const integrity = detectPlaywrightIntegrity()
      if (integrity.browserSource !== 'bundled' && integrity.playwrightInstalled) {
        log.info('Bundled chromium not ready — auto-downloading chromium to bundled directory...')
        autoInstallBrowser((line) => {
          log.info(`[auto-download] ${line.trim()}`)
        }).then((result) => {
          if (result.success) {
            log.info('Auto-download completed successfully')
            // Reset caches and update env
            resetBundledBrowsersPathCache()
            invalidatePlaywrightCache()
            ensureBundledBrowserEnv()
            pushPlaywrightStatus()
          } else {
            log.warn(`Auto-download failed: ${result.message}`)
            pushPlaywrightStatus()
          }
        }).catch((err) => {
          log.warn(`Auto-download error: ${String(err)}`)
          pushPlaywrightStatus()
        })
      }
    }
  }, 6_000)

  // 8. 检测 FFmpeg 完整性并推送状态（延迟 8 秒，排在 Playwright 之后）
  //    仅检测不自动下载——ffmpeg 按需安装（首次使用视频工作台时提示）
  setTimeout(() => {
    void detectFfmpegIntegrity().then((state) => {
      sendToMainWindow('stream:ffmpeg:status', {
        ffmpegReady: state.ffmpegReady,
        ffmpegSource: state.ffmpegSource,
        ffmpegVersion: state.ffmpegVersion,
        ffprobeReady: state.ffprobeReady,
        binaryPath: state.binaryPath,
        lastError: state.lastError,
      })
    }).catch((err) => {
      log.warn(`FFmpeg integrity check failed: ${String(err)}`)
    })
  }, 8_000)

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
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
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

    // 注册应用菜单，使 F12 切换 DevTools 等快捷键生效
    setupApplicationMenu()

    initializeApp().catch((err) => {
      log.error(`Failed to initialize app: ${String(err)}`)
      app.quit()
    })

    // macOS：dock 图标被点击时恢复/显示主窗口。
    // 注意：close 处理器对窗口做了 hide()（而非 destroy），所以即便窗口已被关闭/最小化，
    // getAllWindows().length 仍为 1，旧实现只判断「无窗口才新建」会漏掉「窗口已隐藏/最小化」
    // 的情况，导致点击 Dock 图标无任何反应。这里统一走 showMainWindow()：存在则 restore+show+focus，
    // 不存在则新建，与托盘点击行为保持一致。
    app.on('activate', () => {
      showMainWindow()
    })
  })

  // Windows / Linux：所有窗口关闭时退出应用
  // macOS：由 'activate' 事件处理，不在此退出
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
      app.quit()
    }
  })
}

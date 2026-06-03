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

import { app, BrowserWindow, Menu, Tray, nativeImage, shell } from 'electron'
import { join } from 'path'

// ─── CDP endpoint for Playwright MCP browser automation ──────────────────────
// MUST be set before app.whenReady() fires. Allocate a fixed port in the
// 9222-9230 range; if collision is detected at runtime we fall back to
// `webContents.debugger.attach` (in-process CDP, see BrowserAutomationViewService).
//
// Security: restrict to loopback + a single explicit origin.
//   - `--remote-debugging-port=0` would auto-pick, but a fixed port is easier
//     for the MCP server config (saved in DB once).
//   - `--remote-allow-origins=*` is needed because Playwright sends its own
//     Origin header; the CDP server rejects mismatched origins by default.
//     Loopback binding keeps the surface local-only.
app.commandLine.appendSwitch('remote-debugging-port', '9223')
app.commandLine.appendSwitch('remote-allow-origins', '*')

import { is } from '@electron-toolkit/utils'
import { getDatabasePath, setDatabaseInstance, closeDatabase } from './db.js'
import { registerAllIpcHandlers } from './ipc/index.js'
import { setMainWindow, sendToMainWindow } from './windows/index.js'
import { getFileWatcherService } from './services/FileWatcherService.js'
import { getUpdateService } from './services/UpdateService.js'
import { checkSdkIntegrity } from './services/SdkIntegrityService.js'
import { initializeShellEnvironment, getShellEnvironmentStatus } from './services/ShellEnvironmentService.js'
import { ensureRegistered as ensurePlaywrightRegistered, readRegistration as readPlaywrightRegistration } from './services/PlaywrightMcpRegistration.js'
import { detectIntegrity as detectPlaywrightIntegrity, installBrowser as autoInstallBrowser, invalidateCache as invalidatePlaywrightCache } from './services/PlaywrightIntegrityService.js'
import { isViewOpen as isBrowserViewOpen, getCdpEndpoint as getBrowserCdpEndpoint, bindLifecycle as bindBrowserViewLifecycle } from './services/BrowserAutomationViewService.js'
import { bindLifecycle as bindPopOutBrowserLifecycle } from './services/PopOutBrowserService.js'
import { ensureBundledBrowserEnv, resetBundledBrowsersPathCache } from './services/PlaywrightEnvironment.js'
import { getDatabase } from './db.js'
import { createLogger } from '@spark/shared'
import type { UpdateStatus } from '@spark/protocol'

const log = createLogger('main')
let tray: Tray | null = null
let isQuitting = false

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

function createTray(): void {
  if (tray != null) return

  const iconPath = getResourcePath(process.platform === 'darwin' ? 'trayTemplate.png' : 'trayIconWin.png')
  let image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') {
    image = image.resize({ width: 16, height: 16 })
    image.setTemplateImage(true)
  }

  tray = new Tray(image)
  tray.setToolTip('Spark Agent')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 Spark Agent', click: showMainWindow },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', showMainWindow)
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
function createWindow(): BrowserWindow {
  const iconPath = getResourcePath(process.platform === 'win32' ? 'taskbarIcon.png' : 'icon.png')

  // macOS: hiddenInset + trafficLightPosition places native traffic lights
  // inside the floating sidebar panel area (top-left corner).
  // The panel sits at left:12px, so traffic lights at x:22 land inside it.
  // Windows/Linux: frameless window with custom HTML window controls.
  const isDarwin = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: isDarwin ? 'hiddenInset' : 'hidden',
    ...(isDarwin ? { trafficLightPosition: { x: 22, y: 20 } } : {}),
    icon: iconPath,
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

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // DevTools 不再自动打开，使用 F12 / Ctrl+Shift+I 手动开启
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
      viewOpen: isBrowserViewOpen(),
      cdpEndpoint: getBrowserCdpEndpoint(),
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
    log.info('Database initialized successfully')

    // 关闭数据库连接在应用退出时
    app.on('before-quit', () => {
      getFileWatcherService().stopAll()
      getUpdateService().destroy()
      closeDatabase()
    })
  } catch (err) {
    log.error(`Database initialization failed: ${String(err)}`)
    // 数据库初始化失败不阻止应用启动，但大部分功能不可用
    // 用户会看到错误提示
  }

  // 2. 注册 IPC handlers
  registerAllIpcHandlers()

  // 3. 创建主窗口
  createWindow()
  createTray()

  // 3.5 注册 Playwright MCP（不在启动时打开嵌入式视图 / 不复用 Electron CDP）
  //
  // 之前的设计是启动时打开隐藏的自动化窗口并把 Electron 的 --remote-debugging-port
  // 作为 --cdp-endpoint 注入 Playwright MCP，但 Electron 的 CDP 会同时暴露主窗口、
  // 侧边栏 webview、自动化窗口等多个 target，Playwright 经常挑错目标导致 agent
  // 无法控制浏览器。改为：MCP 直接拉起自己的 Chromium（headful），拥有完整权限。
  // 侧边栏 / 弹出窗口作为用户手动浏览的独立 UI 功能，不再与 agent 共享会话。
  try {
    ensurePlaywrightRegistered(getDatabase(), {
      force: true,
      cdpEndpoint: null,
    })
    bindBrowserViewLifecycle()
    // Pop-out browser window is opened on demand, but its hide-on-close
    // handler would otherwise block app quit — register a before-quit
    // hook that destroys it (mirrors bindBrowserViewLifecycle above).
    bindPopOutBrowserLifecycle()
  } catch (err) {
    log.warn(`Failed to register Playwright MCP: ${String(err)}`)
  }

  // 4. 初始化自动更新服务
  const updateService = getUpdateService()
  updateService.initialize((status: UpdateStatus) => {
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
  })

  // 启动自动检查（应用启动后延迟 30 秒检查，避免影响启动速度）
  setTimeout(() => {
    void updateService.checkForUpdates()
  }, 30_000)
  updateService.startAutoCheck()

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

  log.info('Spark Agent initialized')
}

// Electron 生命周期：所有窗口就绪时初始化应用
app.whenReady().then(() => {
  initializeApp().catch((err) => {
    log.error(`Failed to initialize app: ${String(err)}`)
    app.quit()
  })

  // macOS：dock 图标被点击且无窗口时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// Windows / Linux：所有窗口关闭时退出应用
// macOS：由 'activate' 事件处理，不在此退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit()
  }
})

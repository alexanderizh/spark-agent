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

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getDatabasePath, setDatabaseInstance, closeDatabase } from './db.js'
import { registerAllIpcHandlers } from './ipc/index.js'
import { setMainWindow, sendToMainWindow } from './windows/index.js'
import { getFileWatcherService } from './services/FileWatcherService.js'
import { getUpdateService } from './services/UpdateService.js'
import { checkSdkIntegrity } from './services/SdkIntegrityService.js'
import { initializeShellEnvironment, getShellEnvironmentStatus } from './services/ShellEnvironmentService.js'
import { createLogger } from '@spark/shared'
import type { UpdateStatus } from '@spark/protocol'

const log = createLogger('main')

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
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset', // macOS 原生红绿灯按钮
    webPreferences: {
      // ADR-003 安全约束：三项强制配置，不可协商
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, // 必须：隔离 preload 和 renderer 的 JS 上下文
      nodeIntegration: false, // 必须：renderer 无法直接访问 Node.js API
      sandbox: true, // 必须：renderer 进程沙盒化（contextBridge 在 sandbox 下完全可用）
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  // 窗口准备好后再显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    // 开发模式下自动打开开发者工具
    if (is.dev) {
      mainWindow.webContents.openDevTools()
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
 * 初始化主进程核心服务
 *
 * 启动顺序：
 *   1. 初始化 SQLite 数据库（migration + WAL）
 *   2. 注册 IPC handlers
 *   3. 创建主窗口
 */
async function initializeApp(): Promise<void> {
  log.info('Initializing Spark Agent...')

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
    const db = createDatabase(dbPath)
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

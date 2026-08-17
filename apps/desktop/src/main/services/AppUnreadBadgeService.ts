import { app, nativeImage, type Tray } from 'electron'
import { createLogger } from '@spark/shared'
import { getMainWindow } from '../windows/index.js'

const log = createLogger('app-unread-badge')
const MAX_UNREAD_COUNT = 9_999
const WINDOWS_UNREAD_DOT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGJTgnan+f2yYbI1EG0SRAcRqxmnIqAFUMGDg0wExBhHUOCAAAI0zH0wLPoHXAAAAAElFTkSuQmCC'

export interface AppUnreadBadgeAdapter {
  setDockBadge: (text: string) => void
  setLauncherBadgeCount: (count: number) => void
  setTaskbarOverlay: (visible: boolean, description: string) => void
  setTrayToolTip: (text: string) => void
}

export function normalizeUnreadCount(count: number): number {
  if (!Number.isFinite(count)) return 0
  return Math.min(MAX_UNREAD_COUNT, Math.max(0, Math.trunc(count)))
}

export function formatDockBadge(count: number): string {
  const normalized = normalizeUnreadCount(count)
  if (normalized === 0) return ''
  return normalized > 99 ? '99+' : String(normalized)
}

export function formatUnreadToolTip(count: number): string {
  const normalized = normalizeUnreadCount(count)
  return normalized === 0 ? 'SparkWork -Beta' : `SparkWork -Beta · ${normalized} 个未读会话`
}

export function applyUnreadBadge(
  count: number,
  platform: NodeJS.Platform,
  adapter: AppUnreadBadgeAdapter,
): void {
  const normalized = normalizeUnreadCount(count)
  const description =
    normalized === 0 ? 'SparkWork -Beta 无未读会话' : `SparkWork -Beta 有 ${normalized} 个未读会话`

  if (platform === 'darwin') {
    adapter.setDockBadge(formatDockBadge(normalized))
  } else if (platform === 'linux') {
    adapter.setLauncherBadgeCount(normalized)
  } else if (platform === 'win32') {
    adapter.setTaskbarOverlay(normalized > 0, description)
  }

  adapter.setTrayToolTip(formatUnreadToolTip(normalized))
}

let unreadCount = 0
let activeRendererSessionId: string | null = null
let appTray: Tray | null = null
let windowsUnreadDot: Electron.NativeImage | null = null

export function setActiveRendererSession(sessionId: string | null): void {
  activeRendererSessionId = sessionId
}

export function shouldSuppressSessionNotification(
  sessionId: string,
  mainWindowFocused: boolean,
): boolean {
  return mainWindowFocused && activeRendererSessionId === sessionId
}

function runBadgeOperation(operation: string, action: () => void): void {
  try {
    action()
  } catch (error) {
    log.warn(`Failed to ${operation}: ${String(error)}`)
  }
}

function getWindowsUnreadDot(): Electron.NativeImage {
  if (windowsUnreadDot == null) {
    windowsUnreadDot = nativeImage.createFromBuffer(Buffer.from(WINDOWS_UNREAD_DOT_PNG, 'base64'))
  }
  return windowsUnreadDot
}

function createRuntimeAdapter(): AppUnreadBadgeAdapter {
  return {
    setDockBadge: (text) => {
      runBadgeOperation('update macOS Dock badge', () => app.dock?.setBadge(text))
    },
    setLauncherBadgeCount: (count) => {
      runBadgeOperation('update Linux launcher badge', () => {
        app.setBadgeCount(count)
      })
    },
    setTaskbarOverlay: (visible, description) => {
      runBadgeOperation('update Windows taskbar overlay', () => {
        const mainWindow = getMainWindow()
        if (mainWindow == null || mainWindow.isDestroyed()) return
        mainWindow.setOverlayIcon(visible ? getWindowsUnreadDot() : null, description)
      })
    },
    setTrayToolTip: (text) => {
      runBadgeOperation('update tray tooltip', () => appTray?.setToolTip(text))
    },
  }
}

export function updateAppUnreadBadge(count: number): number {
  unreadCount = normalizeUnreadCount(count)
  applyUnreadBadge(unreadCount, process.platform, createRuntimeAdapter())
  return unreadCount
}

export function attachAppUnreadBadgeTray(tray: Tray): void {
  appTray = tray
  updateAppUnreadBadge(unreadCount)
}

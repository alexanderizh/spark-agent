/**
 * 窗口管理模块
 *
 * 职责：
 *   - 管理主窗口的生命周期
 *   - 未来支持多窗口（如独立的 diff 查看器、设置窗口等）
 *   - 窗口状态持久化（位置、大小）
 */

import { BrowserWindow } from 'electron'

/** 当前主窗口实例的引用，供其他模块使用 */
let mainWindow: BrowserWindow | null = null
const appWindows = new Set<BrowserWindow>()
const trackedWindows = new WeakSet<BrowserWindow>()
let lastFocusedAppWindow: BrowserWindow | null = null

function isRegisteredAppWindow(win: BrowserWindow): boolean {
  return win === mainWindow || appWindows.has(win)
}

function trackAppWindow(win: BrowserWindow): void {
  if (trackedWindows.has(win)) return
  trackedWindows.add(win)

  win.on('focus', () => {
    if (isRegisteredAppWindow(win) && !win.isDestroyed()) {
      lastFocusedAppWindow = win
    }
  })
  win.once('closed', () => {
    appWindows.delete(win)
    if (mainWindow === win) mainWindow = null
    if (lastFocusedAppWindow === win) lastFocusedAppWindow = null
  })
}

export function getMainWindow(): BrowserWindow | null {
  if (mainWindow?.isDestroyed()) mainWindow = null
  return mainWindow
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
  if (win != null) trackAppWindow(win)
}

export function registerAppWindow(win: BrowserWindow): void {
  appWindows.add(win)
  trackAppWindow(win)
}

export function getLastFocusedAppWindow(): BrowserWindow | null {
  const win = lastFocusedAppWindow
  if (win == null) return null
  if (!isRegisteredAppWindow(win) || win.isDestroyed()) {
    lastFocusedAppWindow = null
    return null
  }
  return win
}

export function getPreferredAppWindow(): BrowserWindow | null {
  const focused = getLastFocusedAppWindow()
  if (focused != null) return focused

  const main = getMainWindow()
  if (main != null) return main

  for (const win of appWindows) {
    if (!win.isDestroyed()) return win
    appWindows.delete(win)
  }
  return null
}

export function revealAppWindow(win: BrowserWindow | null): boolean {
  if (win == null || win.isDestroyed()) return false
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  return true
}

/**
 * 向主窗口发送流式事件
 * @param channel - IpcStreamChannel 中定义的 channel 名称
 * @param payload - 对应 channel 的 payload 类型
 */
export function sendToMainWindow(channel: string, payload: unknown): void {
  const win = getMainWindow()
  if (win != null && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

export function broadcastToAppWindows(channel: string, payload: unknown): void {
  const windows = new Set<BrowserWindow>()
  const main = getMainWindow()
  if (main != null) windows.add(main)
  for (const win of appWindows) windows.add(win)

  for (const win of windows) {
    if (win.isDestroyed()) {
      appWindows.delete(win)
      continue
    }
    win.webContents.send(channel, payload)
  }
}

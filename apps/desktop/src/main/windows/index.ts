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

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
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

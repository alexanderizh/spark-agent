import { BrowserWindow } from 'electron'
import type { BrowserWindow as ElectronBrowserWindow, IpcMainInvokeEvent } from 'electron'

export function getWindowForIpcSender(
  event: Pick<IpcMainInvokeEvent, 'sender'>,
  getFallbackWindow: () => ElectronBrowserWindow | null,
): ElectronBrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? getFallbackWindow()
}

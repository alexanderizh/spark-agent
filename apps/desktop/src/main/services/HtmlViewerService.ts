import { app, BrowserWindow, shell } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildHtmlViewerDocument,
  validateHtmlViewerPayload,
  type HtmlViewerPayload,
} from '@spark/shared'

let htmlViewerWindow: BrowserWindow | null = null

function normalizePayload(input: unknown): HtmlViewerPayload {
  const result = validateHtmlViewerPayload(input)
  if (!result.ok) throw new Error(result.reason)
  return result.payload
}

function createHtmlViewerWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: 'HTML 内容',
    width: 960,
    height: 720,
    minWidth: 560,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('data:text/html')) event.preventDefault()
  })
  win.once('closed', () => {
    if (htmlViewerWindow === win) htmlViewerWindow = null
  })
  return win
}

export async function openHtmlViewerWindow(input: unknown): Promise<{ success: boolean }> {
  const payload = normalizePayload(input)
  const document = buildHtmlViewerDocument(payload)
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(document)}`
  const win =
    htmlViewerWindow != null && !htmlViewerWindow.isDestroyed()
      ? htmlViewerWindow
      : (htmlViewerWindow = createHtmlViewerWindow())
  win.setTitle(payload.title)
  await win.loadURL(url)
  if (!win.isVisible()) win.show()
  win.focus()
  return { success: true }
}

export async function openHtmlInExternalBrowser(input: unknown): Promise<{ success: boolean }> {
  const payload = normalizePayload(input)
  const directory = await mkdtemp(join(app.getPath('temp'), 'spark-html-'))
  try {
    const filePath = join(directory, 'index.html')
    await writeFile(filePath, buildHtmlViewerDocument(payload), { encoding: 'utf8', mode: 0o600 })
    await shell.openExternal(pathToFileURL(filePath).toString())
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  const cleanup = setTimeout(
    () => {
      void rm(directory, { recursive: true, force: true })
    },
    5 * 60 * 1000,
  )
  cleanup.unref()
  return { success: true }
}

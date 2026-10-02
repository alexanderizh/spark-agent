import { app, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  buildHtmlViewerDocument,
  buildSandboxedHtml,
  validateHtmlViewerPayload,
  type HtmlViewerPayload,
} from '@spark/shared'
import { putHtmlRenderRuntimeDoc } from './HtmlRenderRuntimeDocs.js'

let htmlViewerWindow: BrowserWindow | null = null

function normalizePayload(input: unknown): HtmlViewerPayload {
  const result = validateHtmlViewerPayload(input)
  if (!result.ok) throw new Error(result.reason)
  return result.payload
}

/**
 * 独立窗口与内容区渲染块共用 capability-asset://html-render 文档注册表：
 * 合成文档由协议按 URL 提供（独立空策略容器，不继承壳文档 CSP，存储可用）。
 * token 仅主进程生成，符合注册表 ^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$ 约束。
 */
function createHtmlViewerToken(): string {
  return `win-${randomUUID().replaceAll('-', '')}`
}

function htmlRenderDocUrl(token: string): string {
  return `capability-asset://html-render/${token}?v=1`
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
      // 与外部浏览器对齐：产物引用 http 外联资源时不做混合内容拦截
      //（https CDN 资源本就不受影响）。
      allowRunningInsecureContent: true,
      webviewTag: false,
    },
  })
  // 产物内弹窗对齐外部浏览器：http(s) 交给系统浏览器打开，其余一律拒绝。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url).catch(() => undefined)
    }
    return { action: 'deny' }
  })
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
  const token = createHtmlViewerToken()
  putHtmlRenderRuntimeDoc({
    token,
    document: buildSandboxedHtml(payload.html, payload.theme),
  })
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(
    buildHtmlViewerDocument(payload, htmlRenderDocUrl(token)),
  )}`
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
    // 外部浏览器直接打开完整合成文档（顶层加载、无壳），行为与浏览器原生一致。
    await writeFile(filePath, buildSandboxedHtml(payload.html, payload.theme), {
      encoding: 'utf8',
      mode: 0o600,
    })
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

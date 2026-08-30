import electron from 'electron'
import type { Rectangle } from 'electron'
import type {
  BrowserPanelDevtoolsBounds,
  BrowserPanelDevtoolsOpenRequest,
  BrowserPanelDevtoolsOpenResponse,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'

const log = createLogger('browser-panel-devtools')
const {
  BrowserWindow: ElectronBrowserWindow,
  WebContentsView: ElectronWebContentsView,
  webContents: electronWebContents,
} = electron

interface HostWebContents {
  id: number
  getZoomFactor: () => number
  isDestroyed: () => boolean
  send: (channel: string, payload: unknown) => void
}

interface TargetWebContents extends HostWebContents {
  getType: () => string
  hostWebContents?: HostWebContents
  isDevToolsOpened: () => boolean
  openDevTools: (options: { mode: 'detach'; activate: boolean }) => void
  closeDevTools: () => void
  setDevToolsWebContents: (contents: DevtoolsWebContents) => void
  on: (event: 'destroyed' | 'devtools-closed', listener: () => void) => void
  removeListener: (event: 'destroyed' | 'devtools-closed', listener: () => void) => void
}

interface DevtoolsWebContents {
  isDestroyed: () => boolean
  close: () => void
  on: (event: 'destroyed', listener: () => void) => void
  removeListener: (event: 'destroyed', listener: () => void) => void
}

interface DevtoolsView {
  webContents: DevtoolsWebContents
  setBounds: (bounds: Rectangle) => void
}

interface DevtoolsHostWindow {
  contentView: {
    addChildView: (view: DevtoolsView) => void
    removeChildView: (view: DevtoolsView) => void
  }
  getContentSize: () => [number, number]
  isDestroyed: () => boolean
  on: (event: 'closed', listener: () => void) => void
  removeListener: (event: 'closed', listener: () => void) => void
}

export interface BrowserPanelDevtoolsServiceDeps {
  resolveTarget: (id: number) => TargetWebContents | null
  resolveHostWindow: (host: HostWebContents) => DevtoolsHostWindow | null
  createView: () => DevtoolsView
}

interface DevtoolsSession {
  host: HostWebContents
  hostWindow: DevtoolsHostWindow
  target: TargetWebContents
  view: DevtoolsView
  onDevtoolsClosed: () => void
  onTargetDestroyed: () => void
  onViewDestroyed: () => void
  onHostClosed: () => void
}

export function normalizeBrowserPanelDevtoolsBounds(
  bounds: BrowserPanelDevtoolsBounds,
  contentSize: [number, number],
  zoomFactor = 1,
): Rectangle | null {
  const [contentWidth, contentHeight] = contentSize
  if (contentWidth <= 0 || contentHeight <= 0) return null

  const scale = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1
  const scaled = {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale),
  }
  const x = Math.min(Math.max(0, scaled.x), contentWidth - 1)
  const y = Math.min(Math.max(0, scaled.y), contentHeight - 1)
  return {
    x,
    y,
    width: Math.min(Math.max(1, scaled.width), contentWidth - x),
    height: Math.min(Math.max(1, scaled.height), contentHeight - y),
  }
}

export class BrowserPanelDevtoolsService {
  private readonly sessions = new Map<number, DevtoolsSession>()

  constructor(private readonly deps: BrowserPanelDevtoolsServiceDeps) {}

  open(
    host: HostWebContents,
    request: BrowserPanelDevtoolsOpenRequest,
  ): BrowserPanelDevtoolsOpenResponse {
    const target = this.deps.resolveTarget(request.webContentsId)
    if (target == null || target.isDestroyed() || target.getType() !== 'webview') {
      return { success: false, error: 'target-not-found' }
    }
    if (target.hostWebContents?.id !== host.id) {
      log.warn(`Rejected DevTools target ${request.webContentsId}: host mismatch`)
      return { success: false, error: 'target-not-owned' }
    }

    const hostWindow = this.deps.resolveHostWindow(host)
    if (hostWindow == null || hostWindow.isDestroyed()) {
      return { success: false, error: 'host-window-not-found' }
    }
    const bounds = normalizeBrowserPanelDevtoolsBounds(
      request.bounds,
      hostWindow.getContentSize(),
      host.getZoomFactor(),
    )
    if (bounds == null) return { success: false, error: 'host-window-not-found' }

    const current = this.sessions.get(host.id)
    if (current?.target.id === target.id) {
      current.view.setBounds(bounds)
      return { success: true }
    }
    if (current != null) this.teardown(current, false, true)

    const view = this.deps.createView()
    const session: DevtoolsSession = {
      host,
      hostWindow,
      target,
      view,
      onDevtoolsClosed: () => this.teardownForHost(host.id, true, false),
      onTargetDestroyed: () => this.teardownForHost(host.id, true, false),
      onViewDestroyed: () => this.teardownForHost(host.id, true, false),
      onHostClosed: () => this.teardownForHost(host.id, false, false),
    }

    try {
      if (target.isDevToolsOpened()) target.closeDevTools()
      hostWindow.contentView.addChildView(view)
      view.setBounds(bounds)
      target.setDevToolsWebContents(view.webContents)
      target.on('devtools-closed', session.onDevtoolsClosed)
      target.on('destroyed', session.onTargetDestroyed)
      view.webContents.on('destroyed', session.onViewDestroyed)
      hostWindow.on('closed', session.onHostClosed)
      this.sessions.set(host.id, session)
      target.openDevTools({ mode: 'detach', activate: true })
      return { success: true }
    } catch (error) {
      log.warn(`Failed to open embedded page DevTools: ${String(error)}`)
      if (this.sessions.get(host.id) === session) {
        this.teardown(session, false, false)
      } else {
        try {
          hostWindow.contentView.removeChildView(view)
        } catch {
          // The view may not have been attached yet.
        }
        if (!view.webContents.isDestroyed()) view.webContents.close()
      }
      return { success: false, error: 'open-failed' }
    }
  }

  updateBounds(host: HostWebContents, bounds: BrowserPanelDevtoolsBounds): boolean {
    const session = this.sessions.get(host.id)
    if (session == null) return false
    const nextBounds = normalizeBrowserPanelDevtoolsBounds(
      bounds,
      session.hostWindow.getContentSize(),
      host.getZoomFactor(),
    )
    if (nextBounds == null) return false
    session.view.setBounds(nextBounds)
    return true
  }

  close(host: HostWebContents): boolean {
    const session = this.sessions.get(host.id)
    if (session == null) return true
    this.teardown(session, false, true)
    return true
  }

  closeAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.teardown(session, false, true)
    }
  }

  private teardownForHost(hostId: number, notifyRenderer: boolean, closeTarget: boolean): void {
    const session = this.sessions.get(hostId)
    if (session != null) this.teardown(session, notifyRenderer, closeTarget)
  }

  private teardown(session: DevtoolsSession, notifyRenderer: boolean, closeTarget: boolean): void {
    if (this.sessions.get(session.host.id) !== session) return
    this.sessions.delete(session.host.id)

    session.target.removeListener('devtools-closed', session.onDevtoolsClosed)
    session.target.removeListener('destroyed', session.onTargetDestroyed)
    session.view.webContents.removeListener('destroyed', session.onViewDestroyed)
    session.hostWindow.removeListener('closed', session.onHostClosed)

    if (closeTarget && !session.target.isDestroyed() && session.target.isDevToolsOpened()) {
      try {
        session.target.closeDevTools()
      } catch {
        // The guest may be closing at the same time as its host window.
      }
    }
    try {
      session.hostWindow.contentView.removeChildView(session.view)
    } catch {
      // Host teardown may already have detached every child view.
    }
    if (!session.view.webContents.isDestroyed()) session.view.webContents.close()

    if (notifyRenderer && !session.host.isDestroyed()) {
      session.host.send('stream:browser-panel:devtools-closed', {
        webContentsId: session.target.id,
      })
    }
  }
}

let singleton: BrowserPanelDevtoolsService | null = null

export function getBrowserPanelDevtoolsService(): BrowserPanelDevtoolsService {
  if (singleton == null) {
    singleton = new BrowserPanelDevtoolsService({
      resolveTarget: (id) => {
        const target = electronWebContents.fromId(id)
        return target == null ? null : (target as unknown as TargetWebContents)
      },
      resolveHostWindow: (host) =>
        ElectronBrowserWindow.fromWebContents(host as never) as DevtoolsHostWindow | null,
      createView: () => new ElectronWebContentsView() as unknown as DevtoolsView,
    })
  }
  return singleton
}

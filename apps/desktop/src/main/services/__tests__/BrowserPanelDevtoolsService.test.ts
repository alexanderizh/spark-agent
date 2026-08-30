import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  default: {
    BrowserWindow: { fromWebContents: vi.fn() },
    WebContentsView: vi.fn(),
    webContents: { fromId: vi.fn() },
  },
}))

import {
  BrowserPanelDevtoolsService,
  normalizeBrowserPanelDevtoolsBounds,
} from '../BrowserPanelDevtoolsService.js'

type Listener = () => void

function createEmitter() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    on: vi.fn((event: string, listener: Listener) => {
      const eventListeners = listeners.get(event) ?? new Set<Listener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    }),
    removeListener: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    }),
    emit(event: string): void {
      for (const listener of [...(listeners.get(event) ?? [])]) listener()
    },
  }
}

function createHost(id = 1, zoomFactor = 1) {
  return {
    id,
    getZoomFactor: vi.fn(() => zoomFactor),
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  }
}

function createTarget(id: number, host: ReturnType<typeof createHost>) {
  const emitter = createEmitter()
  let destroyed = false
  let devtoolsOpened = false
  return {
    id,
    getZoomFactor: vi.fn(() => 1),
    getType: vi.fn(() => 'webview'),
    hostWebContents: host,
    isDestroyed: vi.fn(() => destroyed),
    isDevToolsOpened: vi.fn(() => devtoolsOpened),
    openDevTools: vi.fn(() => {
      devtoolsOpened = true
    }),
    closeDevTools: vi.fn(() => {
      devtoolsOpened = false
    }),
    setDevToolsWebContents: vi.fn(),
    send: vi.fn(),
    on: emitter.on,
    removeListener: emitter.removeListener,
    destroy(): void {
      destroyed = true
      emitter.emit('destroyed')
    },
  }
}

function createView() {
  const emitter = createEmitter()
  let destroyed = false
  return {
    setBounds: vi.fn(),
    webContents: {
      isDestroyed: vi.fn(() => destroyed),
      close: vi.fn(() => {
        destroyed = true
      }),
      on: emitter.on,
      removeListener: emitter.removeListener,
    },
  }
}

function createHostWindow() {
  const emitter = createEmitter()
  return {
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
    getContentSize: vi.fn((): [number, number] => [1000, 700]),
    isDestroyed: vi.fn(() => false),
    on: emitter.on,
    removeListener: emitter.removeListener,
  }
}

describe('BrowserPanelDevtoolsService', () => {
  it('converts renderer CSS bounds to zoom-aware BrowserWindow coordinates', () => {
    expect(
      normalizeBrowserPanelDevtoolsBounds(
        { x: 100, y: 50, width: 400, height: 300 },
        [1000, 600],
        1.25,
      ),
    ).toEqual({ x: 125, y: 63, width: 500, height: 375 })

    expect(
      normalizeBrowserPanelDevtoolsBounds({ x: 950, y: 580, width: 400, height: 300 }, [1000, 600]),
    ).toEqual({ x: 950, y: 580, width: 50, height: 20 })
  })

  it('rejects a webview target owned by a different renderer', () => {
    const host = createHost(1)
    const otherHost = createHost(2)
    const target = createTarget(10, otherHost)
    const service = new BrowserPanelDevtoolsService({
      resolveTarget: () => target,
      resolveHostWindow: () => createHostWindow(),
      createView,
    } as never)

    expect(
      service.open(host, {
        webContentsId: target.id,
        bounds: { x: 0, y: 400, width: 500, height: 300 },
      }),
    ).toEqual({ success: false, error: 'target-not-owned' })
  })

  it('rejects the host application WebContents even when its id is supplied', () => {
    const host = createHost(1)
    const target = createTarget(10, host)
    target.getType.mockReturnValue('window')
    const service = new BrowserPanelDevtoolsService({
      resolveTarget: () => target,
      resolveHostWindow: () => createHostWindow(),
      createView,
    } as never)

    expect(
      service.open(host, {
        webContentsId: target.id,
        bounds: { x: 0, y: 400, width: 500, height: 300 },
      }),
    ).toEqual({ success: false, error: 'target-not-found' })
  })

  it('attaches DevTools to a child WebContentsView and releases it on close', () => {
    const host = createHost(1, 1.2)
    const target = createTarget(10, host)
    const hostWindow = createHostWindow()
    const view = createView()
    const service = new BrowserPanelDevtoolsService({
      resolveTarget: () => target,
      resolveHostWindow: () => hostWindow,
      createView: () => view,
    } as never)

    expect(
      service.open(host, {
        webContentsId: target.id,
        bounds: { x: 100, y: 300, width: 500, height: 250 },
      }),
    ).toEqual({ success: true })
    expect(hostWindow.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 120, y: 360, width: 600, height: 300 })
    expect(target.setDevToolsWebContents).toHaveBeenCalledWith(view.webContents)
    expect(target.openDevTools).toHaveBeenCalledWith({ mode: 'detach', activate: true })

    expect(service.updateBounds(host, { x: 50, y: 250, width: 400, height: 200 })).toBe(true)
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 60, y: 300, width: 480, height: 240 })

    expect(service.close(host)).toBe(true)
    expect(target.closeDevTools).toHaveBeenCalledOnce()
    expect(hostWindow.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(view.webContents.close).toHaveBeenCalledOnce()
  })

  it('switches the embedded inspector to the next tab without notifying a false close', () => {
    const host = createHost()
    const firstTarget = createTarget(10, host)
    const secondTarget = createTarget(11, host)
    const hostWindow = createHostWindow()
    const views = [createView(), createView()]
    const targets = new Map([
      [firstTarget.id, firstTarget],
      [secondTarget.id, secondTarget],
    ])
    const service = new BrowserPanelDevtoolsService({
      resolveTarget: (id: number) => targets.get(id) ?? null,
      resolveHostWindow: () => hostWindow,
      createView: () => views.shift(),
    } as never)
    const bounds = { x: 0, y: 300, width: 600, height: 300 }

    expect(service.open(host, { webContentsId: firstTarget.id, bounds }).success).toBe(true)
    expect(service.open(host, { webContentsId: secondTarget.id, bounds }).success).toBe(true)

    expect(firstTarget.closeDevTools).toHaveBeenCalledOnce()
    expect(secondTarget.openDevTools).toHaveBeenCalledOnce()
    expect(host.send).not.toHaveBeenCalled()
  })

  it('notifies the renderer when the inspected guest is destroyed', () => {
    const host = createHost()
    const target = createTarget(10, host)
    const hostWindow = createHostWindow()
    const view = createView()
    const service = new BrowserPanelDevtoolsService({
      resolveTarget: () => target,
      resolveHostWindow: () => hostWindow,
      createView: () => view,
    } as never)

    service.open(host, {
      webContentsId: target.id,
      bounds: { x: 0, y: 300, width: 600, height: 300 },
    })
    target.destroy()

    expect(host.send).toHaveBeenCalledWith('stream:browser-panel:devtools-closed', {
      webContentsId: target.id,
    })
    expect(view.webContents.close).toHaveBeenCalledOnce()
  })
})

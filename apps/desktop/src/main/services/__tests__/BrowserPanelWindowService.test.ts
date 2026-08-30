import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  default: {
    app: {
      on: vi.fn(),
    },
    BrowserWindow: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('../../windows/index.js', () => ({
  registerAppWindow: vi.fn(),
  getMainWindow: vi.fn(),
}))

import { BrowserPanelWindowService } from '../BrowserPanelWindowService.js'

type FakeWebContents = {
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

type FakeWindow = {
  id: number
  webContents: FakeWebContents
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function createFakeWindow(id: number): FakeWindow {
  return {
    id,
    webContents: {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    destroy: vi.fn(),
  }
}

function createService(created: FakeWindow[], mainSend: ReturnType<typeof vi.fn> | null = null) {
  return new BrowserPanelWindowService({
    createWindow: () => {
      const win = createFakeWindow(created.length + 1)
      created.push(win)
      return win as never
    },
    getRendererUrl: () => 'http://127.0.0.1:5173',
    getRendererFile: () => '/app/out/renderer/index.html',
    isDev: true,
    getMainWindowWebContents: () => (mainSend != null ? { send: mainSend } : null),
  })
}

describe('BrowserPanelWindowService', () => {
  it('open 创建窗口并携带 url 参数', async () => {
    const created: FakeWindow[] = []
    const service = createService(created)

    const res = await service.open({ url: 'https://example.com/a?b=1' })

    expect(res.success).toBe(true)
    expect(res.windowId).toBe(1)
    expect(created[0]?.loadURL).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/#window=browser&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
    )
    expect(created[0]?.show).toHaveBeenCalled()
  })

  it('open 无 url 时不带 url 参数', async () => {
    const created: FakeWindow[] = []
    const service = createService(created)

    await service.open({})

    expect(created[0]?.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/#window=browser')
  })

  it('重复 open 复用窗口：聚焦 + 推送导航事件，不重新加载', async () => {
    const created: FakeWindow[] = []
    const service = createService(created)

    await service.open({ url: 'https://example.com/' })
    const res = await service.open({ url: 'https://example.com/next' })

    expect(created).toHaveLength(1)
    expect(res.windowId).toBe(1)
    expect(created[0]?.loadURL).toHaveBeenCalledTimes(1)
    expect(created[0]?.focus).toHaveBeenCalled()
    expect(created[0]?.webContents.send).toHaveBeenCalledWith('stream:browser-window:navigate', {
      url: 'https://example.com/next',
    })
  })

  it('窗口 closed 事件后清空引用，下次 open 重新创建', async () => {
    const created: FakeWindow[] = []
    const service = createService(created)

    await service.open({})
    const closedListener = created[0]?.on.mock.calls.find(([event]) => event === 'closed')?.[1] as
      | (() => void)
      | undefined
    closedListener?.()
    await service.open({})

    expect(created).toHaveLength(2)
  })

  it('restoreToPanel 向主窗口推送恢复事件并关闭窗口', () => {
    const created: FakeWindow[] = []
    const mainSend = vi.fn()
    const service = createService(created, mainSend)

    void service.open({})

    const res = service.restoreToPanel({ url: 'https://example.com/x' })
    expect(res.success).toBe(true)
    expect(mainSend).toHaveBeenCalledWith('stream:browser-panel:restore', {
      url: 'https://example.com/x',
    })
    expect(created[0]?.destroy).toHaveBeenCalled()
  })

  it('restoreToPanel 无主窗口时返回失败且不关窗', () => {
    const created: FakeWindow[] = []
    const service = createService(created, null)

    void service.open({})

    const res = service.restoreToPanel({})
    expect(res.success).toBe(false)
    expect(created[0]?.destroy).not.toHaveBeenCalled()
  })

  it('forwardPickToComposer 转发引用 JSON 到主窗口', () => {
    const created: FakeWindow[] = []
    const mainSend = vi.fn()
    const service = createService(created, mainSend)

    const res = service.forwardPickToComposer('{"label":"button「购买」"}')
    expect(res.success).toBe(true)
    expect(mainSend).toHaveBeenCalledWith('stream:browser-panel:element-picked', {
      referenceJson: '{"label":"button「购买」"}',
    })
  })

  it('forwardPickToComposer 空文本返回失败', () => {
    const created: FakeWindow[] = []
    const mainSend = vi.fn()
    const service = createService(created, mainSend)

    expect(service.forwardPickToComposer('   ').success).toBe(false)
    expect(mainSend).not.toHaveBeenCalled()
  })
})

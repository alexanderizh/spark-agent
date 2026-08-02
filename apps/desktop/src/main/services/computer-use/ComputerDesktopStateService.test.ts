import type { NativeWindowDescriptor } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerDesktopStateService } from './ComputerDesktopStateService.js'

const WINDOWS: NativeWindowDescriptor[] = [
  windowDescriptor({
    appId: 'app-bilibili',
    appName: '哔哩哔哩',
    bundleId: 'com.bilibili.bilibiliPC',
    windowId: 'window-bilibili',
    title: '哔哩哔哩',
    focused: true,
  }),
  windowDescriptor({
    appId: 'app-notes',
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    windowId: 'window-notes-1',
    title: 'Note 1',
  }),
  windowDescriptor({
    appId: 'app-notes',
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    windowId: 'window-notes-2',
    title: 'Note 2',
    minimized: true,
  }),
]

describe('ComputerDesktopStateService', () => {
  it('aggregates running applications without requiring a task session', async () => {
    const service = createService()

    await expect(service.listApps({ scope: 'running' })).resolves.toMatchObject([
      { app: { name: '哔哩哔哩' }, focused: true, windowCount: 1 },
      { app: { name: 'Notes' }, focused: false, windowCount: 2 },
    ])
  })

  it('merges installed and running applications without blocking on catalog failures', async () => {
    const catalog = {
      listInstalled: vi.fn(async () => [
        installedApp('Notes'),
        installedApp('Safari'),
      ]),
    }
    const service = new ComputerDesktopStateService(
      { listWindows: async () => WINDOWS },
      { resolve: async () => null },
      () => new Date('2026-08-02T00:00:00.000Z'),
      catalog,
    )

    await expect(service.listApps()).resolves.toMatchObject([
      { app: { name: '哔哩哔哩' }, running: true },
      { app: { name: 'Notes' }, running: true },
      { app: { name: 'Safari' }, running: false },
    ])
    expect(catalog.listInstalled).toHaveBeenCalledOnce()

    const degraded = new ComputerDesktopStateService(
      { listWindows: async () => WINDOWS },
      { resolve: async () => null },
      () => new Date(),
      { listInstalled: async () => Promise.reject(new Error('Spotlight unavailable')) },
    )
    await expect(degraded.listApps()).resolves.toHaveLength(2)

    const hostDegraded = new ComputerDesktopStateService(
      { listWindows: async () => Promise.reject(new Error('Native Host unavailable')) },
      { resolve: async () => null },
      () => new Date(),
      catalog,
    )
    await expect(hostDegraded.listApps()).resolves.toMatchObject([
      { app: { name: 'Notes' }, running: false },
      { app: { name: 'Safari' }, running: false },
    ])
  })

  it('reports frontmost, display, app, and window state in one call', async () => {
    const service = createService()

    await expect(service.getScreenState({ includeWindows: false })).resolves.toMatchObject({
      capturedAt: '2026-08-02T00:00:00.000Z',
      foreground: { app: { id: 'app-bilibili' }, window: { id: 'window-bilibili' } },
      appCount: 2,
      windowCount: 3,
      apps: [
        { app: { id: 'app-bilibili' }, windows: [] },
        { app: { id: 'app-notes' }, windows: [] },
      ],
    })
  })

  it('filters windows by app name, bundle id, or stable app id', async () => {
    const service = createService()

    await expect(service.listWindows({ app: 'com.apple.Notes' })).resolves.toHaveLength(1)
    await expect(
      service.listWindows({ app: 'APP-NOTES', includeMinimized: true }),
    ).resolves.toHaveLength(2)
  })

  it('gets app state directly from a window id', async () => {
    const service = createService()

    await expect(service.getAppState({ windowId: 'window-notes-1' })).resolves.toMatchObject({
      target: { app: { name: 'Notes' }, window: { id: 'window-notes-1' } },
      state: { app: { id: 'app-notes' }, windowCount: 2 },
    })
  })

  it('includes the native accessibility and visual observation when supported', async () => {
    const observation = {
      frameId: 'frame-1',
      treeVersion: 'tree-1',
      capturedAt: '2026-08-02T00:00:00.000Z',
      display: WINDOWS[0]?.display,
      foreground: { app: WINDOWS[0]?.app, window: WINDOWS[0]?.window },
      screenshot: { snapshotId: 'snapshot-1', width: 1200, height: 800 },
      tree: { mode: 'full' as const, text: 'button "Search"', elementCount: 0 },
      elements: [],
      loading: false,
      sensitiveRegions: [],
    }
    const inspectWindow = vi.fn(async () => observation as never)
    const service = new ComputerDesktopStateService(
      { listWindows: async () => WINDOWS, inspectWindow },
      { resolve: async () => WINDOWS[0] ?? null },
    )

    await expect(service.getAppState({ app: '哔哩哔哩' })).resolves.toMatchObject({
      observation: { tree: { text: 'button "Search"' } },
    })
    expect(inspectWindow).toHaveBeenCalledWith({
      appId: 'app-bilibili',
      windowId: 'window-bilibili',
      fullTree: true,
    })
  })

  it('uses the target resolver to open or raise a named application', async () => {
    const resolve = vi.fn(async () => WINDOWS[0] ?? null)
    const inventory = { listWindows: vi.fn(async () => WINDOWS) }
    const service = new ComputerDesktopStateService(inventory, { resolve })

    await expect(service.openApp('哔哩哔哩')).resolves.toMatchObject({
      target: { app: { id: 'app-bilibili' } },
    })
    expect(resolve).toHaveBeenCalledWith('哔哩哔哩', inventory)
    expect(inventory.listWindows).toHaveBeenCalled()
  })
})

function createService(): ComputerDesktopStateService {
  return new ComputerDesktopStateService(
    { listWindows: async () => WINDOWS },
    { resolve: async () => null },
    () => new Date('2026-08-02T00:00:00.000Z'),
  )
}

function installedApp(name: string) {
  return {
    app: { id: `installed-${name.toLocaleLowerCase()}`, name },
    running: false as const,
    focused: false as const,
    windowCount: 0 as const,
    windows: [] as [],
  }
}

function windowDescriptor(input: {
  appId: string
  appName: string
  bundleId: string
  windowId: string
  title: string
  focused?: boolean
  minimized?: boolean
}): NativeWindowDescriptor {
  return {
    app: {
      id: input.appId,
      name: input.appName,
      bundleId: input.bundleId,
      processId: input.appId === 'app-bilibili' ? 101 : 202,
    },
    window: {
      id: input.windowId,
      title: input.title,
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
    },
    display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 2 },
    focused: input.focused ?? false,
    minimized: input.minimized ?? false,
  }
}

import { describe, expect, it, vi } from 'vitest'
import type { NativeWindowDescriptor } from '@spark/protocol'
import {
  ComputerApplicationTargetResolver,
  findApplicationWindow,
} from './ComputerApplicationTargetResolver.js'

const BILIBILI = {
  app: { id: 'app-bilibili', name: '哔哩哔哩', bundleId: 'com.bilibili.bilibiliPC' },
  window: {
    id: 'window-bilibili',
    title: '哔哩哔哩',
    bounds: { x: 0, y: 0, width: 1200, height: 800 },
  },
  display: { id: 'display-1', scaleFactor: 2 },
  focused: true,
  minimized: false,
} as NativeWindowDescriptor

describe('ComputerApplicationTargetResolver', () => {
  it('raises an already running app before binding its window', async () => {
    const launch = vi.fn(async () => undefined)
    const resolver = new ComputerApplicationTargetResolver('darwin', launch)

    await expect(
      resolver.resolve('com.bilibili.bilibiliPC', { listWindows: async () => [BILIBILI] }),
    ).resolves.toEqual(BILIBILI)
    expect(launch).toHaveBeenCalledOnce()
  })

  it('launches once and waits for the first real app window', async () => {
    const launch = vi.fn(async () => undefined)
    const listWindows = vi
      .fn<() => Promise<NativeWindowDescriptor[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([BILIBILI])
    const resolver = new ComputerApplicationTargetResolver(
      'darwin',
      launch,
      async () => undefined,
      8_000,
      100,
      (() => {
        let now = 0
        return () => (now += 100)
      })(),
    )

    await expect(resolver.resolve('哔哩哔哩', { listWindows })).resolves.toEqual(BILIBILI)
    expect(launch).toHaveBeenCalledOnce()
  })
})

describe('findApplicationWindow', () => {
  it('matches app name, bundle id, or stable app id case-insensitively', () => {
    expect(findApplicationWindow([BILIBILI], '哔哩哔哩')).toEqual(BILIBILI)
    expect(findApplicationWindow([BILIBILI], 'COM.BILIBILI.BILIBILIPC')).toEqual(BILIBILI)
    expect(findApplicationWindow([BILIBILI], 'APP-BILIBILI')).toEqual(BILIBILI)
  })

  it('ignores a tiny tray/widget window even when it is reported as focused', () => {
    const trayWidget = {
      app: { id: 'app-bilibili', name: '哔哩哔哩', bundleId: 'com.bilibili.bilibiliPC' },
      window: {
        id: 'window-bilibili-tray',
        title: '',
        bounds: { x: 1180, y: 0, width: 66, height: 20 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: true,
      minimized: false,
    } as NativeWindowDescriptor
    const main = {
      ...BILIBILI,
      focused: false,
      window: { ...BILIBILI.window, id: 'window-bilibili-main' },
    } as NativeWindowDescriptor
    // The focused 66x20 widget must NOT win over the real main window.
    expect(findApplicationWindow([trayWidget, main], '哔哩哔哩')).toEqual(main)
  })

  it('reports same-name ambiguity across different applications instead of picking by focus', () => {
    const packaged = {
      app: {
        id: 'com.spark-agent.desktop',
        name: 'SparkWork',
        bundleId: 'com.spark-agent.desktop',
      },
      window: {
        id: 'window-packaged',
        title: 'SparkWork',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: true,
      minimized: false,
    } as NativeWindowDescriptor
    const dev = {
      app: { id: 'com.github.Electron', name: 'SparkWork', bundleId: 'com.github.Electron' },
      window: {
        id: 'window-dev',
        title: 'SparkWork (dev)',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: false,
      minimized: false,
    } as NativeWindowDescriptor
    // The previously-focused packaged build must NOT silently win. Distinct
    // bundle ids CAN separate the candidates, so the hint must point there.
    expect(() => findApplicationWindow([packaged, dev], 'SparkWork')).toThrow(
      /matches 2 different applications:.*com\.spark-agent\.desktop.*com\.github\.Electron.*Specify the exact bundle id, or a window id\./s,
    )
    // A session already bound to the dev build keeps resolving to it.
    expect(
      findApplicationWindow([packaged, dev], 'SparkWork', {
        preferredAppId: 'com.github.Electron',
      }),
    ).toEqual(dev)
  })

  it('keeps the same-name preference when the bound application is no longer running', () => {
    const packaged = {
      app: {
        id: 'com.spark-agent.desktop',
        name: 'SparkWork',
        bundleId: 'com.spark-agent.desktop',
      },
      window: {
        id: 'window-packaged',
        title: 'SparkWork',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: false,
      minimized: false,
    } as NativeWindowDescriptor
    // preferredAppId points at an app that is gone: the ambiguity is real and
    // must still surface rather than silently binding the remaining candidate.
    expect(() =>
      findApplicationWindow([packaged], 'SparkWork', { preferredAppId: 'com.github.Electron' }),
    ).not.toThrow()
    expect(
      findApplicationWindow([packaged], 'SparkWork', { preferredAppId: 'com.github.Electron' }),
    ).toEqual(packaged)
  })

  it('disambiguates same-BUNDLE processes by pid (shared app id collapses them)', () => {
    // Real E2E case: the dev build and WeChat DevTools both declare
    // com.github.Electron, so both windows share ONE app id. The old guard
    // (keyed by app id alone) never fired and open_app raised the wrong app.
    const sparkDev = {
      app: {
        id: 'com.github.Electron',
        name: 'Electron',
        bundleId: 'com.github.Electron',
        processId: 48445,
      },
      window: {
        id: 'window-dev',
        title: 'SparkWork',
        bounds: { x: 0, y: 0, width: 1440, height: 900 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: false,
      minimized: false,
    } as NativeWindowDescriptor
    const wechatDevtools = {
      app: {
        id: 'com.github.Electron',
        name: 'wechatwebdevtools',
        bundleId: 'com.github.Electron',
        processId: 55263,
      },
      window: {
        id: 'window-wechat',
        title: '微信开发者工具',
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
      },
      display: { id: 'display-1', scaleFactor: 2 },
      focused: true,
      minimized: false,
    } as NativeWindowDescriptor
    const windows = [sparkDev, wechatDevtools]
    // Without a binding the ambiguity must surface — with both pids so the
    // caller can re-specify — instead of silently picking the focused one.
    // A SHARED bundle id cannot separate them, so the hint must say so.
    expect(() => findApplicationWindow(windows, 'com.github.Electron')).toThrow(
      /pid=48445.*pid=55263.*bundle id is shared, so disambiguate with a window id\./s,
    )
    // The session's bound pid steers to the right instance even while the
    // wrong one holds focus.
    expect(
      findApplicationWindow(windows, 'com.github.Electron', { preferredProcessId: 48445 }),
    ).toEqual(sparkDev)
    expect(
      findApplicationWindow(windows, 'com.github.Electron', {
        preferredAppId: 'com.github.Electron',
        preferredProcessId: 55263,
      }),
    ).toEqual(wechatDevtools)
  })
})

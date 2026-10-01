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
      app: { id: 'com.spark-agent.desktop', name: 'SparkWork', bundleId: 'com.spark-agent.desktop' },
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
    // The previously-focused packaged build must NOT silently win.
    expect(() => findApplicationWindow([packaged, dev], 'SparkWork')).toThrow(
      /matches 2 different applications:.*com\.spark-agent\.desktop.*com\.github\.Electron/s,
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
      app: { id: 'com.spark-agent.desktop', name: 'SparkWork', bundleId: 'com.spark-agent.desktop' },
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
})

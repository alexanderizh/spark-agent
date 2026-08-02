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
})

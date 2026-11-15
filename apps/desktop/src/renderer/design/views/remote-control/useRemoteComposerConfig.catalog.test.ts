// @vitest-environment jsdom

/**
 * readCachedCatalog 的落盘兜底：重启后内存目录缓存为空，新建会话套用「上次的
 * 助手/模型/权限」全靠落盘目录做收敛——没有它，重启后新建会话会静默回到
 * 目标端默认模型（用户反馈「下次进来不是上次选的模型」的根因之一）。
 *
 * readCachedCatalog 依赖模块级内存 Map + localStorage：每个用例 resetModules
 * 后动态 import，保证互不串缓存。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileBridgeCatalog } from '@spark/protocol'

const STORAGE_KEY = 'spark-agent:remote-catalog-cache'

function catalogOf(providers: string[]): MobileBridgeCatalog {
  return {
    agents: [],
    providers: providers.map((id) => ({
      id,
      name: id,
      models: [{ id: `${id}-model`, name: `${id} 模型` }],
    })),
    permissionModes: {},
    reasoningEfforts: [],
    workflows: [],
  } as unknown as MobileBridgeCatalog
}

async function loadFresh(): Promise<typeof import('./useRemoteComposerConfig')> {
  vi.resetModules()
  return import('./useRemoteComposerConfig')
}

describe('readCachedCatalog 落盘兜底', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('内存与落盘都没有时返回 null', async () => {
    const { readCachedCatalog } = await loadFresh()
    expect(readCachedCatalog('device-1')).toBeNull()
  })

  it('落盘有 24h 内的目录时兜底返回（内存缓存失效后）', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'device-1': { at: Date.now() - 10 * 60_000, catalog: catalogOf(['spark']) },
      }),
    )
    const { readCachedCatalog } = await loadFresh()
    const catalog = readCachedCatalog('device-1')
    expect(catalog).not.toBeNull()
    expect(catalog?.providers.map((provider) => provider.id)).toEqual(['spark'])
  })

  it('落盘超过 24h 视为过期，返回 null', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'device-1': { at: Date.now() - 25 * 3600_000, catalog: catalogOf(['spark']) },
      }),
    )
    const { readCachedCatalog } = await loadFresh()
    expect(readCachedCatalog('device-1')).toBeNull()
  })

  it('落盘结构损坏（脏数据 / 半截写入）不抛错，返回 null', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{broken json')
    const first = await loadFresh()
    expect(first.readCachedCatalog('device-1')).toBeNull()

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'device-1': { hello: 1 } }))
    const second = await loadFresh()
    expect(second.readCachedCatalog('device-1')).toBeNull()
  })

  it('按 deviceId 隔离：取不到其它设备的落盘目录', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'device-2': { at: Date.now(), catalog: catalogOf(['spark']) },
      }),
    )
    const { readCachedCatalog } = await loadFresh()
    expect(readCachedCatalog('device-1')).toBeNull()
    expect(readCachedCatalog('device-2')).not.toBeNull()
  })
})

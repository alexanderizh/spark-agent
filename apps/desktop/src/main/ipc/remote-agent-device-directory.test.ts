import { describe, expect, it } from 'vitest'
import type { SettingsService } from '@spark/agent-runtime'
import type { RemoteAgentDeviceSummary } from '@spark/protocol'
import {
  buildDeviceListResponse,
  mergeKnownDevices,
  readDeviceDirectory,
  REMOTE_AGENT_DEVICE_DIRECTORY_MAX,
  upsertDeviceDirectory,
} from './remote-agent-device-directory'

/** 只实现 get/set 的内存版 SettingsService（同 remote-agent-device-aliases.test） */
function createSettings(): SettingsService & { dump: () => Record<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    get: (category: string, key: string) => store.get(`${category}/${key}`) ?? null,
    set: (category: string, key: string, value: unknown) => {
      store.set(`${category}/${key}`, value)
    },
    getByCategory: () => ({}),
    getAll: () => ({}),
    delete: () => false,
    dump: () => Object.fromEntries(store),
  } as unknown as SettingsService & { dump: () => Record<string, unknown> }
}

function device(
  partial: Partial<RemoteAgentDeviceSummary> & { deviceId: string },
): RemoteAgentDeviceSummary {
  return {
    deviceId: partial.deviceId,
    name: partial.name ?? 'Windows 工作站',
    version: partial.version ?? '0.15.34',
    online: partial.online ?? true,
    lastSeenAt: partial.lastSeenAt ?? null,
  }
}

describe('readDeviceDirectory', () => {
  it('没写过时返回空表，脏数据被清掉', () => {
    expect(readDeviceDirectory(createSettings())).toEqual({})
    const settings = createSettings()
    settings.set('remote-agent', 'device-directory', {
      good: {
        name: '台式机',
        version: '0.15.34',
        lastSeenAt: '2026-11-25T04:00:00Z',
        updatedAt: '2026-11-25T05:00:00Z',
      },
      noName: { version: null, updatedAt: '2026-11-25T05:00:00Z' },
      garbage: 42,
    })
    expect(readDeviceDirectory(settings)).toEqual({
      good: {
        name: '台式机',
        version: '0.15.34',
        lastSeenAt: '2026-11-25T04:00:00Z',
        updatedAt: '2026-11-25T05:00:00Z',
      },
    })
  })

  it('旧结构缺 updatedAt 时回落 lastSeenAt，再缺则按纪元兜底', () => {
    const settings = createSettings()
    settings.set('remote-agent', 'device-directory', {
      d1: { name: '旧条目', version: null, lastSeenAt: '2026-11-24T10:00:00Z' },
      d2: { name: '更旧条目', version: null, lastSeenAt: null },
    })
    const directory = readDeviceDirectory(settings)
    expect(directory.d1?.updatedAt).toBe('2026-11-24T10:00:00Z')
    expect(directory.d2?.updatedAt).toBe(new Date(0).toISOString())
  })
})

describe('upsertDeviceDirectory', () => {
  it('在线设备落盘：lastSeenAt 缺失时用当前时刻兜底', () => {
    const settings = createSettings()
    upsertDeviceDirectory(settings, [device({ deviceId: 'd1', online: true, lastSeenAt: null })])
    const directory = readDeviceDirectory(settings)
    expect(directory.d1?.name).toBe('Windows 工作站')
    expect(directory.d1?.lastSeenAt).not.toBeNull()
    expect(directory.d1?.updatedAt).not.toBeNull()
  })

  it('重复推送覆盖旧值；离线推送保留 relay 给的 lastSeenAt', () => {
    const settings = createSettings()
    upsertDeviceDirectory(settings, [device({ deviceId: 'd1', version: '0.15.33' })])
    upsertDeviceDirectory(settings, [
      device({
        deviceId: 'd1',
        version: '0.15.34',
        online: false,
        lastSeenAt: '2026-11-25T08:00:00Z',
      }),
    ])
    const directory = readDeviceDirectory(settings)
    expect(directory.d1?.version).toBe('0.15.34')
    expect(directory.d1?.lastSeenAt).toBe('2026-11-25T08:00:00Z')
  })

  it('超过容量上限时按 updatedAt 淘汰最旧的设备', () => {
    const settings = createSettings()
    // 先写入一台「很旧」的设备
    settings.set('remote-agent', 'device-directory', {
      old: { name: '老机器', version: null, lastSeenAt: null, updatedAt: '2020-01-01T00:00:00Z' },
    })
    const fresh = Array.from({ length: REMOTE_AGENT_DEVICE_DIRECTORY_MAX }, (_, index) =>
      device({ deviceId: `d${index}`, name: `机器${index}` }),
    )
    upsertDeviceDirectory(settings, fresh)
    const directory = readDeviceDirectory(settings)
    expect(Object.keys(directory)).toHaveLength(REMOTE_AGENT_DEVICE_DIRECTORY_MAX)
    expect(directory.old).toBeUndefined()
    expect(directory.d0).toBeDefined()
  })
})

describe('mergeKnownDevices', () => {
  const directory = {
    online1: {
      name: '在线机器',
      version: '0.15.34',
      lastSeenAt: '2026-11-25T08:00:00Z',
      updatedAt: '2026-11-25T08:00:00Z',
    },
    recentOffline: {
      name: '离线机器',
      version: '0.15.33',
      lastSeenAt: '2026-11-24T08:00:00Z',
      updatedAt: '2026-11-24T08:00:00Z',
    },
    staleOffline: {
      name: '很久前的机器',
      version: '0.15.30',
      lastSeenAt: '2026-11-01T08:00:00Z',
      updatedAt: '2026-11-01T08:00:00Z',
    },
    local: {
      name: '本机',
      version: '0.15.34',
      lastSeenAt: null,
      updatedAt: '2026-11-25T08:00:00Z',
    },
    noSeen: {
      name: '无时间机器',
      version: null,
      lastSeenAt: null,
      updatedAt: '2026-11-25T08:00:00Z',
    },
  }

  it('历史里的离线设备被补进列表，本机被排除', () => {
    const merged = mergeKnownDevices(
      [device({ deviceId: 'online1', name: '在线机器', lastSeenAt: '2026-11-25T09:00:00Z' })],
      directory,
      'local',
    )
    const ids = merged.map((entry) => entry.deviceId)
    expect(ids).toContain('recentOffline')
    expect(ids).toContain('staleOffline')
    expect(ids).not.toContain('local')
    const offline = merged.find((entry) => entry.deviceId === 'recentOffline')
    expect(offline).toMatchObject({ online: false, name: '离线机器', version: '0.15.33' })
  })

  it('在线设备以 relay 为准（不覆盖成离线），排序在线在前、离线按 lastSeenAt 新→旧', () => {
    const merged = mergeKnownDevices(
      [device({ deviceId: 'online1', name: '在线机器', lastSeenAt: '2026-11-25T09:00:00Z' })],
      directory,
      'local',
    )
    expect(merged[0]).toMatchObject({
      deviceId: 'online1',
      online: true,
      lastSeenAt: '2026-11-25T09:00:00Z',
    })
    const offlineIds = merged.filter((entry) => !entry.online).map((entry) => entry.deviceId)
    expect(offlineIds.indexOf('recentOffline')).toBeLessThan(offlineIds.indexOf('staleOffline'))
    // lastSeenAt 为空的排最后
    expect(offlineIds[offlineIds.length - 1]).toBe('noSeen')
  })

  it('relay 掉线（live 为空）也能列出全部历史设备', () => {
    const merged = mergeKnownDevices([], directory, 'local')
    expect(merged.every((entry) => !entry.online)).toBe(true)
    expect(merged).toHaveLength(4)
  })
})

describe('buildDeviceListResponse', () => {
  it('统一出口 = 历史合并 + 备注名合并；getLocalDeviceId 抛错不炸列表', () => {
    const settings = createSettings()
    settings.set('remote-agent', 'device-aliases', { d1: '台式机' })
    settings.set('remote-agent', 'device-directory', {
      d1: {
        name: 'DESKTOP-1N5AL2E',
        version: '0.15.33',
        lastSeenAt: '2026-11-24T08:00:00Z',
        updatedAt: '2026-11-24T08:00:00Z',
      },
      d2: {
        name: '旧笔记本',
        version: '0.15.30',
        lastSeenAt: '2026-11-01T08:00:00Z',
        updatedAt: '2026-11-01T08:00:00Z',
      },
    })
    const response = buildDeviceListResponse(settings, [], () => {
      throw new Error('device id unavailable')
    })
    expect(response.devices).toHaveLength(2)
    expect(response.devices[0]).toMatchObject({
      deviceId: 'd1',
      online: false,
      alias: '台式机',
      name: 'DESKTOP-1N5AL2E',
    })
    expect(response.devices[1]).toMatchObject({ deviceId: 'd2', online: false })
    expect('alias' in (response.devices[1] ?? {})).toBe(false)
  })
})

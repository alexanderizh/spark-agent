import { describe, expect, it } from 'vitest'
import type { SettingsService } from '@spark/agent-runtime'
import { REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH } from '@spark/protocol'
import {
  applyDeviceAliases,
  normalizeDeviceAlias,
  readDeviceAliases,
  writeDeviceAlias,
} from './remote-agent-device-aliases'

/** 只实现 get/set 的内存版 SettingsService */
function createSettings(seed?: Record<string, unknown>): SettingsService & {
  dump: () => Record<string, unknown>
} {
  const store = new Map<string, unknown>()
  if (seed != null) store.set('remote-agent/device-aliases', seed)
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

describe('normalizeDeviceAlias', () => {
  it('折叠空白并去首尾', () => {
    expect(normalizeDeviceAlias('  公司   台式机  ')).toBe('公司 台式机')
  })

  it('空串 / 纯空白 / 非字符串 = 没有备注名', () => {
    expect(normalizeDeviceAlias('')).toBeNull()
    expect(normalizeDeviceAlias('   ')).toBeNull()
    expect(normalizeDeviceAlias(null)).toBeNull()
    expect(normalizeDeviceAlias(42)).toBeNull()
  })

  it('按字符截断，中文不会被切成半个字', () => {
    const long = '机'.repeat(REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH + 10)
    const result = normalizeDeviceAlias(long)
    expect(result).toHaveLength(REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH)
    expect([...(result ?? '')]).toHaveLength(REMOTE_AGENT_DEVICE_ALIAS_MAX_LENGTH)
  })
})

describe('readDeviceAliases', () => {
  it('没写过时返回空表', () => {
    expect(readDeviceAliases(createSettings())).toEqual({})
  })

  it('脏数据（非对象 / 空值 / 非字符串值）被清掉', () => {
    expect(readDeviceAliases(createSettings({ __x: 1 }))).toEqual({})
    const settings = createSettings({ d1: '公司台式机', d2: '', d3: 7, d4: '  家里的 iMac ' })
    expect(readDeviceAliases(settings)).toEqual({ d1: '公司台式机', d4: '家里的 iMac' })
  })
})

describe('writeDeviceAlias', () => {
  it('写入 / 覆盖 / 清除单台设备', () => {
    const settings = createSettings()
    expect(writeDeviceAlias(settings, 'd1', '公司台式机')).toEqual({ d1: '公司台式机' })
    expect(writeDeviceAlias(settings, 'd2', '渲染机')).toEqual({ d1: '公司台式机', d2: '渲染机' })
    expect(writeDeviceAlias(settings, 'd1', '渲染机')).toEqual({ d1: '渲染机', d2: '渲染机' })
    // 留空 = 删除该键，回落设备自报名
    expect(writeDeviceAlias(settings, 'd1', '   ')).toEqual({ d2: '渲染机' })
    expect(writeDeviceAlias(settings, 'd2', null)).toEqual({})
  })

  it('deviceId 为空直接拒绝（避免写出无主别名）', () => {
    expect(() => writeDeviceAlias(createSettings(), '  ', 'x')).toThrow()
  })
})

describe('applyDeviceAliases', () => {
  const devices = [
    { deviceId: 'd1', name: 'Windows 工作站', version: '0.15.18', online: true, lastSeenAt: null },
    { deviceId: 'd2', name: 'Windows 工作站', version: '0.15.18', online: false, lastSeenAt: null },
  ]

  it('两台同名机器靠备注名区分，没有备注的不加字段', () => {
    const result = applyDeviceAliases(devices, { d1: '公司台式机' })
    expect(result[0]).toMatchObject({ name: 'Windows 工作站', alias: '公司台式机' })
    expect('alias' in (result[1] ?? {})).toBe(false)
  })

  it('不改入参', () => {
    const snapshot = JSON.stringify(devices)
    applyDeviceAliases(devices, { d1: '公司台式机', d2: '渲染机' })
    expect(JSON.stringify(devices)).toBe(snapshot)
  })
})

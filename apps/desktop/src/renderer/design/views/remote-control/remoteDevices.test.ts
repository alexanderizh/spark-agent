import { describe, expect, it } from 'vitest'
import { deviceLabel, deviceRealName, deviceTooltip } from './remoteDevices'

const device = (name: string, alias?: string) => ({ name, ...(alias != null ? { alias } : {}) })

describe('deviceLabel', () => {
  it('备注名优先于设备自报名', () => {
    expect(deviceLabel(device('Windows 工作站', '公司台式机'))).toBe('公司台式机')
  })

  it('没备注名时用自报名', () => {
    expect(deviceLabel(device('Windows 工作站'))).toBe('Windows 工作站')
  })

  it('空白备注名等同于没有备注', () => {
    expect(deviceLabel(device('MacBook Pro', '   '))).toBe('MacBook Pro')
  })

  it('名字和备注都为空的兜底文案', () => {
    expect(deviceLabel(device(''))).toBe('未命名设备')
    expect(deviceLabel(null)).toBe('未命名设备')
  })
})

describe('deviceRealName', () => {
  it('有备注名时透出自报名，供副标题展示', () => {
    expect(deviceRealName(device('Windows 工作站', '公司台式机'))).toBe('Windows 工作站')
  })

  it('没有备注名 / 备注与自报名相同 → 不重复展示', () => {
    expect(deviceRealName(device('Windows 工作站'))).toBeNull()
    expect(deviceRealName(device('渲染机', '渲染机'))).toBeNull()
  })
})

describe('deviceTooltip', () => {
  it('有备注名时把原名一起说清楚', () => {
    expect(deviceTooltip(device('Windows 工作站', '公司台式机'))).toBe(
      '公司台式机（原设备名：Windows 工作站）',
    )
  })

  it('没有备注名时就只有名字', () => {
    expect(deviceTooltip(device('Windows 工作站'))).toBe('Windows 工作站')
  })
})

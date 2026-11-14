import { describe, expect, it } from 'vitest'
import {
  AUTO_TABS_MAX_DEVICES,
  REMOTE_VIEW_STATE_KEY,
  defaultRemoteViewState,
  parseDeviceSwitcherMode,
  parseRemoteViewState,
  readDeviceSwitcher,
  rememberDeviceSwitcher,
  resolveDeviceSwitcherMode,
} from './remoteViewState'

function createStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    snapshot: () => map,
  }
}

describe('parseDeviceSwitcherMode', () => {
  it('合法值原样保留', () => {
    expect(parseDeviceSwitcherMode('tabs')).toBe('tabs')
    expect(parseDeviceSwitcherMode('dropdown')).toBe('dropdown')
    expect(parseDeviceSwitcherMode('auto')).toBe('auto')
  })

  it('脏值 / 旧版本缺字段一律回落 auto', () => {
    expect(parseDeviceSwitcherMode(undefined)).toBe('auto')
    expect(parseDeviceSwitcherMode(null)).toBe('auto')
    expect(parseDeviceSwitcherMode('segmented')).toBe('auto')
    expect(parseDeviceSwitcherMode(1)).toBe('auto')
  })
})

describe('resolveDeviceSwitcherMode', () => {
  it('只有一台在线设备时没有可切的，退回下拉（入口由调用方隐藏）', () => {
    expect(resolveDeviceSwitcherMode('auto', 1, 1)).toBe('dropdown')
  })

  it('auto：少量在线设备用 Tab 栏', () => {
    expect(resolveDeviceSwitcherMode('auto', 2, 2)).toBe('tabs')
    expect(resolveDeviceSwitcherMode('auto', AUTO_TABS_MAX_DEVICES, AUTO_TABS_MAX_DEVICES)).toBe(
      'tabs',
    )
  })

  it('auto：在线设备太多时 Tab 会挤成一串，交给下拉', () => {
    expect(resolveDeviceSwitcherMode('auto', AUTO_TABS_MAX_DEVICES + 1, 6)).toBe('dropdown')
  })

  it('auto：总设备数过多（含一堆离线）时不塞 Tab', () => {
    expect(resolveDeviceSwitcherMode('auto', 2, 9)).toBe('dropdown')
  })

  it('用户显式选择永远优先于自动判定', () => {
    expect(resolveDeviceSwitcherMode('tabs', 8, 12)).toBe('tabs')
    expect(resolveDeviceSwitcherMode('dropdown', 2, 2)).toBe('dropdown')
  })
})

describe('deviceSwitcher 持久化', () => {
  it('默认是 auto', () => {
    expect(defaultRemoteViewState().deviceSwitcher).toBe('auto')
    expect(readDeviceSwitcher(createStorage())).toBe('auto')
  })

  it('写入后能读回来', () => {
    const storage = createStorage()
    rememberDeviceSwitcher('tabs', storage)
    expect(readDeviceSwitcher(storage)).toBe('tabs')
  })

  it('写形态不会冲掉上次设备与会话', () => {
    const storage = createStorage()
    storage.setItem(
      REMOTE_VIEW_STATE_KEY,
      JSON.stringify({
        version: 1,
        lastDeviceId: 'dev-a',
        lastSessionByDevice: { 'dev-a': { sessionId: 's-1', projectId: null } },
        expandedByDevice: {},
        composerByDevice: {},
        deviceSwitcher: 'auto',
      }),
    )
    const next = rememberDeviceSwitcher('dropdown', storage)
    expect(next.lastDeviceId).toBe('dev-a')
    expect(next.lastSessionByDevice['dev-a']?.sessionId).toBe('s-1')
    expect(next.deviceSwitcher).toBe('dropdown')
  })

  it('旧版本状态（没有 deviceSwitcher 字段）解析后是 auto，且不影响其它字段', () => {
    const parsed = parseRemoteViewState(
      JSON.stringify({
        version: 1,
        lastDeviceId: 'dev-b',
        lastSessionByDevice: {},
        expandedByDevice: {},
        composerByDevice: {},
      }),
    )
    expect(parsed.deviceSwitcher).toBe('auto')
    expect(parsed.lastDeviceId).toBe('dev-b')
  })

  it('非法形态值不会污染状态', () => {
    const storage = createStorage()
    storage.setItem(REMOTE_VIEW_STATE_KEY, JSON.stringify({ version: 1, deviceSwitcher: 'hack' }))
    expect(readDeviceSwitcher(storage)).toBe('auto')
  })
})

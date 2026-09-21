import { describe, expect, it } from 'vitest'
import {
  describeSyncValue,
  describeUpdateValue,
  formatSyncMoment,
  type UserMenuSyncState,
} from './userMenuModel'

const NOW = new Date('2026-09-22T16:00:00')

function syncState(patch: Partial<UserMenuSyncState> = {}): UserMenuSyncState {
  return {
    authenticated: true,
    busy: false,
    outcome: null,
    enabled: true,
    selectedCount: 3,
    lastFinishedAt: null,
    ...patch,
  }
}

describe('formatSyncMoment', () => {
  it('当天只显示时:分，跨天补月-日', () => {
    expect(formatSyncMoment('2026-09-22T09:05:00', NOW)).toBe('09:05')
    expect(formatSyncMoment('2026-09-21T23:40:00', NOW)).toBe('09-21 23:40')
  })

  it('空值与非法值不展示', () => {
    expect(formatSyncMoment(null, NOW)).toBeNull()
    expect(formatSyncMoment('   ', NOW)).toBeNull()
    expect(formatSyncMoment('not-a-date', NOW)).toBeNull()
  })
})

describe('describeSyncValue', () => {
  it('未登录不展示同步状态', () => {
    expect(describeSyncValue(syncState({ authenticated: false }))).toBeNull()
  })

  it('同步中：loading 指示器 + 主色，保证菜单不收起时能看到进度', () => {
    const value = describeSyncValue(syncState({ busy: true, enabled: false }))
    expect(value).toEqual({
      labelKey: 'app.user.syncBusy',
      tone: 'primary',
      indicator: 'spinner',
    })
  })

  it('结果态优先于偏好态，逐级降级', () => {
    expect(describeSyncValue(syncState({ outcome: 'success' }))?.labelKey).toBe('app.user.syncDone')
    expect(describeSyncValue(syncState({ outcome: 'partial' }))?.labelKey).toBe(
      'app.user.syncPartial',
    )
    expect(describeSyncValue(syncState({ outcome: 'failed' }))?.labelKey).toBe(
      'app.user.syncFailed',
    )
  })

  it('未开启 / 未选类别都显示未开启，且引导到设置页', () => {
    expect(describeSyncValue(syncState({ enabled: false }))?.labelKey).toBe('app.user.syncOff')
    expect(describeSyncValue(syncState({ selectedCount: 0 }))?.labelKey).toBe('app.user.syncOff')
  })

  it('偏好未读到时不显示数值，而不是误报未开启', () => {
    expect(describeSyncValue(syncState({ enabled: null }))).toBeNull()
  })

  it('已开启且有记录时显示上次同步时间', () => {
    const value = describeSyncValue(syncState({ lastFinishedAt: '2026-09-22T14:05:00' }), NOW)
    expect(value).toEqual({
      labelKey: 'app.user.syncLastAt',
      params: { time: '14:05' },
      tone: 'muted',
      indicator: 'none',
    })
  })
})

describe('describeUpdateValue', () => {
  const base = { currentVersion: '1.1.0', availableVersion: null, percent: 0 }

  it('空闲时显示当前版本号', () => {
    expect(describeUpdateValue({ ...base, state: 'idle' })).toMatchObject({
      raw: 'v1.1.0',
      tone: 'muted',
    })
    expect(describeUpdateValue({ ...base, state: 'not-available' })).toMatchObject({
      raw: 'v1.1.0',
    })
  })

  it('检查中有 spinner，发现新版本用主色并把版本号带出来', () => {
    expect(describeUpdateValue({ ...base, state: 'checking' })).toMatchObject({
      labelKey: 'app.user.updateChecking',
      indicator: 'spinner',
    })
    expect(
      describeUpdateValue({ ...base, state: 'available', availableVersion: '1.3.0' }),
    ).toMatchObject({
      labelKey: 'app.user.updateAvailable',
      params: { version: '1.3.0' },
      tone: 'primary',
    })
  })

  it('下载中四舍五入百分比，待安装与异常各有独立文案', () => {
    expect(describeUpdateValue({ ...base, state: 'downloading', percent: 44.6 })).toMatchObject({
      labelKey: 'app.user.updateDownloading',
      params: { percent: 45 },
      indicator: 'spinner',
    })
    expect(describeUpdateValue({ ...base, state: 'downloaded' })).toMatchObject({
      labelKey: 'app.user.updateReady',
      tone: 'success',
    })
    expect(describeUpdateValue({ ...base, state: 'error' })).toMatchObject({
      labelKey: 'app.user.updateError',
      tone: 'danger',
    })
  })

  it('拿不到版本号时回退占位符，不出现 undefined', () => {
    expect(describeUpdateValue({ ...base, currentVersion: null, state: 'idle' })).toMatchObject({
      raw: '--',
    })
  })
})

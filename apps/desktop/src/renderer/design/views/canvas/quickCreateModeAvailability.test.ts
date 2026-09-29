import { afterEach, describe, expect, it } from 'vitest'
import { MODE_ITEMS } from './quickCreateTaskPresentation'
import {
  DEFAULT_QUICK_CREATE_MODE,
  isQuickCreateModeAvailable,
  quickCreateModeItems,
  resolveAvailableQuickCreateMode,
  setQuickCreateMusicModeEnabled,
} from './quickCreateModeAvailability'

describe('quickCreateModeAvailability', () => {
  afterEach(() => {
    setQuickCreateMusicModeEnabled(false)
  })

  it('默认不对外开放音乐模式，其余模式全部可见', () => {
    expect(isQuickCreateModeAvailable('music')).toBe(false)
    expect(quickCreateModeItems().map((item) => item.id)).toEqual([
      'image',
      'reverse',
      'video',
      'audio',
      'transcribe',
    ])
  })

  it('隐藏只影响入口清单，模式定义与文案仍然完整保留', () => {
    expect(MODE_ITEMS.map((item) => item.id)).toContain('music')
    expect(MODE_ITEMS.find((item) => item.id === 'music')?.label).toBe('音乐')
  })

  it('放开开关后音乐模式立即回到可见清单，且顺序不变', () => {
    setQuickCreateMusicModeEnabled(true)
    expect(isQuickCreateModeAvailable('music')).toBe(true)
    expect(quickCreateModeItems().map((item) => item.id)).toEqual(MODE_ITEMS.map((item) => item.id))
  })

  it('被隐藏的模式会收窄到默认模式（历史偏好 / 旧任务复用不会露出隐形入口）', () => {
    expect(DEFAULT_QUICK_CREATE_MODE).toBe('image')
    expect(resolveAvailableQuickCreateMode('music')).toBe('image')
    expect(resolveAvailableQuickCreateMode(undefined)).toBe('image')
    expect(resolveAvailableQuickCreateMode(null)).toBe('image')
    expect(resolveAvailableQuickCreateMode('transcribe')).toBe('transcribe')

    setQuickCreateMusicModeEnabled(true)
    expect(resolveAvailableQuickCreateMode('music')).toBe('music')
  })
})

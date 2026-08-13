import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPTY_HERO_THEME,
  EMPTY_HERO_THEMES,
  EMPTY_HERO_THEME_IDS,
  getClassicEmptyHeroTitle,
  getEmptyHeroTitleLines,
  getEmptyHeroTheme,
  getLocalTimeGreeting,
  isEmptyHeroThemeId,
} from './emptyHeroThemes'

describe('empty conversation themes', () => {
  it('applies the celestial (星图工作台) theme by default', () => {
    expect(DEFAULT_EMPTY_HERO_THEME).toBe('celestial')
  })

  it('defines five unique selectable themes', () => {
    expect(EMPTY_HERO_THEMES).toHaveLength(5)
    expect(new Set(EMPTY_HERO_THEMES.map((theme) => theme.id)).size).toBe(5)
    expect(EMPTY_HERO_THEMES.map((theme) => theme.id)).toEqual(EMPTY_HERO_THEME_IDS)
  })

  it('validates persisted theme ids and falls back safely', () => {
    expect(isEmptyHeroThemeId('midnight')).toBe(true)
    expect(isEmptyHeroThemeId('none')).toBe(true)
    expect(isEmptyHeroThemeId('luminous')).toBe(false)
    expect(isEmptyHeroThemeId('unknown')).toBe(false)
    expect(getEmptyHeroTheme('geometry').name).toBe('几何引擎')
    expect(getEmptyHeroTheme('unknown' as never).id).toBe(DEFAULT_EMPTY_HERO_THEME)
  })

  it('uses the local hour for the celestial greeting', () => {
    expect(getLocalTimeGreeting(4)).toBe('晚上好')
    expect(getLocalTimeGreeting(5)).toBe('早上好')
    expect(getLocalTimeGreeting(11)).toBe('早上好')
    expect(getLocalTimeGreeting(12)).toBe('下午好')
    expect(getLocalTimeGreeting(17)).toBe('下午好')
    expect(getLocalTimeGreeting(18)).toBe('晚上好')
  })

  it('keeps non-celestial theme titles unchanged', () => {
    expect(getEmptyHeroTitleLines(getEmptyHeroTheme('celestial'), 20)).toEqual(['晚上好，继续推进'])
    expect(getEmptyHeroTitleLines(getEmptyHeroTheme('midnight'), 9)).toEqual(['夜深了，灵感正清醒'])
  })

  it('restores the classic time-based title when no theme is applied', () => {
    expect(getClassicEmptyHeroTitle(4)).toBe('稳步推进当前任务')
    expect(getClassicEmptyHeroTitle(5)).toBe('早安，准备开始')
    expect(getClassicEmptyHeroTitle(11)).toBe('下午好，继续推进')
    expect(getClassicEmptyHeroTitle(18)).toBe('晚上好，整理下一步')
  })
})

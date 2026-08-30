import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPTY_HERO_THEME,
  EMPTY_HERO_THEMES,
  EMPTY_HERO_THEME_IDS,
  getEmptyHeroTitleLines,
  getEmptyHeroTheme,
  getLocalTimeGreeting,
  isEmptyHeroThemeId,
} from './emptyHeroThemes'

describe('empty conversation themes', () => {
  it('applies the celestial (星图工作台) theme by default', () => {
    expect(DEFAULT_EMPTY_HERO_THEME).toBe('celestial')
  })

  it('keeps celestial as the only registered theme', () => {
    expect(EMPTY_HERO_THEMES).toHaveLength(1)
    expect(EMPTY_HERO_THEMES.map((theme) => theme.id)).toEqual(EMPTY_HERO_THEME_IDS)
    expect(EMPTY_HERO_THEME_IDS).toEqual(['celestial'])
  })

  it('rejects retired theme ids so persisted settings fall back to celestial', () => {
    // none / studio / midnight / geometry 已下线：旧持久化值被守卫拒绝后回退默认星图。
    expect(isEmptyHeroThemeId('celestial')).toBe(true)
    expect(isEmptyHeroThemeId('none')).toBe(false)
    expect(isEmptyHeroThemeId('studio')).toBe(false)
    expect(isEmptyHeroThemeId('midnight')).toBe(false)
    expect(isEmptyHeroThemeId('geometry')).toBe(false)
    expect(isEmptyHeroThemeId('luminous')).toBe(false)
    expect(isEmptyHeroThemeId('unknown')).toBe(false)
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

  it('builds the greeting title for the celestial hero', () => {
    expect(getEmptyHeroTitleLines(20)).toEqual(['晚上好，继续推进'])
    expect(getEmptyHeroTitleLines(9)).toEqual(['早上好，继续推进'])
    expect(getEmptyHeroTitleLines(14)).toEqual(['下午好，继续推进'])
  })
})

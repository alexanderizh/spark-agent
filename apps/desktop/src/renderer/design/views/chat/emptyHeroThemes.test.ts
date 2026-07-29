import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMPTY_HERO_THEME,
  EMPTY_HERO_THEMES,
  EMPTY_HERO_THEME_IDS,
  getEmptyHeroTheme,
  isEmptyHeroThemeId,
} from './emptyHeroThemes'

describe('empty conversation themes', () => {
  it('defines six unique selectable themes', () => {
    expect(EMPTY_HERO_THEMES).toHaveLength(6)
    expect(new Set(EMPTY_HERO_THEMES.map((theme) => theme.id)).size).toBe(6)
    expect(EMPTY_HERO_THEMES.map((theme) => theme.id)).toEqual(EMPTY_HERO_THEME_IDS)
  })

  it('validates persisted theme ids and falls back safely', () => {
    expect(isEmptyHeroThemeId('midnight')).toBe(true)
    expect(isEmptyHeroThemeId('unknown')).toBe(false)
    expect(getEmptyHeroTheme('moss').name).toBe('苔原晨光')
    expect(getEmptyHeroTheme('unknown' as never).id).toBe(DEFAULT_EMPTY_HERO_THEME)
  })
})

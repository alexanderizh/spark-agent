import { describe, expect, it } from 'vitest'
import {
  APP_SKIN_IDS,
  DEFAULT_APP_SKIN,
  getAppSkin,
  isAppSkinId,
  SKIN_ASSET_BUDGET_BYTES,
} from './skinRegistry'

describe('app skin registry', () => {
  it('ships verdant as the default skin so first launch already looks styled', () => {
    expect(DEFAULT_APP_SKIN).toBe('verdant')
    expect(APP_SKIN_IDS).toContain('none')
    expect(APP_SKIN_IDS).toEqual(['none', 'verdant', 'dawnmelt', 'deepspace'])
  })

  it('rejects unknown ids so persisted settings fall back to the default skin', () => {
    expect(isAppSkinId('verdant')).toBe(true)
    expect(isAppSkinId('none')).toBe(true)
    expect(isAppSkinId('celestial')).toBe(false)
    expect(isAppSkinId('studio')).toBe(false)
    expect(isAppSkinId(undefined)).toBe(false)
    expect(isAppSkinId(42)).toBe(false)
    expect(getAppSkin('studio' as never).id).toBe(DEFAULT_APP_SKIN)
  })

  it('declares both light and dark artwork for every skin', () => {
    for (const id of APP_SKIN_IDS) {
      const skin = getAppSkin(id)
      expect(skin.id).toBe(id)
      if (id === 'none') continue
      expect(skin.backdrop.light).toMatch(/^\/skins\/[a-z]+-light\.webp$/)
      expect(skin.backdrop.dark).toMatch(/^\/skins\/[a-z]+-dark\.webp$/)
      expect(skin.scrim.light).toBeGreaterThanOrEqual(0.1)
      expect(skin.scrim.light).toBeLessThanOrEqual(0.5)
      expect(skin.scrim.dark).toBeGreaterThanOrEqual(0.1)
      expect(skin.scrim.dark).toBeLessThanOrEqual(0.5)
    }
  })

  it('keeps the bundled artwork budget at 2.5MB total', () => {
    expect(SKIN_ASSET_BUDGET_BYTES).toBe(2_500_000)
  })
})

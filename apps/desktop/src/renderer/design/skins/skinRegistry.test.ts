import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  APP_SKINS,
  APP_SKIN_IDS,
  DEFAULT_APP_SKIN,
  getAppSkin,
  isAppSkinId,
  SKIN_ASSET_BUDGET_BYTES,
} from './skinRegistry'

describe('app skin registry', () => {
  it('ships verdant as the default skin so first launch already looks styled', () => {
    expect(DEFAULT_APP_SKIN).toBe('verdant')
    expect(APP_SKIN_IDS).toEqual(['none', 'verdant', 'dawnmelt', 'deepspace'])
  })

  it('registers exactly one skin entry per whitelisted id', () => {
    expect(APP_SKINS).toHaveLength(APP_SKIN_IDS.length)
    expect(APP_SKINS.map((skin) => skin.id)).toEqual([...APP_SKIN_IDS])
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
      if (id === 'none') {
        // none 的空串是 SkinBackdrop（后续任务）「不渲染插画」的判定依据，改坏必须报警。
        expect(skin.backdrop).toEqual({ light: '', dark: '' })
        continue
      }
      expect(skin.backdrop.light).toBe(`/skins/${id}-light.webp`)
      expect(skin.backdrop.dark).toBe(`/skins/${id}-dark.webp`)
      expect(skin.scrim.light).toBeGreaterThanOrEqual(0.1)
      expect(skin.scrim.light).toBeLessThanOrEqual(0.5)
      expect(skin.scrim.dark).toBeGreaterThanOrEqual(0.1)
      expect(skin.scrim.dark).toBeLessThanOrEqual(0.5)
    }
  })

  it('ships every declared artwork file in the bundle', () => {
    const skinAssetDir = fileURLToPath(new URL('../../../../public/skins/', import.meta.url))
    for (const skin of APP_SKINS.filter((entry) => entry.id !== 'none')) {
      for (const mode of ['light', 'dark'] as const) {
        const declared = skin.backdrop[mode]
        expect(existsSync(join(skinAssetDir, basename(declared))), `${declared} 未随包`).toBe(true)
      }
    }
  })

  it('keeps the bundled artwork budget at 2.5MB total', () => {
    // 这里只锁死产品红线数值；真实体积门禁由插画资产产线脚本执行（PR-1 Task 6 落地后回填路径）。
    expect(SKIN_ASSET_BUDGET_BYTES).toBe(2_500_000)
  })
})

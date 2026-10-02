/**
 * 应用皮肤注册表（PR-1）。
 *
 * 皮肤 = 明暗两版整窗插画 + 默认可读性遮罩浓度。这里只放"数据"，背景与纱层样式
 * 将由 SkinBackdrop.less（后续任务）按 [data-app-skin] 作用域声明；非法/旧版本
 * 持久化值先由 isAppSkinId 守卫拒绝，再由 getAppSkin 回退默认皮肤（同
 * emptyHeroThemes 的回退思路）。
 *
 * 美术口径（v2 决策 D2/D3、设计文档 §4.5）：AI 只出候选，皮肤必须经人工审美评审
 * 后才能入库。
 */
export const APP_SKIN_IDS = ['none', 'verdant', 'dawnmelt', 'deepspace'] as const

export type AppSkinId = (typeof APP_SKIN_IDS)[number]

export type AppSkin = {
  id: AppSkinId
  name: string
  description: string
  /** `none` 无插画，其余皮肤给出随包 WebP 路径（Vite public 根）。 */
  backdrop: { light: string; dark: string }
  /** 可读性纱层透明度：浅色白纱、深色黑纱。 */
  scrim: { light: number; dark: number }
}

export const DEFAULT_APP_SKIN: AppSkinId = 'verdant'

/** 随包插画总量预算红线（设计文档 §4.2）。 */
export const SKIN_ASSET_BUDGET_BYTES = 2_500_000

export const APP_SKINS: readonly AppSkin[] = [
  {
    id: 'none',
    name: '不使用皮肤',
    description: '恢复默认应用底色',
    backdrop: { light: '', dark: '' },
    scrim: { light: 0.1, dark: 0.1 },
  },
  {
    id: 'verdant',
    name: '溪谷晨风',
    description: '水彩青绿山林，通透晨光',
    backdrop: { light: '/skins/verdant-light.webp', dark: '/skins/verdant-dark.webp' },
    scrim: { light: 0.18, dark: 0.34 },
  },
  {
    id: 'dawnmelt',
    name: '晨雾暖阳',
    description: '浅暖米金，柔光纸感',
    backdrop: { light: '/skins/dawnmelt-light.webp', dark: '/skins/dawnmelt-dark.webp' },
    scrim: { light: 0.16, dark: 0.32 },
  },
  {
    id: 'deepspace',
    name: '深空墨蓝',
    description: '低眩光深色，夜间专注',
    backdrop: { light: '/skins/deepspace-light.webp', dark: '/skins/deepspace-dark.webp' },
    scrim: { light: 0.22, dark: 0.3 },
  },
]

export function isAppSkinId(value: unknown): value is AppSkinId {
  return typeof value === 'string' && (APP_SKIN_IDS as readonly string[]).includes(value)
}

export function getAppSkin(id: AppSkinId): AppSkin {
  const selected = APP_SKINS.find((skin) => skin.id === id)
  if (selected != null) return selected
  const fallback = APP_SKINS.find((skin) => skin.id === DEFAULT_APP_SKIN)
  if (fallback == null) throw new Error('App skin registry must not be empty')
  return fallback
}

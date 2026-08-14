/**
 * 空会话 Hero 主题注册表。
 *
 * 星图工作台是应用唯一的空会话主题，配色跟随全局「主题色」（--primary）联动；
 * 保留注册表与 tweak 持久化结构，是为了兼容历史设置记录——已下线的主题值
 * （none/studio/midnight/geometry）会被 isEmptyHeroThemeId 守卫拒绝并回退到星图。
 */
export const EMPTY_HERO_THEME_IDS = ['celestial'] as const

export type EmptyHeroThemeId = (typeof EMPTY_HERO_THEME_IDS)[number]

export type EmptyHeroTheme = {
  id: EmptyHeroThemeId
  name: string
  eyebrow: string
  body: string
}

export const DEFAULT_EMPTY_HERO_THEME: EmptyHeroThemeId = 'celestial'

export const EMPTY_HERO_THEMES: readonly EmptyHeroTheme[] = [
  {
    id: 'celestial',
    name: '星图工作台',
    eyebrow: 'SPARK WORKSPACE',
    body: '把想法交给 Agent，剩下的交给我们。',
  },
] as const

export function isEmptyHeroThemeId(value: unknown): value is EmptyHeroThemeId {
  return typeof value === 'string' && EMPTY_HERO_THEME_IDS.includes(value as EmptyHeroThemeId)
}

export function getEmptyHeroTheme(id: EmptyHeroThemeId): EmptyHeroTheme {
  const selected = EMPTY_HERO_THEMES.find((theme) => theme.id === id)
  if (selected != null) return selected
  const fallback = EMPTY_HERO_THEMES.find((theme) => theme.id === DEFAULT_EMPTY_HERO_THEME)
  if (fallback == null) throw new Error('Empty hero theme registry must not be empty')
  return fallback
}

export function getLocalTimeGreeting(hour = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 18) return '下午好'
  return '晚上好'
}

export function getEmptyHeroTitleLines(localHour?: number): string[] {
  return [`${getLocalTimeGreeting(localHour)}，继续推进`]
}

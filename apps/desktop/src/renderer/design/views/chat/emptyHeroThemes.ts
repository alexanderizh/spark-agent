/**
 * 空会话 Hero 主题注册表。
 *
 * 星图工作台是应用唯一的空会话主题，配色跟随全局「主题色」（--primary）联动；
 * 保留注册表与 tweak 持久化结构，是为了兼容历史设置记录——已下线的主题值
 * （none/studio/midnight/geometry）会被 isEmptyHeroThemeId 守卫拒绝并回退到星图。
 */
import { getLocalTimeGreeting } from '@spark/shared'

export const EMPTY_HERO_THEME_IDS = ['celestial'] as const

export type EmptyHeroThemeId = (typeof EMPTY_HERO_THEME_IDS)[number]

export type EmptyHeroTheme = {
  id: EmptyHeroThemeId
  name: string
  eyebrow: string
}

export const DEFAULT_EMPTY_HERO_THEME: EmptyHeroThemeId = 'celestial'

export const EMPTY_HERO_THEMES: readonly EmptyHeroTheme[] = [
  {
    id: 'celestial',
    name: '星图工作台',
    eyebrow: 'SPARK WORKSPACE',
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

/**
 * 时段问候语的真身下沉在 @spark/shared（主进程构造问候语 prompt、渲染端兜底、
 * 服务层校验「{时段}好，」前缀三处必须共用同一时段边界），这里原样透出，
 * 保持既有引用面不变。
 */
export { getLocalTimeGreeting } from '@spark/shared'

/** 模型生成失败 / 未配置模型 / 生成中时的本地兜底标题（写死文案）。 */
export function getEmptyHeroTitleLines(localHour?: number): string[] {
  return [`${getLocalTimeGreeting(localHour)}，继续推进`]
}

/**
 * 模型生成文案非空时整句替换兜底标题，否则回退到写死文案。
 *
 * 渲染端只做「非空」这一层最薄的守卫：内容本身的清洗（去引号、截断、
 * 强制时段前缀）由主进程 greeting service 负责，这里不重复实现。
 */
export function resolveEmptyHeroTitleLines(
  localHour?: number,
  generatedText?: string | null,
): string[] {
  const text = typeof generatedText === 'string' ? generatedText.trim() : ''
  if (text.length > 0) return [text]
  return getEmptyHeroTitleLines(localHour)
}

export const EMPTY_HERO_THEME_IDS = [
  'none',
  'celestial',
  'studio',
  'midnight',
  'geometry',
] as const

export type EmptyHeroThemeId = (typeof EMPTY_HERO_THEME_IDS)[number]

export type EmptyHeroTheme = {
  id: EmptyHeroThemeId
  name: string
  description: string
  eyebrow: string
  titleLines: string[]
  body: string
  preview: string
}

export const DEFAULT_EMPTY_HERO_THEME: EmptyHeroThemeId = 'celestial'

export const EMPTY_HERO_THEMES: readonly EmptyHeroTheme[] = [
  {
    id: 'none',
    name: '不应用主题',
    description: '恢复经典空会话样式',
    eyebrow: '',
    titleLines: [],
    body: '',
    preview: 'linear-gradient(135deg, #f5f5f5 0%, #ffffff 100%)',
  },
  {
    id: 'celestial',
    name: '星图工作台',
    description: '轻盈星轨与通透卡片',
    eyebrow: 'SPARK WORKSPACE',
    titleLines: ['下午好，继续推进'],
    body: '把想法交给 Agent，剩下的交给我们。',
    preview: 'linear-gradient(135deg, #f8f5ff 0%, #8b7cff 58%, #506cff 100%)',
  },
  {
    id: 'studio',
    name: '灵感工作桌',
    description: '温暖纸感与编辑拼贴',
    eyebrow: 'TODAY · SPARK AGENT',
    titleLines: ['把今天，变成进展'],
    body: '挑一个起点，或者直接告诉我你想完成什么。',
    preview: 'linear-gradient(135deg, #fff8ed 0%, #ff8a72 52%, #a78bfa 100%)',
  },
  {
    id: 'midnight',
    name: '午夜星港',
    description: '低眩光深色专注模式',
    eyebrow: 'NIGHT SHIFT · READY',
    titleLines: ['夜深了，灵感正清醒'],
    body: '从一个想法开始，让 Agent 陪你把它完成。',
    preview: 'linear-gradient(135deg, #090b18 0%, #29245e 58%, #745cff 100%)',
  },
  {
    id: 'geometry',
    name: '几何引擎',
    description: '大胆构成与品牌张力',
    eyebrow: 'SPARK / BUILD / SHIP',
    titleLines: ['想法就位', '现在，开始创造'],
    body: '从快捷动作出发，也可以直接描述你的目标。',
    preview: 'linear-gradient(135deg, #faf8f2 0 34%, #3155e7 34% 67%, #f05a47 67%)',
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

export function getClassicEmptyHeroTitle(hour = new Date().getHours()): string {
  if (hour < 5) return '稳步推进当前任务'
  if (hour < 11) return '早安，准备开始'
  if (hour < 18) return '下午好，继续推进'
  return '晚上好，整理下一步'
}

export function getEmptyHeroTitleLines(theme: EmptyHeroTheme, localHour?: number): string[] {
  if (theme.id !== 'celestial') return theme.titleLines
  return [`${getLocalTimeGreeting(localHour)}，继续推进`]
}

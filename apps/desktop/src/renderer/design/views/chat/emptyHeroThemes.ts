export const EMPTY_HERO_THEME_IDS = [
  'celestial',
  'studio',
  'luminous',
  'midnight',
  'moss',
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
    id: 'luminous',
    name: '光场控制台',
    description: '冰川玻璃与阶梯卡片',
    eyebrow: 'READY · 04 TOOLS',
    titleLines: ['从一个指令，抵达结果'],
    body: '选择快捷入口，或直接开始一段新任务。',
    preview: 'linear-gradient(135deg, #f4f8ff 0%, #7c8cff 55%, #64d9ff 100%)',
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
    id: 'moss',
    name: '苔原晨光',
    description: '安静自然与有机秩序',
    eyebrow: 'A QUIET START',
    titleLines: ['慢一点，也能走得很远'],
    body: '整理思路，选择方向，然后开始。',
    preview: 'linear-gradient(135deg, #f6f5ef 0%, #9caf88 60%, #526b4a 100%)',
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
  const fallback = EMPTY_HERO_THEMES[0]
  if (fallback == null) throw new Error('Empty hero theme registry must not be empty')
  return fallback
}

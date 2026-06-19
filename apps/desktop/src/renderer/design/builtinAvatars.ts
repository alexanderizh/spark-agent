const modules = import.meta.glob('../assets/builtin-avatars/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

export type BuiltinAvatarCategory = 'default' | 'animal' | 'person' | 'guofeng'

export interface BuiltinAvatar {
  id: string
  category: BuiltinAvatarCategory
  label: string
  src: string
}

const CATEGORY_LABELS: Record<BuiltinAvatarCategory, string> = {
  default: '默认',
  animal: '动物',
  person: '人物',
  guofeng: '国风',
}

const PINNED_DEFAULT_IDS = ['user-default', 'agent-default', 'team-default', 'platform-manager']

export const BUILTIN_AVATAR_LABELS = CATEGORY_LABELS
export const DEFAULT_USER_AVATAR_ID = 'user-default'
export const DEFAULT_AGENT_AVATAR_ID = 'agent-default'
export const DEFAULT_TEAM_AVATAR_ID = 'team-default'
export const PLATFORM_MANAGER_AVATAR_ID = 'platform-manager'

export const BUILTIN_AVATARS: BuiltinAvatar[] = Object.entries(modules)
  .map(([file, src]) => {
    const id =
      file
        .split('/')
        .pop()
        ?.replace(/\.png$/, '') ?? ''
    return {
      id,
      src,
      category: inferCategory(id),
      label: idToLabel(id),
    }
  })
  .filter((avatar) => avatar.id.length > 0)
  .sort((a, b) => sortAvatar(a) - sortAvatar(b) || a.id.localeCompare(b.id))

export const BUILTIN_AVATAR_IDS = new Set(BUILTIN_AVATARS.map((avatar) => avatar.id))

export function getBuiltinAvatarSrc(id: string): string | null {
  return BUILTIN_AVATARS.find((avatar) => avatar.id === id)?.src ?? null
}

export function pickBuiltinAvatarId(
  seed: string,
  category: BuiltinAvatarCategory = 'animal',
): string {
  const candidates = BUILTIN_AVATARS.filter((avatar) => avatar.category === category)
  if (candidates.length === 0) return DEFAULT_AGENT_AVATAR_ID
  const normalized = seed.trim() || category
  return candidates[hashString(normalized) % candidates.length]!.id
}

function inferCategory(id: string): BuiltinAvatarCategory {
  if (id.startsWith('animal-')) return 'animal'
  if (id.startsWith('person-')) return 'person'
  if (id.startsWith('guofeng-')) return 'guofeng'
  return 'default'
}

function idToLabel(id: string): string {
  if (id === DEFAULT_USER_AVATAR_ID) return '用户默认'
  if (id === DEFAULT_AGENT_AVATAR_ID) return 'Agent 默认'
  if (id === DEFAULT_TEAM_AVATAR_ID) return '团队默认'
  if (id === PLATFORM_MANAGER_AVATAR_ID) return '平台管理'
  return id
    .replace(/^(animal|person|guofeng)-/, '')
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function sortAvatar(avatar: BuiltinAvatar): number {
  const pinned = PINNED_DEFAULT_IDS.indexOf(avatar.id)
  if (pinned >= 0) return pinned
  const categoryOrder: Record<BuiltinAvatarCategory, number> = {
    default: 0,
    animal: 10,
    person: 20,
    guofeng: 30,
  }
  return categoryOrder[avatar.category]
}

function hashString(value: string): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 33) ^ value.charCodeAt(i)
  }
  return hash >>> 0
}

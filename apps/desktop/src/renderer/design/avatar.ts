import { hashAgentId } from '@spark/shared'
import {
  BUILTIN_AVATAR_IDS,
  DEFAULT_AGENT_AVATAR_ID,
  DEFAULT_USER_AVATAR_ID,
  PLATFORM_MANAGER_AVATAR_ID,
  getBuiltinAvatarSrc,
  pickBuiltinAvatarId,
} from './builtinAvatars'

export type SparkAvatarConfig =
  | { kind: 'url'; url: string }
  | { kind: 'builtin'; id: string }
  | { kind: 'dicebear'; seed: string; style?: string }
  | { kind: 'upload'; dataUrl: string }

const DEFAULT_DICEBEAR_STYLE = 'shapes'
const DICEBEAR_STYLES = [
  'adventurer',
  'avataaars',
  'bottts',
  'lorelei',
  'micah',
  'notionists',
  'pixel-art',
]

export function normalizeAvatarConfig(value: unknown): SparkAvatarConfig | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    record.kind === 'upload' &&
    typeof record.dataUrl === 'string' &&
    record.dataUrl.startsWith('data:image/')
  ) {
    return { kind: 'upload', dataUrl: record.dataUrl }
  }
  if (record.kind === 'url' && typeof record.url === 'string' && record.url.trim().length > 0) {
    return { kind: 'url', url: record.url.trim() }
  }
  if (record.kind === 'builtin' && typeof record.id === 'string') {
    const id = record.id.trim()
    if (id === 'guest') return { kind: 'builtin', id: DEFAULT_USER_AVATAR_ID }
    if (BUILTIN_AVATAR_IDS.has(id)) return { kind: 'builtin', id }
  }
  if (
    record.kind === 'dicebear' &&
    typeof record.seed === 'string' &&
    record.seed.trim().length > 0
  ) {
    return {
      kind: 'dicebear',
      seed: record.seed.trim(),
      ...(typeof record.style === 'string' && record.style.trim()
        ? { style: record.style.trim() }
        : {}),
    }
  }
  return null
}

export function createDicebearAvatar(
  seed: string,
  style = DEFAULT_DICEBEAR_STYLE,
): SparkAvatarConfig {
  return { kind: 'dicebear', seed: seed.trim() || 'spark-agent', style }
}

export function generateDefaultAvatarUrl(seed: string, style?: string): string {
  return generateLocalAvatarDataUrl(seed, style)
}

export function createDefaultAvatar(seed: string): SparkAvatarConfig {
  return { kind: 'builtin', id: pickBuiltinAvatarId(seed) }
}

export function createBuiltinAvatar(id: string): SparkAvatarConfig {
  return { kind: 'builtin', id: BUILTIN_AVATAR_IDS.has(id) ? id : DEFAULT_AGENT_AVATAR_ID }
}

export function getAgentAvatarConfig(
  metadata: Record<string, unknown> | undefined,
  _agentId: string,
  _name: string,
): SparkAvatarConfig {
  return normalizeAvatarConfig(metadata?.avatar) ?? { kind: 'builtin', id: DEFAULT_AGENT_AVATAR_ID }
}

/**
 * 用户是否显式配置了头像（区别于 `getAgentAvatarConfig` 的 fallback 默认头像）。
 * 用于在选择器等位置判断是否展示图片，而不是继续用内置默认图标。
 */
export function hasCustomAvatar(metadata: Record<string, unknown> | undefined): boolean {
  return normalizeAvatarConfig(metadata?.avatar) != null
}

export function getUserAvatarConfig(value: unknown): SparkAvatarConfig {
  return normalizeAvatarConfig(value) ?? { kind: 'builtin', id: DEFAULT_USER_AVATAR_ID }
}

export function getGuestAvatarConfig(): SparkAvatarConfig {
  return { kind: 'builtin', id: DEFAULT_USER_AVATAR_ID }
}

export function resolveAvatarSrc(config: SparkAvatarConfig): string {
  if (config.kind === 'upload') return config.dataUrl
  if (config.kind === 'url') return config.url
  if (config.kind === 'builtin') {
    return (
      getBuiltinAvatarSrc(config.id === 'guest' ? DEFAULT_USER_AVATAR_ID : config.id) ??
      getBuiltinAvatarSrc(PLATFORM_MANAGER_AVATAR_ID) ??
      ''
    )
  }
  return generateLocalAvatarDataUrl(config.seed || 'spark-agent', config.style)
}

export function avatarConfigEquals(a: SparkAvatarConfig, b: SparkAvatarConfig): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'upload' && b.kind === 'upload') return a.dataUrl === b.dataUrl
  if (a.kind === 'url' && b.kind === 'url') return a.url === b.url
  if (a.kind === 'builtin' && b.kind === 'builtin') return a.id === b.id
  if (a.kind === 'dicebear' && b.kind === 'dicebear') {
    return (
      a.seed === b.seed &&
      (a.style ?? DEFAULT_DICEBEAR_STYLE) === (b.style ?? DEFAULT_DICEBEAR_STYLE)
    )
  }
  return false
}

function pickDicebearStyle(seed: string): string {
  const input = seed.trim() || 'spark-agent'
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return DICEBEAR_STYLES[(hash >>> 0) % DICEBEAR_STYLES.length]!
}

function generateLocalAvatarDataUrl(seed: string, style?: string): string {
  const input = seed.trim() || 'Spark'
  const selectedStyle = style ?? pickDicebearStyle(input)
  const hue = hashAgentId(`${selectedStyle}:${input}`) % 360
  const initials = getInitials(input)
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    '<defs>',
    `<linearGradient id="g" x1="16" y1="8" x2="82" y2="88"><stop stop-color="hsl(${hue},76%,60%)"/><stop offset="1" stop-color="hsl(${(hue + 48) % 360},72%,46%)"/></linearGradient>`,
    '</defs>',
    '<rect width="96" height="96" rx="28" fill="url(#g)"/>',
    `<circle cx="72" cy="24" r="14" fill="hsla(${(hue + 120) % 360},80%,92%,0.28)"/>`,
    `<circle cx="24" cy="72" r="18" fill="hsla(${(hue + 220) % 360},80%,92%,0.2)"/>`,
    `<text x="48" y="56" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${initials.length > 1 ? 28 : 34}" font-weight="700" fill="white">${escapeSvgText(initials)}</text>`,
    '</svg>',
  ].join('')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getInitials(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'S'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  return [...trimmed].slice(0, 2).join('').toUpperCase()
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function getAvatarFallback(seed: string, name: string): { background: string } {
  const trimmed = name.trim() || seed.trim() || 'Spark'
  const hue = hashAgentId(seed || trimmed) % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 42) % 360}, 70%, 48%))`,
  }
}

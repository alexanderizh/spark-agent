import { hashAgentId } from '@spark/shared'

export type SparkAvatarConfig =
  | { kind: 'url'; url: string }
  | { kind: 'dicebear'; seed: string; style?: string }
  | { kind: 'upload'; dataUrl: string }

const DEFAULT_DICEBEAR_STYLE = 'shapes'
const DICEBEAR_BASE = 'https://api.dicebear.com/9.x'
const DICEBEAR_STYLES = ['adventurer', 'avataaars', 'bottts', 'lorelei', 'micah', 'notionists', 'pixel-art']

export function normalizeAvatarConfig(value: unknown): SparkAvatarConfig | null {
  if (value == null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (record.kind === 'upload' && typeof record.dataUrl === 'string' && record.dataUrl.startsWith('data:image/')) {
    return { kind: 'upload', dataUrl: record.dataUrl }
  }
  if (record.kind === 'url' && typeof record.url === 'string' && record.url.trim().length > 0) {
    return { kind: 'url', url: record.url.trim() }
  }
  if (record.kind === 'dicebear' && typeof record.seed === 'string' && record.seed.trim().length > 0) {
    return {
      kind: 'dicebear',
      seed: record.seed.trim(),
      ...(typeof record.style === 'string' && record.style.trim() ? { style: record.style.trim() } : {}),
    }
  }
  return null
}

export function createDicebearAvatar(seed: string, style = DEFAULT_DICEBEAR_STYLE): SparkAvatarConfig {
  return { kind: 'dicebear', seed: seed.trim() || 'spark-agent', style }
}

export function generateDefaultAvatarUrl(seed: string, style?: string): string {
  const selectedStyle = style ?? pickDicebearStyle(seed)
  return `${DICEBEAR_BASE}/${encodeURIComponent(selectedStyle)}/svg?seed=${encodeURIComponent(seed.trim() || 'spark-agent')}`
}

export function createDefaultAvatar(seed: string): SparkAvatarConfig {
  return { kind: 'url', url: generateDefaultAvatarUrl(seed) }
}

export function getAgentAvatarConfig(metadata: Record<string, unknown> | undefined, agentId: string, name: string): SparkAvatarConfig {
  return normalizeAvatarConfig(metadata?.avatar) ?? createDefaultAvatar(name || agentId || 'agent')
}

export function getUserAvatarConfig(value: unknown): SparkAvatarConfig {
  return normalizeAvatarConfig(value) ?? createDefaultAvatar('User')
}

export function resolveAvatarSrc(config: SparkAvatarConfig): string {
  if (config.kind === 'upload') return config.dataUrl
  if (config.kind === 'url') return config.url
  const style = encodeURIComponent(config.style || DEFAULT_DICEBEAR_STYLE)
  const seed = encodeURIComponent(config.seed || 'spark-agent')
  return `${DICEBEAR_BASE}/${style}/svg?seed=${seed}&radius=18&backgroundType=gradientLinear`
}

export function avatarConfigEquals(a: SparkAvatarConfig, b: SparkAvatarConfig): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'upload' && b.kind === 'upload') return a.dataUrl === b.dataUrl
  if (a.kind === 'url' && b.kind === 'url') return a.url === b.url
  if (a.kind === 'dicebear' && b.kind === 'dicebear') {
    return a.seed === b.seed && (a.style ?? DEFAULT_DICEBEAR_STYLE) === (b.style ?? DEFAULT_DICEBEAR_STYLE)
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

export function getAvatarFallback(seed: string, name: string): { background: string } {
  const trimmed = name.trim() || seed.trim() || 'Spark'
  const hue = hashAgentId(seed || trimmed) % 360
  return {
    background: `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 42) % 360}, 70%, 48%))`,
  }
}

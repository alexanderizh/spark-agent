export type AuthIdentifierKind = 'email' | 'phone'

export const PHONE_RE = /^1[3-9]\d{9}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function inferIdentifierKind(value: unknown, smsEnabled: boolean): AuthIdentifierKind {
  if (!smsEnabled) return 'email'
  const normalized = String(value ?? '').trim()
  return /^1\d*$/.test(normalized) ? 'phone' : 'email'
}

/** Redis 验证码键对邮箱大小写不敏感，手机号保持原样。 */
export function normalizeVerificationTarget(value: unknown): string {
  const normalized = String(value ?? '').trim()
  return normalized.includes('@') ? normalized.toLowerCase() : normalized
}

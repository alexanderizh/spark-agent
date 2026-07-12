export type AuthIdentifierKind = 'email' | 'phone'

export const PHONE_RE = /^1[3-9]\d{9}$/
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function inferIdentifierKind(value: unknown, smsEnabled: boolean): AuthIdentifierKind {
  if (!smsEnabled) return 'email'
  const normalized = String(value ?? '').trim()
  return /^1\d*$/.test(normalized) ? 'phone' : 'email'
}

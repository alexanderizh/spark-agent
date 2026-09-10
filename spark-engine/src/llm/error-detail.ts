const MAX_TEXT_LENGTH = 2_048
const MAX_COLLECTION_ITEMS = 24
const MAX_DEPTH = 3
const SENSITIVE_KEY =
  /^(?:api[-_]?key|authorization|credentials?|password|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|auth[-_]?token|bearer)$/iu
const PROVIDER_ERROR_KEYS = new Set([
  'cause',
  'code',
  'message',
  'name',
  'param',
  'request_id',
  'requestId',
  'status',
  'type',
])

/** Make untrusted provider text bounded and safe for terminals and event logs. */
export function safeDiagnosticText(value: string, maxLength = MAX_TEXT_LENGTH): string {
  const normalized = replaceControlCharacters(value).replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

/** Preserve only stable, useful provider-error fields; drop arbitrary response payloads. */
export function safeProviderError(
  value: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined
  const selected = Object.fromEntries(
    Object.entries(value).filter(([key]) => PROVIDER_ERROR_KEYS.has(key)),
  )
  return safeDiagnosticValue(selected) as Record<string, unknown>
}

/** Bound depth/width, redact suspicious keys, and tolerate cycles. */
export function safeDiagnosticValue(value: unknown): unknown {
  return sanitize(value, 0, new WeakSet())
}

/** Keep the useful part of Error.cause without serializing arbitrary objects. */
export function safeErrorCause(
  error: unknown,
  depth = 0,
): { name: string; message: string; code?: string; cause?: unknown } {
  if (!(error instanceof Error)) {
    return { name: 'Error', message: scalarText(error) }
  }
  const errorWithCause = error as Error & { code?: unknown; cause?: unknown }
  const code = errorWithCause.code
  const nested = errorWithCause.cause
  return {
    name: safeDiagnosticText(error.name),
    message: safeDiagnosticText(error.message),
    ...(typeof code === 'string' ? { code: safeDiagnosticText(code) } : {}),
    ...(depth < 2 && nested !== undefined ? { cause: safeErrorCause(nested, depth + 1) } : {}),
  }
}

export function safeErrorCauseSummary(cause: ReturnType<typeof safeErrorCause>): string {
  const parts: string[] = []
  let current: ReturnType<typeof safeErrorCause> | undefined = cause
  while (current) {
    const code = current.code ? `${current.code}: ` : ''
    parts.push(`${code}${current.message}`)
    current = isSafeErrorCause(current.cause) ? current.cause : undefined
  }
  return safeDiagnosticText(parts.join(' → '))
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return safeDiagnosticText(value)
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value
  }
  if (typeof value !== 'object') return scalarText(value)
  if (depth >= MAX_DEPTH) return '[truncated]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_COLLECTION_ITEMS).map((item) => sanitize(item, depth + 1, seen))
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, MAX_COLLECTION_ITEMS)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(item, depth + 1, seen)
  }
  return result
}

function replaceControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    result += codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? ' ' : character
  }
  return result
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return safeDiagnosticText(value)
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'symbol') return `Symbol(${value.description ?? ''})`
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return '[non-Error object]'
}

function isSafeErrorCause(value: unknown): value is ReturnType<typeof safeErrorCause> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { message?: unknown }).message === 'string'
  )
}

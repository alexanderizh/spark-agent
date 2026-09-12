/**
 * Hook 运行日志脱敏（设计方案 §17/§18）：
 * - 日志与运行记录默认只保存字段摘要；Authorization/Cookie/token/secret/password 等
 *   字段强制掩码。
 * - 正文进入动作输入由用户映射决定；摘要一律有界截断，不保存完整敏感输入输出。
 */

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passphrase|api[-_]?key|credential|private[-_]?key/i

/** 摘要里字符串字段的最大保留长度。 */
const MAX_STRING_LENGTH = 512
const MAX_DEPTH = 6
const MAX_ENTRIES = 64

function maskValue(): string {
  return '***'
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth >= MAX_DEPTH) return '[depth-limit]'
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1))
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactValue(value.message, depth + 1) }
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {}
    let count = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (count >= MAX_ENTRIES) {
        result['[truncated]'] = true
        break
      }
      count += 1
      result[key] = isSensitiveKey(key) ? maskValue() : redactValue(item, depth + 1)
    }
    return result
  }
  return String(value)
}

export function summarizeValue(value: unknown): Record<string, unknown> {
  const redacted = redactValue(value)
  return redacted != null && typeof redacted === 'object' && !Array.isArray(redacted)
    ? (redacted as Record<string, unknown>)
    : { value: redacted }
}

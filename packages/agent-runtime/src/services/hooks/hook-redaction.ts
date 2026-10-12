/**
 * Hook 运行日志脱敏（设计方案 §17/§18）：
 * - 日志与运行记录默认只保存字段摘要；Authorization/Cookie/token/secret/password 等
 *   字段强制掩码。
 * - 字符串正文做内容级凭据掩码（键控掩码只对对象键生效，错误正文/回显 URL 等
 *   纯字符串中的凭据在此兜底）。
 * - 正文进入动作输入由用户映射决定；摘要一律有界截断，不保存完整敏感输入输出。
 */

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passphrase|api[-_]?key|credential|private[-_]?key/i

/**
 * 内容级凭据模式（大小写不敏感）：
 * - `sk-…` OpenAI/Anthropic 风格 key；`Bearer …` 授权头；
 * - `AKIA…` AWS 访问键；`ghp_/gho_/github_pat_…` GitHub；`xox[abpr]-…` Slack；
 * - `api_key=…`/`"token": …` 等键值回显（值 ≥12 个凭据字符）。
 */
const CREDENTIAL_CONTENT_PATTERN =
  /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|client[_-]?secret|password)["'=:\s]+[A-Za-z0-9_\-./~+%]{12,})/gi

/**
 * 内容级掩码只扫描首 1024 字符：超出部分随后会被 MAX_STRING_LENGTH 截断，
 * 永不进入日志/账本，无需全量扫描（避免长文本热路径上的正则开销）。
 */
const SCRUB_WINDOW_CHARS = 1024

/** 摘要里字符串字段的最大保留长度。 */
const MAX_STRING_LENGTH = 512
const MAX_DEPTH = 6
const MAX_ENTRIES = 64

function maskValue(): string {
  return '***'
}

/** 字符串内容级凭据掩码：窗口内命中凭据模式即整体替换为 ***。 */
export function scrubCredentials(text: string): string {
  if (text.length <= SCRUB_WINDOW_CHARS) {
    return text.replace(CREDENTIAL_CONTENT_PATTERN, () => '***')
  }
  const head = text.slice(0, SCRUB_WINDOW_CHARS)
  return head.replace(CREDENTIAL_CONTENT_PATTERN, () => '***') + text.slice(SCRUB_WINDOW_CHARS)
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth >= MAX_DEPTH) return '[depth-limit]'
  if (typeof value === 'string') {
    const scrubbed = scrubCredentials(value)
    return scrubbed.length > MAX_STRING_LENGTH
      ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : scrubbed
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

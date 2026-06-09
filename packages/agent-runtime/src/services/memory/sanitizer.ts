/**
 * @module sanitizer
 *
 * 记忆内容敏感信息过滤器
 *
 * 在写入闸门中拦截包含密钥、令牌、私钥等敏感信息的候选记忆。
 * 所有正则集中管理，匹配到任一即丢弃并记录 warning。
 */

import { createLogger } from '@spark/shared'

const log = createLogger('memory:sanitizer')

/**
 * 敏感信息检测正则列表
 *
 * 覆盖：
 *   - 通用 key/secret/password/token 赋值
 *   - PEM 私钥头
 *   - OpenAI sk- 前缀 token
 *   - GitHub ghp_ / gho_ / ghu_ 前缀 token
 *   - Anthropic sk-ant- 前缀 token
 */
const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Generic key/secret/password/token assignments (case-insensitive)
  /(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*\S+/i,
  // PEM private key header
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  // OpenAI tokens
  /sk-[A-Za-z0-9]{20,}/,
  // GitHub tokens
  /gh[pou]_[A-Za-z0-9]{30,}/,
  // Anthropic tokens
  /sk-ant-[A-Za-z0-9\-]{20,}/,
]

/**
 * 检查文本是否包含敏感信息
 *
 * @returns true 表示包含敏感信息（应丢弃）
 */
export function containsSensitiveContent(text: string): boolean {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      log.warn(`[memory] sensitive content blocked (matched ${pattern.source})`)
      return true
    }
  }
  return false
}

/**
 * 同时检查 description 和 body
 *
 * @returns true 表示应丢弃
 */
export function isMemorySensitive(description: string, body: string): boolean {
  return containsSensitiveContent(description) || containsSensitiveContent(body)
}

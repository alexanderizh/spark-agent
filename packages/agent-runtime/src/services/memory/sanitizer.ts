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
  /sk-ant-[A-Za-z0-9-]{20,}/,
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

/**
 * 瞬时数据正则
 *
 * 覆盖 agent 在对话中可能误存的"即时性"信息：今天的日期、当前时间、
 * 单次实时查询结果、本地瞬时值等。这些信息会随时间漂移，存进记忆后
 * 下次读取就会得到错误的旧值，因此必须在写入闸门中拦截。
 *
 * 匹配层级（按信号强度从强到弱）：
 *   - 名字（kebab-case slug）出现瞬时词或 ISO 日期 → 必丢
 *   - 描述含 ISO 日期 + "今天/当前/实时/天气" 之一 → 必丢
 *   - 描述单纯含 ISO 日期 → 必丢（kebab 记忆条目里出现具体日期通常是 bug）
 */
const TRANSIENT_NAME_PATTERNS: ReadonlyArray<RegExp> = [
  // 名字以"今天/现在/当前"开头
  /^(today|todays|today-?s|now|current|实时|今日|今天|当前|此刻|此时此刻)/i,
  // 名字里直接带 ISO 日期（kebab 里出现 2026-06-16 必是 bug）
  /\d{4}-\d{2}-\d{2}/,
  // 名字带"实时数据"类型词
  /(实时|realtime|实时数据|current-value|now-|today-)/i,
  // 名字带实时数据领域词
  /(weather|weather-now|今日天气|今天天气|stock-price|current-weather)/i,
]

const TRANSIENT_DESC_PATTERNS: ReadonlyArray<RegExp> = [
  // 描述里出现 ISO 日期 + "今天/当前/实时" 类词（≤40 字符距离内）
  /\d{4}-\d{2}-\d{2}[\s\S]{0,40}(今天|今日|当前|此刻|实时|天气)/,
  // 反向：时间词在前 + ISO 日期在后
  /(今天|今日|当前|此刻|实时)[\s\S]{0,40}\d{4}-\d{2}-\d{2}/,
  // 描述里出现 ISO 日期（kebab 记忆里通常不应有具体日期）
  /\d{4}-\d{2}-\d{2}/,
  // 中文日期格式
  /\d{4}年\d{1,2}月\d{1,2}日/,
  // "今天是星期几" / "现在 14:30" / "此刻 XX"
  /(今天|现在|当前|此刻)[是点]?\s*\d/,
  // "当日 / 实时 / 即时" 修饰数据
  /(当日|实时|即时)\s*(数据|结果|值|温度|股价|汇率|天气|内存|cpu|占用)/i,
]

/**
 * 命中原因枚举（用于 log debug）
 */
export type TransientHit = 'name-iso-date' | 'name-transient-word' | 'name-realtime-data' | 'desc-iso-date' | 'desc-cn-date' | 'desc-today-prefix' | 'desc-realtime-data'

/**
 * 检查单字段（name 或 description）是否含瞬时数据
 *
 * @returns 命中原因（null 表示未命中）
 */
export function detectTransientInText(text: string): TransientHit | null {
  for (const pattern of TRANSIENT_NAME_PATTERNS) {
    if (pattern.test(text)) {
      if (pattern.source.includes('\\d{4}-\\d{2}-\\d{2}')) return 'name-iso-date'
      if (pattern.source.includes('weather') || pattern.source.includes('stock') || pattern.source.includes('今日天气')) return 'name-realtime-data'
      return 'name-transient-word'
    }
  }
  return null
}

function detectTransientInDescription(text: string): TransientHit | null {
  for (const pattern of TRANSIENT_DESC_PATTERNS) {
    if (pattern.test(text)) {
      if (pattern.source.includes('\\d{4}-\\d{2}-\\d{2}')) return 'desc-iso-date'
      if (pattern.source.includes('\\d{4}年')) return 'desc-cn-date'
      if (pattern.source.includes('(今天|现在|当前|此刻)')) return 'desc-today-prefix'
      return 'desc-realtime-data'
    }
  }
  return null
}

/**
 * 判断一条候选记忆是否属于瞬时数据
 *
 * 检测两个字段：name 和 description。body 不检测（长文记忆可能合理引用日期）。
 *
 * @returns 命中原因（null 表示非瞬时）
 */
export function detectTransientMemory(name: string, description: string): TransientHit | null {
  const nameHit = detectTransientInText(name)
  if (nameHit) return nameHit
  return detectTransientInDescription(description)
}

/**
 * 同 isMemorySensitive 的便捷封装
 */
export function isMemoryTransient(name: string, description: string): boolean {
  return detectTransientMemory(name, description) != null
}

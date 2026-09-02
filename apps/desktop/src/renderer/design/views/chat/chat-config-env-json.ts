import type { EnvVarItem } from '@spark/protocol'

type EnvJsonObject = Record<string, string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function parseEnvVarItem(value: unknown, index: number): EnvVarItem {
  if (!isRecord(value)) {
    throw new Error(`数组第 ${index + 1} 项必须是环境变量对象`)
  }

  const key = typeof value.key === 'string' ? value.key.trim() : ''
  if (key.length === 0) {
    throw new Error(`数组第 ${index + 1} 项缺少有效的 key`)
  }
  if (typeof value.value !== 'string') {
    throw new Error(`环境变量 ${key} 的 value 必须是字符串`)
  }
  if (value.description != null && typeof value.description !== 'string') {
    throw new Error(`环境变量 ${key} 的 description 必须是字符串`)
  }

  const description = typeof value.description === 'string' ? value.description.trim() : ''
  return {
    key,
    value: value.value,
    ...(description.length > 0 ? { description } : {}),
  }
}

function keepFirstEnvVarByKey(vars: EnvVarItem[]): EnvVarItem[] {
  const seen = new Set<string>()
  return vars.filter((item) => {
    if (seen.has(item.key)) return false
    seen.add(item.key)
    return true
  })
}

/**
 * 把环境变量草稿导出为通用 JSON 键值对象。
 * 空键名会被忽略；重复键与后端持久化规则一致，保留第一个值。
 */
export function serializeEnvVarsJson(vars: EnvVarItem[]): string {
  const seen = new Set<string>()
  const entries = vars.flatMap<[string, string]>((item) => {
    const key = item.key.trim()
    if (key.length === 0 || seen.has(key)) return []
    seen.add(key)
    return [[key, item.value]]
  })
  const env = Object.fromEntries(entries) as EnvJsonObject
  return JSON.stringify(env, null, 2)
}

/**
 * 从剪贴板 JSON 解析环境变量。
 * 兼容常用的 `{ "KEY": "value" }` 与项目原生的 `{ key, value, description? }[]`。
 */
export function parseEnvVarsJson(text: string): EnvVarItem[] {
  if (text.trim().length === 0) throw new Error('剪贴板为空')

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`JSON 解析失败：${detail}`, { cause: error })
  }

  if (Array.isArray(value)) return keepFirstEnvVarByKey(value.map(parseEnvVarItem))
  if (!isRecord(value)) {
    throw new Error('JSON 顶层必须是键值对象或环境变量数组')
  }

  return keepFirstEnvVarByKey(
    Object.entries(value).map(([rawKey, rawValue]) => {
      const key = rawKey.trim()
      if (key.length === 0) throw new Error('环境变量键名不能为空')
      if (typeof rawValue !== 'string') {
        throw new Error(`环境变量 ${key} 的值必须是字符串`)
      }
      return { key, value: rawValue }
    }),
  )
}

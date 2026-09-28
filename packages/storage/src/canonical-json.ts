/**
 * @module canonical-json
 *
 * 稳定 JSON 序列化：所有层级的对象键按字典序排序，用于 checksum /
 * fingerprint 等「同内容必须得到同摘要」的场景。
 *
 * 注意不能使用 `JSON.stringify(value, keys)` 的数组型 replacer —— 该
 * replacer 会递归作用于所有层级，嵌套对象中与顶层键名不重合的键会被
 * 剔除（嵌套内容塌缩为 `{}`），导致摘要不覆盖嵌套字段。
 */

function serializeValue(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeValue(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  const body = keys.map((key) => `${JSON.stringify(key)}:${serializeValue(record[key])}`).join(',')
  return `{${body}}`
}

/** 稳定序列化：键序无关、覆盖全部嵌套层级；undefined 值的键被剔除。 */
export function stableJsonStringify(value: unknown): string {
  return serializeValue(value)
}

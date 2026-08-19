/**
 * jsonPath 最小子集（方案 §3.2：不新增依赖）
 *
 * 支持：`$` 根、`.name` 属性、`[0]` 下标、`[*]` 通配。
 * 例：`$.issues[*].fields.summary`
 *
 * 提取结果统一为数组（`[*]` 会扇出多个匹配；无匹配返回空数组）。
 */

type PathSegment =
  | { kind: 'prop'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }

export function parseJsonPath(path: string): PathSegment[] | null {
  const trimmed = path.trim()
  if (!trimmed.startsWith('$')) return null
  const segments: PathSegment[] = []
  let cursor = 1

  while (cursor < trimmed.length) {
    const char = trimmed[cursor]
    if (char === '.') {
      const rest = trimmed.slice(cursor + 1)
      const match = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
      if (match == null) return null
      segments.push({ kind: 'prop', name: match[0] })
      cursor += 1 + match[0].length
    } else if (char === '[') {
      const end = trimmed.indexOf(']', cursor)
      if (end < 0) return null
      const inner = trimmed.slice(cursor + 1, end)
      if (inner === '*') {
        segments.push({ kind: 'wildcard' })
      } else if (/^\d+$/.test(inner)) {
        segments.push({ kind: 'index', index: Number(inner) })
      } else {
        return null
      }
      cursor = end + 1
    } else {
      return null
    }
  }
  return segments
}

/** 按路径提取全部匹配值；路径非法或无匹配返回空数组 */
export function jsonPathExtract(data: unknown, path: string): unknown[] {
  const segments = parseJsonPath(path)
  if (segments == null) return []
  let current: unknown[] = [data]
  for (const segment of segments) {
    const next: unknown[] = []
    for (const node of current) {
      if (segment.kind === 'prop') {
        if (node != null && typeof node === 'object' && !Array.isArray(node)) {
          const record = node as Record<string, unknown>
          if (segment.name in record) next.push(record[segment.name])
        }
      } else if (segment.kind === 'index') {
        if (Array.isArray(node) && segment.index < node.length) next.push(node[segment.index])
      } else {
        if (Array.isArray(node)) next.push(...node)
        else if (node != null && typeof node === 'object') {
          next.push(...Object.values(node as Record<string, unknown>))
        }
      }
    }
    current = next
    if (current.length === 0) break
  }
  return current
}

/** 把提取值压平成适合表格单元格的字符串 */
export function jsonPathValueToCell(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

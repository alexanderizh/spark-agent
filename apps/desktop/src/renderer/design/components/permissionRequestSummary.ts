import type { PermissionApprovalRequest } from '@spark/protocol'

export type PermissionSummaryItem = { label: string; value: string }

const FIELD_LABELS: Record<string, string> = {
  file_path: '文件', path: '路径', command: '将要运行', cmd: '将要运行',
  query: '搜索内容', pattern: '搜索内容', url: '网址', description: '用途', prompt: '任务',
}

function humanizeToolName(toolName: string): string {
  const name = toolName.toLowerCase()
  if (name === 'edit' || name.includes('replace')) return '修改文件'
  if (name.includes('write')) return '写入文件'
  if (name.includes('read')) return '读取文件'
  if (name.includes('bash') || name.includes('terminal') || name.includes('exec')) return '运行命令'
  if (name.includes('search') || name.includes('grep')) return '搜索内容'
  if (name.includes('web') || name.includes('fetch')) return '访问网络'
  return `使用 ${toolName}`
}

function compactValue(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    return text.length > 180 ? `${text.slice(0, 180)}…` : text
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(compactValue).filter(Boolean).join('、')
  return null
}

export function buildPermissionSummary(request: PermissionApprovalRequest): {
  heading: string
  description: string
  items: PermissionSummaryItem[]
} {
  const name = request.toolName.toLowerCase()
  const isEdit = name === 'edit' || name.includes('replace')
  const preferredKeys = isEdit
    ? ['file_path']
    : ['file_path', 'path', 'command', 'cmd', 'url', 'query', 'pattern', 'description', 'prompt']
  const items: PermissionSummaryItem[] = []
  for (const key of preferredKeys) {
    const rawValue = request.toolInput[key]
    const value = (key === 'command' || key === 'cmd') && typeof rawValue === 'string'
      ? rawValue.trim() || null
      : compactValue(rawValue)
    if (value == null || items.some((item) => item.value === value)) continue
    items.push({ label: FIELD_LABELS[key] ?? key, value })
    if (items.length === 3) break
  }

  let description = '该操作需要你确认后才会继续。'
  if (isEdit) description = '代理将更新下列文件，不会修改其他文件。'
  else if (name.includes('write')) description = '代理将把内容写入下列文件。'
  else if (name.includes('bash') || name.includes('exec')) description = '代理将在当前项目中运行这条命令。'
  else if (name.includes('web') || name.includes('fetch')) description = '代理将访问下列网络地址。'
  return { heading: humanizeToolName(request.toolName), description, items }
}

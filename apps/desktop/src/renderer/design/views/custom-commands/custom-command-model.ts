/**
 * custom-command-model — 自定义命令设置页的纯逻辑层
 *
 * 职责：
 *   1. CustomCommandItem 类型与存储键（settings 表 category/key）
 *   2. 草稿创建、存储 JSON 容错解析、命令名规范化、日期展示
 *   3. 导出 payload 组装/解析、导入条目校验与同名合并（跳过/覆盖）
 *
 * UI 组件在 ./CustomCommandsSection.tsx；导入预览弹窗在 ./CustomCommandImportModal.tsx。
 */

export type CustomCommandScriptLanguage = 'javascript' | 'python'

export type CustomCommandItem = {
  id: string
  name: string
  description: string
  prompt: string
  script: string
  scriptLanguage: CustomCommandScriptLanguage
  enabled: boolean
  updatedAt: string
}

export const CUSTOM_COMMANDS_CATEGORY = 'custom-commands'
export const CUSTOM_COMMANDS_KEY = 'items'

export const CUSTOM_COMMAND_EXPORT_VERSION = 1

export type CustomCommandExportPayload = {
  version: number
  exportedAt: string
  commands: CustomCommandItem[]
}

export type CustomCommandImportMode = 'skip' | 'overwrite'

export type RejectedCustomCommand = {
  name: string
  reason: string
}

export type CustomCommandImportParseResult = {
  accepted: CustomCommandItem[]
  rejected: RejectedCustomCommand[]
  exportedAt: string | null
  version: number | null
}

export type CustomCommandMergeResult = {
  commands: CustomCommandItem[]
  added: number
  updated: number
  skipped: number
}

export function createCustomCommandDraft(): CustomCommandItem {
  const now = new Date().toISOString()
  return {
    id: `custom-${Date.now()}`,
    name: '/custom-plan',
    description: '生成一份可执行计划',
    prompt: '请基于用户输入生成一份简洁、可执行、包含验证步骤的计划。',
    script: '',
    scriptLanguage: 'javascript',
    enabled: true,
    updatedAt: now,
  }
}

export function normalizeCustomCommandInput(value: string): string | null {
  const name = value.trim().replace(/^\//, '').toLowerCase()
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(name)) return null
  return `/${name}`
}

function coerceCustomCommandFields(item: Record<string, unknown>): CustomCommandItem {
  return {
    id: typeof item.id === 'string' && item.id.length > 0 ? item.id : `custom-${Date.now()}`,
    name: typeof item.name === 'string' ? item.name : '/custom-command',
    description: typeof item.description === 'string' ? item.description : '',
    prompt: typeof item.prompt === 'string' ? item.prompt : '',
    script: typeof item.script === 'string' ? item.script : '',
    scriptLanguage: item.scriptLanguage === 'python' ? 'python' : 'javascript',
    enabled: item.enabled !== false,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
  }
}

export function parseCustomCommandItems(raw: string | null): CustomCommandItem[] {
  if (raw == null || raw.trim().length === 0) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
      .map(coerceCustomCommandFields)
  } catch {
    return []
  }
}

/**
 * 解析导入文件内容。兼容两种结构：
 *   1. 导出文件 { version, exportedAt, commands: [...] }
 *   2. 直接是 CustomCommandItem 数组的裸 JSON
 * 名称非法的条目进入 rejected（导入时会被丢弃），其余条目名称已规范化。
 */
export function parseCustomCommandExportPayload(
  raw: string,
): CustomCommandImportParseResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const container = parsed as Record<string, unknown>
  const records = Array.isArray(container.commands)
    ? container.commands
    : Array.isArray(parsed)
      ? parsed
      : null
  if (records == null) return null
  const accepted: CustomCommandItem[] = []
  const rejected: RejectedCustomCommand[] = []
  for (const record of records) {
    if (record == null || typeof record !== 'object') {
      rejected.push({ name: '(空条目)', reason: '不是有效对象' })
      continue
    }
    const item = coerceCustomCommandFields(record as Record<string, unknown>)
    const normalizedName = normalizeCustomCommandInput(item.name)
    if (normalizedName == null) {
      rejected.push({ name: item.name || '(未命名)', reason: '命令名需形如 /custom-plan' })
      continue
    }
    accepted.push({ ...item, name: normalizedName })
  }
  return {
    accepted,
    rejected,
    exportedAt: typeof container.exportedAt === 'string' ? container.exportedAt : null,
    version: typeof container.version === 'number' ? container.version : null,
  }
}

function generateCustomCommandId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 将导入命令合并进现有列表。
 * 同名（规范化后）判定冲突：skip 模式保留本地版本；overwrite 模式用导入内容
 * 覆盖本地字段但保留本地 id，避免外部引用失稳。导入内部同名条目按同样规则处理。
 */
export function mergeCustomCommandImports(
  existing: CustomCommandItem[],
  incoming: CustomCommandItem[],
  mode: CustomCommandImportMode,
): CustomCommandMergeResult {
  const commands = [...existing]
  const byName = new Map<string, CustomCommandItem>()
  for (const command of commands) {
    const normalizedName = normalizeCustomCommandInput(command.name)
    if (normalizedName != null && !byName.has(normalizedName)) byName.set(normalizedName, command)
  }
  const usedIds = new Set(commands.map((command) => command.id))
  let added = 0
  let updated = 0
  let skipped = 0
  for (const raw of incoming) {
    const normalizedName = normalizeCustomCommandInput(raw.name)
    if (normalizedName == null) {
      skipped += 1
      continue
    }
    const item: CustomCommandItem = { ...raw, name: normalizedName }
    const target = byName.get(normalizedName)
    if (target == null) {
      let id = item.id
      if (!id || usedIds.has(id)) id = generateCustomCommandId()
      usedIds.add(id)
      const addedItem = { ...item, id }
      commands.push(addedItem)
      byName.set(normalizedName, addedItem)
      added += 1
    } else if (mode === 'overwrite') {
      const index = commands.findIndex((command) => command.id === target.id)
      commands[index] = { ...item, id: target.id }
      byName.set(normalizedName, commands[index])
      updated += 1
    } else {
      skipped += 1
    }
  }
  return { commands, added, updated, skipped }
}

export function formatCustomCommandDate(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '未更新'
  return new Date(time).toLocaleDateString()
}

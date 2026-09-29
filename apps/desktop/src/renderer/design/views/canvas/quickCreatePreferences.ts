import { isQuickCreateMode, type QuickCreateMode } from './quickCreateTaskStore'

const STORAGE_KEY = 'spark-canvas:quick-create-preferences:v1'
const MAX_CUSTOM_SIZE_VALUES = 8

export type QuickCreateTaskViewMode = 'list' | 'grid'

export type QuickCreatePreferences = {
  mode?: QuickCreateMode
  modelKey?: string
  textProviderId?: string
  textModelId?: string
  taskView?: QuickCreateTaskViewMode
  taskFilter?: QuickCreateMode | 'all'
  paramsByScope?: Record<string, Record<string, string>>
  customSizeHistoryByScope?: Record<string, Record<string, string[]>>
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeParams(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) return {}
  const result: Record<string, Record<string, string>> = {}
  for (const [scope, params] of Object.entries(value)) {
    if (!isRecord(params)) continue
    const normalized = Object.fromEntries(
      Object.entries(params).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    if (Object.keys(normalized).length > 0) result[scope] = normalized
  }
  return result
}

function normalizeCustomSizeHistory(value: unknown): Record<string, Record<string, string[]>> {
  if (!isRecord(value)) return {}
  const result: Record<string, Record<string, string[]>> = {}
  for (const [scope, fields] of Object.entries(value)) {
    if (!isRecord(fields)) continue
    const normalizedFields: Record<string, string[]> = {}
    for (const [fieldName, values] of Object.entries(fields)) {
      if (!Array.isArray(values)) continue
      const normalized = values
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .slice(0, MAX_CUSTOM_SIZE_VALUES)
      if (normalized.length > 0) normalizedFields[fieldName] = normalized
    }
    if (Object.keys(normalizedFields).length > 0) result[scope] = normalizedFields
  }
  return result
}

export function readQuickCreatePreferences(): QuickCreatePreferences {
  if (!canUseStorage()) return {}
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!isRecord(parsed)) return {}
    return {
      ...(isQuickCreateMode(parsed.mode) ? { mode: parsed.mode } : {}),
      ...(typeof parsed.modelKey === 'string' ? { modelKey: parsed.modelKey } : {}),
      ...(typeof parsed.textProviderId === 'string'
        ? { textProviderId: parsed.textProviderId }
        : {}),
      ...(typeof parsed.textModelId === 'string' ? { textModelId: parsed.textModelId } : {}),
      ...(parsed.taskView === 'list' || parsed.taskView === 'grid'
        ? { taskView: parsed.taskView }
        : {}),
      ...(isQuickCreateMode(parsed.taskFilter) || parsed.taskFilter === 'all'
        ? { taskFilter: parsed.taskFilter }
        : {}),
      paramsByScope: normalizeParams(parsed.paramsByScope),
      customSizeHistoryByScope: normalizeCustomSizeHistory(parsed.customSizeHistoryByScope),
    }
  } catch {
    return {}
  }
}

export function writeQuickCreatePreferences(next: QuickCreatePreferences): void {
  if (!canUseStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 偏好存储不可用时保持当前内存态，不影响提交任务。
  }
}

export function quickCreateParamScope(input: {
  operation: string
  modelKey: string
  capabilityId?: string
}): string {
  return [input.operation, input.modelKey || 'auto', input.capabilityId || 'default']
    .map((value) => encodeURIComponent(value))
    .join('::')
}

function isDimensionValue(value: string): boolean {
  const match = value.match(/^\s*(\d+(?:\.\d+)?)\s*[x×*:]\s*(\d+(?:\.\d+)?)\s*$/i)
  return match != null && Number(match[1]) > 0 && Number(match[2]) > 0
}

export function readQuickCreateCustomSizeHistory(scope: string, fieldName: string): string[] {
  return [...(readQuickCreatePreferences().customSizeHistoryByScope?.[scope]?.[fieldName] ?? [])]
}

export function recordQuickCreateCustomSize(
  scope: string,
  fieldName: string,
  value: unknown,
  enumValues: readonly string[],
): void {
  const normalizedValue = String(value ?? '').trim()
  if (
    !normalizedValue ||
    enumValues.includes(normalizedValue) ||
    !isDimensionValue(normalizedValue)
  ) {
    return
  }
  const preferences = readQuickCreatePreferences()
  const current = preferences.customSizeHistoryByScope?.[scope]?.[fieldName] ?? []
  const next = [normalizedValue, ...current.filter((item) => item !== normalizedValue)].slice(
    0,
    MAX_CUSTOM_SIZE_VALUES,
  )
  writeQuickCreatePreferences({
    ...preferences,
    customSizeHistoryByScope: {
      ...(preferences.customSizeHistoryByScope ?? {}),
      [scope]: {
        ...(preferences.customSizeHistoryByScope?.[scope] ?? {}),
        [fieldName]: next,
      },
    },
  })
}

export function removeQuickCreateCustomSize(scope: string, fieldName: string, value: string): void {
  const preferences = readQuickCreatePreferences()
  const scoped = preferences.customSizeHistoryByScope?.[scope]
  if (!scoped?.[fieldName]) return
  const nextValues = scoped[fieldName].filter((item) => item !== value)
  const nextFields = { ...scoped }
  if (nextValues.length > 0) nextFields[fieldName] = nextValues
  else delete nextFields[fieldName]
  const nextHistory = { ...(preferences.customSizeHistoryByScope ?? {}) }
  if (Object.keys(nextFields).length > 0) nextHistory[scope] = nextFields
  else delete nextHistory[scope]
  writeQuickCreatePreferences({
    ...preferences,
    customSizeHistoryByScope: nextHistory,
  })
}

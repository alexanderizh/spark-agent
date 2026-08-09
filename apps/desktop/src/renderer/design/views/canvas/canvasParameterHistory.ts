import type { SchemaField } from './canvasParameterPresentation'

const STORAGE_KEY = 'spark-canvas:parameter-history:v1'
const MAX_VALUES_PER_FIELD = 8

type CanvasParameterHistoryStore = Record<string, Record<string, string[]>>

export function canvasParameterHistoryScope(input: {
  operation: string
  modelKey: string
  capabilityId?: string | undefined
}): string {
  return [input.operation, input.modelKey, input.capabilityId ?? 'default']
    .map((value) => encodeURIComponent(value))
    .join('::')
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readStore(): CanvasParameterHistoryStore {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: CanvasParameterHistoryStore = {}
    for (const [scope, fields] of Object.entries(parsed)) {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue
      const normalizedFields: Record<string, string[]> = {}
      for (const [fieldName, values] of Object.entries(fields)) {
        if (!Array.isArray(values)) continue
        const normalized = values
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, MAX_VALUES_PER_FIELD)
        if (normalized.length > 0) normalizedFields[fieldName] = normalized
      }
      if (Object.keys(normalizedFields).length > 0) result[scope] = normalizedFields
    }
    return result
  } catch {
    return {}
  }
}

function writeStore(store: CanvasParameterHistoryStore): void {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures in restricted renderers.
  }
}

export function readCanvasParameterHistory(scope: string | undefined, fieldName: string): string[] {
  if (!scope) return []
  return [...(readStore()[scope]?.[fieldName] ?? [])]
}

function isCustomValueCompatible(field: SchemaField, value: string): boolean {
  if (!value || field.enumValues.includes(value)) return false
  if (field.type === 'integer' || field.type === 'number') {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return false
    if (field.type === 'integer' && !Number.isInteger(numeric)) return false
    if (field.minimum !== undefined && numeric < field.minimum) return false
    if (field.maximum !== undefined && numeric > field.maximum) return false
    if (
      field.multipleOf !== undefined &&
      Math.abs(numeric / field.multipleOf - Math.round(numeric / field.multipleOf)) > 1e-9
    ) {
      return false
    }
    return true
  }
  if (!field.allowCustom) return false
  if (!field.pattern) return true
  try {
    return new RegExp(field.pattern).test(value)
  } catch {
    return false
  }
}

export function recordCanvasCustomParameterHistory(
  scope: string | undefined,
  fields: readonly SchemaField[],
  values: Record<string, unknown>,
): void {
  if (!scope) return
  const store = readStore()
  const scoped = { ...(store[scope] ?? {}) }
  let changed = false
  for (const field of fields) {
    const rawValue = values[field.name]
    if (rawValue == null) continue
    const value = String(rawValue).trim()
    if (!isCustomValueCompatible(field, value)) continue
    const previous = scoped[field.name] ?? []
    const next = [value, ...previous.filter((item) => item !== value)].slice(
      0,
      MAX_VALUES_PER_FIELD,
    )
    if (next.some((item, index) => item !== previous[index]) || next.length !== previous.length) {
      scoped[field.name] = next
      changed = true
    }
  }
  if (changed) {
    store[scope] = scoped
    writeStore(store)
  }
}

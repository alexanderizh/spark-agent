import type { CanvasMediaModelSummary } from '@spark/protocol'
import { isModelParamDraftValueCompatible } from './canvasModelParamDraftState'
import type { SchemaField } from './canvasParameterPresentation'

export const CANVAS_MODEL_PARAMETER_PREFERENCES_KEY = 'spark-canvas:model-parameter-preferences:v1'

type ModelParameterPreferencesStore = Record<string, Record<string, string>>
type ModelParameterPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): ModelParameterPreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

export function canvasModelParameterPreferenceKey(
  model: Pick<CanvasMediaModelSummary, 'providerProfileId' | 'providerKind' | 'effectiveModelId'>,
): string {
  const channelKey = model.providerProfileId?.trim() || `kind:${model.providerKind}`
  return [channelKey, model.effectiveModelId]
    .map((value) => encodeURIComponent(value.trim()))
    .join('::')
}

function readStore(
  storage: ModelParameterPreferenceStorage | null,
): ModelParameterPreferencesStore {
  try {
    const raw = storage?.getItem(CANVAS_MODEL_PARAMETER_PREFERENCES_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: ModelParameterPreferencesStore = {}
    for (const [modelKey, params] of Object.entries(parsed)) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) continue
      const normalizedParams = Object.fromEntries(
        Object.entries(params).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].trim().length > 0,
        ),
      )
      if (Object.keys(normalizedParams).length > 0) result[modelKey] = normalizedParams
    }
    return result
  } catch {
    return {}
  }
}

export function readCanvasModelParameterPreferences(
  modelKey: string | undefined,
  fields: readonly SchemaField[],
  storage: ModelParameterPreferenceStorage | null = defaultStorage(),
): Record<string, string> {
  if (!modelKey) return {}
  const stored = readStore(storage)[modelKey] ?? {}
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = stored[field.name]
      return value && isModelParamDraftValueCompatible(field, value)
        ? [[field.name, value] as const]
        : []
    }),
  )
}

export function writeCanvasModelParameterPreferences(
  modelKey: string | undefined,
  fields: readonly SchemaField[],
  values: Record<string, string>,
  storage: ModelParameterPreferenceStorage | null = defaultStorage(),
): void {
  if (!modelKey || !storage) return
  try {
    const store = readStore(storage)
    const nextParams = Object.fromEntries(
      fields.flatMap((field) => {
        const value = values[field.name]?.trim()
        return value && isModelParamDraftValueCompatible(field, value)
          ? [[field.name, value] as const]
          : []
      }),
    )
    if (Object.keys(nextParams).length > 0) store[modelKey] = nextParams
    else delete store[modelKey]
    storage.setItem(CANVAS_MODEL_PARAMETER_PREFERENCES_KEY, JSON.stringify(store))
  } catch {
    // 本地偏好不可用时保留当前任务内的状态，不阻断编辑或提交。
  }
}

export function canvasModelMatchesPersistedIdentity(
  model: Pick<CanvasMediaModelSummary, 'providerProfileId' | 'manifestId' | 'effectiveModelId'>,
  identity: {
    providerProfileId?: string | undefined
    manifestId?: string | undefined
    modelId?: string | undefined
  },
): boolean {
  const comparisons = [
    identity.providerProfileId ? model.providerProfileId === identity.providerProfileId : undefined,
    identity.manifestId ? model.manifestId === identity.manifestId : undefined,
    identity.modelId ? model.effectiveModelId === identity.modelId : undefined,
  ].filter((value): value is boolean => value !== undefined)
  return comparisons.length === 0 || comparisons.every(Boolean)
}

import type { CustomParamDraft } from './CanvasInlineAiComposer'
import type { SchemaField } from './canvasParameterPresentation'

export function isModelParamDraftValueCompatible(
  field: Pick<SchemaField, 'enumValues' | 'allowCustom' | 'pattern'>,
  value: string,
): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (field.enumValues.includes(trimmed)) return true
  if (field.enumValues.length === 0 && !field.allowCustom) return true
  if (!field.allowCustom) return false
  if (!field.pattern) return true
  try {
    return new RegExp(field.pattern).test(trimmed)
  } catch {
    return true
  }
}

export function mergeSeededModelParamDraft(
  currentDraft: Record<string, string>,
  seededDraft: Record<string, string>,
  fields?: readonly SchemaField[],
): Record<string, string> {
  if (fields) {
    return Object.fromEntries(
      fields.map((field) => {
        const currentValue = currentDraft[field.name]
        return [
          field.name,
          typeof currentValue === 'string' &&
          isModelParamDraftValueCompatible(field, currentValue)
            ? currentValue
            : (seededDraft[field.name] ?? ''),
        ]
      }),
    )
  }

  const next = { ...currentDraft }
  for (const [key, value] of Object.entries(seededDraft)) {
    const currentValue = currentDraft[key]
    next[key] = typeof currentValue === 'string' && currentValue.trim().length > 0 ? currentValue : value
  }
  return next
}

export function sameModelParamDraft(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    rightKeys.every((key) => left[key] === right[key])
  )
}

export function sameCustomParamDrafts(
  left: CustomParamDraft[],
  right: CustomParamDraft[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.id === right[index]?.id &&
        item.name === right[index]?.name &&
        item.type === right[index]?.type &&
        item.value === right[index]?.value,
    )
  )
}

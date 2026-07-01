import type { CustomParamDraft } from './CanvasInlineAiComposer'

export function mergeSeededModelParamDraft(
  currentDraft: Record<string, string>,
  seededDraft: Record<string, string>,
): Record<string, string> {
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

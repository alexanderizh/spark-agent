import type { CanvasAsset } from './canvas.types'

export const DEFAULT_PROMPT_LIBRARY_CATEGORIES = ['镜头', '构图', '风格', '人物', '光色'] as const

const LAST_PROMPT_CATEGORY_KEY = 'spark-canvas:prompt-library:last-category'

function normalizeCategories(categories: unknown): string[] {
  if (!Array.isArray(categories)) return []
  return categories
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index)
}

export function readPromptLibraryCategories(
  metadata: Record<string, unknown> | undefined,
): string[] {
  const categories = normalizeCategories(metadata?.promptLibraryCategories)
  return categories.length > 0 ? categories : [...DEFAULT_PROMPT_LIBRARY_CATEGORIES]
}

export function writePromptLibraryCategories(
  metadata: Record<string, unknown> | undefined,
  categories: string[],
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    promptLibraryCategories: normalizeCategories(categories),
  }
}

export function getPromptCategory(asset: Pick<CanvasAsset, 'metadata'>): string | null {
  const attributes = asset.metadata?.attributes
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
    const value = (attributes as Record<string, unknown>).promptCategory
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  const legacyValue = asset.metadata?.promptCategory
  return typeof legacyValue === 'string' && legacyValue.trim() ? legacyValue.trim() : null
}

export function getPromptCategoryUsage(assets: readonly CanvasAsset[]): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const asset of assets) {
    const category = getPromptCategory(asset)
    if (category) usage[category] = (usage[category] ?? 0) + 1
  }
  return usage
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readLastPromptCategory(storage?: Storage): string | null {
  const target = resolveStorage(storage)
  if (!target) return null
  try {
    const value = target.getItem(LAST_PROMPT_CATEGORY_KEY)?.trim()
    return value || null
  } catch {
    return null
  }
}

export function saveLastPromptCategory(category: string, storage?: Storage): void {
  const target = resolveStorage(storage)
  if (!target) return
  try {
    if (category.trim()) target.setItem(LAST_PROMPT_CATEGORY_KEY, category.trim())
  } catch {
    // Preferences are best-effort and must not block saving a prompt.
  }
}

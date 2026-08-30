import type { CanvasAsset } from './canvas.types'

export const GLOBAL_PROMPT_LIBRARY_CATEGORY = 'prompt-library'
export const GLOBAL_PROMPT_LIBRARY_KEY = 'data'
const LOCAL_STORAGE_KEY = 'spark-prompt-library-global'

export type GlobalPromptLibraryItem = {
  id: string
  title: string
  text: string
  category: string
  tags: string[]
  coverUrl: string | null
  coverMimeType: string | null
  usageCount: number
  createdAt: string
  updatedAt: string
}

export type GlobalPromptLibraryState = {
  version: 1
  categories: string[]
  items: GlobalPromptLibraryItem[]
  legacyMigrated: boolean
}

const EMPTY_STATE: GlobalPromptLibraryState = {
  version: 1,
  categories: [],
  items: [],
  legacyMigrated: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeItem(value: unknown): GlobalPromptLibraryItem | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') return null
  const now = new Date().toISOString()
  return {
    id: value.id,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '-',
    text: value.text.trim(),
    category: typeof value.category === 'string' ? value.category.trim() : '',
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
      : [],
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : null,
    coverMimeType: typeof value.coverMimeType === 'string' ? value.coverMimeType : null,
    usageCount: typeof value.usageCount === 'number' && Number.isFinite(value.usageCount) ? value.usageCount : 0,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

export function normalizeGlobalPromptLibrary(value: unknown): GlobalPromptLibraryState {
  if (!isRecord(value)) return EMPTY_STATE
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeItem).filter((item): item is GlobalPromptLibraryItem => item !== null && item.text.length > 0)
    : []
  const categories = Array.isArray(value.categories)
    ? value.categories
        .filter((category): category is string => typeof category === 'string')
        .map((category) => category.trim())
        .filter((category, index, list) => category.length > 0 && list.indexOf(category) === index)
    : []
  return { version: 1, categories, items, legacyMigrated: value.legacyMigrated === true }
}

export async function readGlobalPromptLibrary(): Promise<GlobalPromptLibraryState> {
  try {
    const result = await window.spark?.invoke('settings:get', {
      category: GLOBAL_PROMPT_LIBRARY_CATEGORY,
      key: GLOBAL_PROMPT_LIBRARY_KEY,
    })
    if (result?.value != null) return normalizeGlobalPromptLibrary(result.value)
  } catch {
    // Fall back to local storage for browser previews and older runtimes.
  }
  try {
    return normalizeGlobalPromptLibrary(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) ?? 'null'))
  } catch {
    return EMPTY_STATE
  }
}

export async function writeGlobalPromptLibrary(state: GlobalPromptLibraryState): Promise<void> {
  const normalized = normalizeGlobalPromptLibrary(state)
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalized))
  await window.spark?.invoke('settings:set', {
    category: GLOBAL_PROMPT_LIBRARY_CATEGORY,
    key: GLOBAL_PROMPT_LIBRARY_KEY,
    value: normalized,
  })
}

export function globalPromptToCanvasAsset(item: GlobalPromptLibraryItem): CanvasAsset {
  return {
    id: item.id,
    projectId: 'global-prompt-library',
    userId: 0,
    type: 'prompt',
    source: 'manual',
    title: item.title,
    mimeType: 'text/plain',
    contentText: item.text,
    metadata: {
      tags: item.tags,
      usageCount: item.usageCount,
      attributes: {
        promptCategory: item.category,
        coverUrl: item.coverUrl ?? '',
        coverMimeType: item.coverMimeType ?? '',
      },
    },
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

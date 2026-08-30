import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import {
  DEFAULT_PROMPT_LIBRARY_CATEGORIES,
  getPromptCategory,
  getPromptCategoryUsage,
  readLastPromptCategory,
  readPromptLibraryCategories,
  saveLastPromptCategory,
  writePromptLibraryCategories,
} from './canvasPromptLibraryCategories'

function promptAsset(category?: string): CanvasAsset {
  return {
    id: `asset-${category ?? 'none'}`,
    projectId: 'project-1',
    userId: 1,
    type: 'prompt',
    source: 'manual',
    title: 'Prompt',
    contentText: 'A prompt',
    metadata: {
      kind: 'prompt_library',
      ...(category ? { attributes: { promptCategory: category } } : {}),
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('canvas prompt library categories', () => {
  it('falls back to the built-in categories and removes duplicate blanks', () => {
    expect(readPromptLibraryCategories({ promptLibraryCategories: ['镜头', '', '镜头'] })).toEqual([
      '镜头',
    ])
    expect(readPromptLibraryCategories({})).toEqual(DEFAULT_PROMPT_LIBRARY_CATEGORIES)
  })

  it('writes a normalized category list into project metadata', () => {
    expect(writePromptLibraryCategories({ theme: 'dark' }, [' 镜头 ', '风格', '镜头'])).toEqual({
      theme: 'dark',
      promptLibraryCategories: ['镜头', '风格'],
    })
  })

  it('reads explicit prompt categories and counts references', () => {
    const assets = [promptAsset('镜头'), promptAsset('镜头'), promptAsset('风格'), promptAsset()]
    expect(getPromptCategory(promptAsset('镜头'))).toBe('镜头')
    expect(getPromptCategory(promptAsset())).toBeNull()
    expect(getPromptCategoryUsage(assets)).toEqual({ 镜头: 2, 风格: 1 })
  })

  it('remembers the last selected category without throwing when storage is unavailable', () => {
    const values = new Map<string, string>()
    const storage: Storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => Array.from(values.keys())[index] ?? null,
      get length() {
        return values.size
      },
    }
    saveLastPromptCategory('风格', storage)
    expect(readLastPromptCategory(storage)).toBe('风格')
    expect(readLastPromptCategory(undefined)).toBeNull()
  })
})

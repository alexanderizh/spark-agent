import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import {
  buildGlobalPromptLibraryEntries,
  buildCanvasPromptLibraryEntries,
  filterPromptLibraryEntries,
  isSystemPromptLibraryEntry,
} from './CanvasPromptLibraryPanel'

function asset(overrides: Partial<CanvasAsset>): CanvasAsset {
  return {
    id: overrides.id ?? 'asset-1',
    projectId: 'project-1',
    userId: 1,
    type: overrides.type ?? 'prompt',
    source: 'manual',
    title: 'Prompt',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('canvas prompt library panel data', () => {
  it('does not duplicate legacy project prompts in the global library', () => {
    expect(
      buildGlobalPromptLibraryEntries([
        {
          id: 'legacy:project-prompt-1',
          title: '旧项目提示词',
          text: 'legacy prompt',
          category: '',
          tags: [],
          coverUrl: null,
          coverMimeType: null,
          usageCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'global-prompt-1',
          title: '全局提示词',
          text: 'global prompt',
          category: '',
          tags: [],
          coverUrl: null,
          coverMimeType: null,
          usageCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ]).map((entry) => entry.id),
    ).toEqual(['global:global-prompt-1'])
  })

  it('keeps project categories, fallback prompt text, and image covers', () => {
    const image = asset({
      id: 'cover-1',
      type: 'image',
      url: 'safe-file://project/cover.png',
    })
    const prompt = asset({
      id: 'prompt-1',
      metadata: {
        kind: 'prompt_library',
        prompt: 'fallback prompt',
        attributes: {
          promptCategory: 'favorites',
          coverAssetId: image.id,
        },
      },
    })

    const entry = buildCanvasPromptLibraryEntries([prompt, image]).find(
      (candidate) => candidate.source === 'project',
    )

    expect(entry).toMatchObject({
      category: 'favorites',
      group: 'favorites',
      text: 'fallback prompt',
      coverUrl: image.url,
    })
  })

  it('filters only built-in camera and performance prompts when enabled', () => {
    const entries = [
      {
        id: 'project',
        source: 'project' as const,
        group: '自建',
        label: 'Project',
        text: 'project',
      },
      { id: 'camera', source: 'camera' as const, group: '镜头', label: 'Camera', text: 'camera' },
      {
        id: 'performance',
        source: 'performance' as const,
        group: '表演',
        label: 'Performance',
        text: 'performance',
      },
    ]

    expect(isSystemPromptLibraryEntry(entries[0]!)).toBe(false)
    expect(isSystemPromptLibraryEntry(entries[1]!)).toBe(true)
    expect(isSystemPromptLibraryEntry(entries[2]!)).toBe(true)
    expect(filterPromptLibraryEntries(entries, false)).toEqual(entries)
    expect(filterPromptLibraryEntries(entries, true)).toEqual([entries[0]])
  })
})

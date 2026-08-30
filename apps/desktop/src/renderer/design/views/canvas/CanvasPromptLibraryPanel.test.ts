import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import {
  buildAllProjectPromptLibraryGlobalEntries,
  buildGlobalPromptLibraryEntries,
  buildQuickUseGlobalPromptLibraryEntries,
  buildCanvasPromptLibraryEntries,
  sortPromptLibraryEntries,
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
  it('keeps migrated legacy project prompts visible in the global library', () => {
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
    ).toEqual(['global:legacy:project-prompt-1', 'global:global-prompt-1'])
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

    const entries = buildCanvasPromptLibraryEntries([prompt, image])
    const entry = entries[0]

    expect(entries).toHaveLength(1)
    expect(entry).toMatchObject({
      category: 'favorites',
      group: 'favorites',
      text: 'fallback prompt',
      coverUrl: image.url,
    })
  })

  it('builds project prompt entries from multiple canvas projects', () => {
    const entries = buildCanvasPromptLibraryEntries(
      [
        asset({
          id: 'prompt-a',
          projectId: 'project-a',
          title: '项目 A 提示词',
          contentText: 'prompt a',
          metadata: { kind: 'prompt_library' },
        }),
        asset({
          id: 'prompt-b',
          projectId: 'project-b',
          title: '项目 B 提示词',
          contentText: 'prompt b',
          metadata: { kind: 'prompt_library' },
        }),
      ],
      new Map([
        ['project-a', '画布 A'],
        ['project-b', '画布 B'],
      ]),
    )

    expect(entries.filter((entry) => entry.source === 'project')).toMatchObject([
      { label: '项目 A 提示词', originProjectName: '画布 A' },
      { label: '项目 B 提示词', originProjectName: '画布 B' },
    ])
  })

  it('promotes all project prompts into the quick-use global view', () => {
    const entries = buildAllProjectPromptLibraryGlobalEntries(
      [
        asset({
          id: 'prompt-a',
          projectId: 'project-a',
          title: '项目 A 提示词',
          contentText: 'prompt a',
          metadata: { kind: 'prompt_library' },
        }),
        asset({
          id: 'prompt-b',
          projectId: 'project-b',
          title: '项目 B 提示词',
          contentText: 'prompt b',
          metadata: { kind: 'prompt_library' },
        }),
      ],
      new Map([
        ['project-a', '画布 A'],
        ['project-b', '画布 B'],
      ]),
    )

    expect(entries).toMatchObject([
      {
        source: 'global',
        label: '项目 A 提示词',
        originProjectId: 'project-a',
        originProjectName: '画布 A',
      },
      {
        source: 'global',
        label: '项目 B 提示词',
        originProjectId: 'project-b',
        originProjectName: '画布 B',
      },
    ])
  })

  it('matches the management library union and removes migrated project duplicates', () => {
    const projectAsset = asset({
      id: 'prompt-a',
      projectId: 'project-a',
      title: '项目 A 提示词',
      contentText: 'prompt a',
      metadata: { kind: 'prompt_library' },
    })
    const entries = buildQuickUseGlobalPromptLibraryEntries(
      [
        {
          id: 'legacy:project-a:prompt-a',
          title: '项目 A 提示词',
          text: 'prompt a',
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
          title: '独立全局提示词',
          text: 'global prompt',
          category: '',
          tags: [],
          coverUrl: null,
          coverMimeType: null,
          usageCount: 0,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      [
        projectAsset,
        asset({
          id: 'prompt-b',
          projectId: 'project-b',
          title: '项目 B 提示词',
          contentText: 'prompt b',
          metadata: { kind: 'prompt_library' },
        }),
      ],
      new Map([
        ['project-a', '画布 A'],
        ['project-b', '画布 B'],
      ]),
    )

    expect(entries.map((entry) => entry.label)).toEqual([
      '项目 A 提示词',
      '独立全局提示词',
      '项目 B 提示词',
    ])
  })

  it('sorts project and global prompts by creation time while keeping undated entries last', () => {
    const entries = [
      {
        id: 'old',
        source: 'global' as const,
        group: '全局',
        label: 'Old',
        text: 'old',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'undated',
        source: 'global' as const,
        group: '全局',
        label: 'Undated',
        text: 'undated',
      },
      {
        id: 'new',
        source: 'project' as const,
        group: '项目',
        label: 'New',
        text: 'new',
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    ]

    expect(sortPromptLibraryEntries(entries, 'newest').map((entry) => entry.id)).toEqual([
      'new',
      'old',
      'undated',
    ])
    expect(sortPromptLibraryEntries(entries, 'oldest').map((entry) => entry.id)).toEqual([
      'old',
      'new',
      'undated',
    ])
  })
})

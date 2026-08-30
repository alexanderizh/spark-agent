import { describe, expect, it } from 'vitest'
import type { GlobalPromptLibraryItem, GlobalPromptLibraryState } from './canvasPromptLibraryStore'
import {
  PROMPT_LIBRARY_PACKAGE_KIND,
  buildPromptLibraryExportPayload,
  mergeImportedPromptLibrary,
  parsePromptLibraryPackage,
  promptCoverUrlToDataUrl,
} from './canvasPromptLibraryPackage'

function item(overrides: Partial<GlobalPromptLibraryItem> = {}): GlobalPromptLibraryItem {
  return {
    id: 'prompt_a',
    title: '夜景城市',
    text: 'a cyberpunk city at night',
    category: '风格',
    tags: ['夜景', '城市'],
    coverUrl: 'data:image/png;base64,AAA',
    coverMimeType: 'image/png',
    usageCount: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

function library(
  items: GlobalPromptLibraryItem[],
  categories: string[] = [],
): GlobalPromptLibraryState {
  return { version: 1, categories, items, legacyMigrated: true }
}

describe('buildPromptLibraryExportPayload', () => {
  it('wraps items into a spark.prompt-library payload', () => {
    const payload = buildPromptLibraryExportPayload({
      categories: ['风格'],
      items: [item()],
      exportedAt: '2026-08-26T00:00:00.000Z',
    })
    expect(payload.kind).toBe(PROMPT_LIBRARY_PACKAGE_KIND)
    expect(payload.version).toBe(1)
    expect(payload.app).toBe('Spark-Agent')
    expect(payload.exportedAt).toBe('2026-08-26T00:00:00.000Z')
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0]).toEqual(item())
  })
})

describe('parsePromptLibraryPackage', () => {
  it('parses and normalizes a valid package', () => {
    const raw = JSON.stringify({
      kind: PROMPT_LIBRARY_PACKAGE_KIND,
      version: 1,
      exportedAt: '2026-08-26T00:00:00.000Z',
      categories: ['风格', ''],
      items: [
        {
          id: 'a',
          title: '  ',
          text: ' hello ',
          tags: ['x', 1, ' ', 'y'],
          coverUrl: 'data:image/png;base64,AAA',
        },
        { id: 'b', text: '' },
        { nope: true },
      ],
    })
    const payload = parsePromptLibraryPackage(raw)
    expect(payload).not.toBeNull()
    expect(payload?.items).toHaveLength(1)
    const parsedItem = payload?.items[0]
    expect(parsedItem?.title).toBe('-')
    expect(parsedItem?.text).toBe('hello')
    expect(parsedItem?.tags).toEqual(['x', 'y'])
    expect(parsedItem?.coverMimeType).toBeNull()
    expect(payload?.categories).toEqual(['风格'])
  })

  it('rejects wrong kind, broken json and item-less packages', () => {
    expect(parsePromptLibraryPackage('not json')).toBeNull()
    expect(parsePromptLibraryPackage(JSON.stringify({ kind: 'other', items: [] }))).toBeNull()
    expect(
      parsePromptLibraryPackage(JSON.stringify({ kind: PROMPT_LIBRARY_PACKAGE_KIND, items: [] })),
    ).toBeNull()
    expect(
      parsePromptLibraryPackage(
        JSON.stringify({ kind: PROMPT_LIBRARY_PACKAGE_KIND, items: [{ id: 'a', text: ' ' }] }),
      ),
    ).toBeNull()
  })
})

describe('mergeImportedPromptLibrary', () => {
  it('imports new items and merges categories', () => {
    const payload = buildPromptLibraryExportPayload({
      categories: ['风格', '构图'],
      items: [item({ id: 'prompt_new', category: '构图' })],
    })
    const { next, importedCount, skippedCount } = mergeImportedPromptLibrary(
      library([item()], ['风格']),
      payload,
    )
    expect(importedCount).toBe(1)
    expect(skippedCount).toBe(0)
    expect(next.items.map((entry) => entry.id)).toEqual(['prompt_a', 'prompt_new'])
    expect(next.categories).toEqual(['风格', '构图'])
  })

  it('skips items whose content already exists (even with a different id)', () => {
    const payload = buildPromptLibraryExportPayload({
      categories: [],
      items: [item({ id: 'different_id' })],
    })
    const { next, importedCount, skippedCount } = mergeImportedPromptLibrary(
      library([item()]),
      payload,
    )
    expect(importedCount).toBe(0)
    expect(skippedCount).toBe(1)
    expect(next.items).toHaveLength(1)
  })

  it('regenerates the id when it collides but content differs', () => {
    const payload = buildPromptLibraryExportPayload({
      categories: [],
      items: [item({ id: 'prompt_a', text: 'different text' })],
    })
    const { next, importedCount } = mergeImportedPromptLibrary(library([item()]), payload)
    expect(importedCount).toBe(1)
    expect(next.items).toHaveLength(2)
    const importedEntry = next.items[1]
    expect(importedEntry?.id).not.toBe('prompt_a')
    expect(importedEntry?.id.startsWith('prompt_')).toBe(true)
    expect(importedEntry?.text).toBe('different text')
  })

  it('deduplicates repeated items inside one package', () => {
    const payload = buildPromptLibraryExportPayload({
      categories: [],
      items: [item({ id: 'one' }), item({ id: 'two' })],
    })
    const { importedCount, skippedCount } = mergeImportedPromptLibrary(library([]), payload)
    expect(importedCount).toBe(1)
    expect(skippedCount).toBe(1)
  })
})

describe('promptCoverUrlToDataUrl', () => {
  it('keeps image data urls untouched', async () => {
    const url = 'data:image/png;base64,AAA'
    await expect(promptCoverUrlToDataUrl(url)).resolves.toBe(url)
  })

  it('returns null for missing or non-local covers', async () => {
    await expect(promptCoverUrlToDataUrl(null)).resolves.toBeNull()
    await expect(promptCoverUrlToDataUrl(undefined)).resolves.toBeNull()
    await expect(promptCoverUrlToDataUrl('')).resolves.toBeNull()
    await expect(promptCoverUrlToDataUrl('https://example.com/cover.png')).resolves.toBeNull()
  })
})

import {
  ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS,
  AccountSyncIpcSchemaRegistry,
} from '../account-sync'
import { describe, expect, it } from 'vitest'

describe('account sync IPC contracts', () => {
  it('keeps all sync categories opt-in and validates partial preference updates', () => {
    expect(
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        enabled: true,
        categories: { memory: true, appearance: false },
      }),
    ).toEqual({
      enabled: true,
      categories: { memory: true, appearance: false },
    })
  })

  it('rejects renderer-supplied user identity and unknown categories', () => {
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        enabled: true,
        userId: 'another-user',
      }),
    ).toThrow()
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({
        categories: { providers: true },
      }),
    ).toThrow()
  })

  it('rejects empty preference mutations and over-sized history pages', () => {
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:update-preferences'].parse({}),
    ).toThrow()
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:list-history'].parse({ pageSize: 101 }),
    ).toThrow()
  })

  it('accepts bounded latest prompt-library items and rejects unknown snapshot fields', () => {
    const item = {
      id: 'legacy:project-1:prompt-1',
      title: '项目提示词',
      text: '镜头缓慢推进',
      category: '运镜',
      tags: ['镜头'],
      coverUrl: null,
      coverMimeType: null,
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }
    expect(
      AccountSyncIpcSchemaRegistry['account-sync:execute'].parse({
        promptLibraryItems: [item],
      }),
    ).toEqual({ promptLibraryItems: [item] })
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:preview'].parse({
        promptLibraryItems: [{ ...item, snapshotJson: '{}' }],
      }),
    ).toThrow()
  })

  it('rejects prompt-library items whose combined IPC payload exceeds the total limit', () => {
    const sharedCover = 'x'.repeat(10_000_000)
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `legacy:project-${index}:prompt-${index}`,
      title: '项目提示词',
      text: '镜头缓慢推进',
      category: '运镜',
      tags: ['镜头'],
      coverUrl: sharedCover,
      coverMimeType: 'image/png',
      createdAt: '2026-08-29T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    }))
    expect(sharedCover.length * items.length).toBe(ACCOUNT_SYNC_PROMPT_LIBRARY_MAX_TOTAL_CHARS)
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:execute'].parse({ promptLibraryItems: items }),
    ).toThrow('提示词库同步数据超过单次 IPC 总大小上限')
  })
})

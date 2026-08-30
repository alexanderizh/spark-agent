// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMPOSER_DRAFT_RESTORE_EVENT,
  COMPOSER_DRAFTS_LEGACY_KEY,
  NEW_SESSION_DRAFT_BUCKET,
  clearComposerDraftBuckets,
  clearComposerDraftMapBuckets,
  createComposerDraftWriter,
  gcComposerDraftBuckets,
  isEmptyDraft,
  readComposerDrafts,
  restoreComposerDraftBucket,
  writeComposerDraftBucket,
  type ComposerDraftRestoreDetail,
  type ComposerDraftMap,
} from '../design/views/chat/composer-drafts'
import type { ComposerDraftSnapshot } from '../design/views/chat/ChatComposerTypes'

const DRAFT_KEY_PREFIX = 'spark-agent:composer-draft:'

function draft(value: string): ComposerDraftSnapshot {
  return { value, attachments: [], sessionReferences: [], manualExpanded: false }
}

/** 清掉 per-bucket key + 旧全量 key，保证每个用例独立 */
function clearAllDraftKeys(): void {
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i)
    if (key == null) continue
    if (key.startsWith(DRAFT_KEY_PREFIX) || key === COMPOSER_DRAFTS_LEGACY_KEY) {
      window.localStorage.removeItem(key)
    }
  }
}

describe('composer draft persistence (per-bucket key)', () => {
  beforeEach(clearAllDraftKeys)
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('readComposerDrafts', () => {
    it('reads each bucket from its own localStorage key', () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 's1', JSON.stringify(draft('hello s1')))
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 's2', JSON.stringify(draft('hi s2')))

      const drafts = readComposerDrafts()

      expect(Object.keys(drafts).sort()).toEqual(['s1', 's2'])
      expect(drafts.s1?.value).toBe('hello s1')
    })

    it('drops a single corrupt bucket without losing the others', () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'good', JSON.stringify(draft('ok')))
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'bad', '{not json')

      const drafts = readComposerDrafts()

      expect(Object.keys(drafts)).toEqual(['good'])
    })

    it('migrates legacy全量 key into per-bucket keys then removes it', () => {
      // 旧数据格式：一个 key 存全部草稿字典
      const legacy: ComposerDraftMap = {
        legacy1: draft('from legacy'),
        legacy2: draft('also legacy'),
      }
      window.localStorage.setItem(COMPOSER_DRAFTS_LEGACY_KEY, JSON.stringify(legacy))

      const drafts = readComposerDrafts()

      expect(drafts.legacy1?.value).toBe('from legacy')
      expect(drafts.legacy2?.value).toBe('also legacy')
      // 旧 key 必须被删——否则每次启动都白读一遍
      expect(window.localStorage.getItem(COMPOSER_DRAFTS_LEGACY_KEY)).toBeNull()
      // 数据已落到 per-bucket key
      expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + 'legacy1')).not.toBeNull()
    })

    it('does not let per-bucket data be overwritten by legacy migration', () => {
      // per-bucket 已有的不应被旧数据覆盖
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 's1', JSON.stringify(draft('newer')))
      window.localStorage.setItem(
        COMPOSER_DRAFTS_LEGACY_KEY,
        JSON.stringify({ s1: draft('older') }),
      )

      const drafts = readComposerDrafts()

      expect(drafts.s1?.value).toBe('newer')
    })
  })

  describe('gcComposerDraftBuckets', () => {
    it('removes buckets for deleted sessions (O(1) removeItem)', () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'alive', JSON.stringify(draft('keep')))
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'deleted', JSON.stringify(draft('orphan')))

      const { removed, kept } = gcComposerDraftBuckets(new Set(['alive']))

      expect(removed).toContain('deleted')
      expect(kept.alive?.value).toBe('keep')
      expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + 'deleted')).toBeNull()
    })

    it('removes empty drafts (no point keeping them around)', () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'empty', JSON.stringify(draft('   ')))
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'real', JSON.stringify(draft('content')))

      const { removed } = gcComposerDraftBuckets(new Set(['empty', 'real']))

      expect(removed).toContain('empty')
      expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + 'empty')).toBeNull()
    })

    it('never deletes by session existence when the session list is unknown', () => {
      // 会话列表未加载完时按存在性删除会把用户全部草稿误删
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'a', JSON.stringify(draft('x')))
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'b', JSON.stringify(draft('y')))

      const { kept } = gcComposerDraftBuckets(null)

      expect(Object.keys(kept).sort()).toEqual(['a', 'b'])
    })
  })

  describe('createComposerDraftWriter (per-bucket debounce)', () => {
    it('coalesces rapid edits to the same bucket into one write', () => {
      vi.useFakeTimers()
      const setItem = vi.spyOn(Storage.prototype, 'setItem')
      const writer = createComposerDraftWriter({ debounceMs: 500 })

      writer.writeBucket('s1', draft('h'))
      writer.writeBucket('s1', draft('he'))
      writer.writeBucket('s1', draft('hello'))
      expect(setItem).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)

      expect(setItem).toHaveBeenCalledTimes(1)
      expect(readComposerDrafts().s1?.value).toBe('hello')
    })

    it('flush persists pending writes immediately', () => {
      vi.useFakeTimers()
      const writer = createComposerDraftWriter({ debounceMs: 500 })

      writer.writeBucket('s1', draft('unsaved'))
      writer.flush()

      expect(readComposerDrafts().s1?.value).toBe('unsaved')
    })

    it('removeBucket is immediate (not debounced) — sent content must not linger', () => {
      vi.useFakeTimers()
      const writer = createComposerDraftWriter({ debounceMs: 500 })

      writer.writeBucket('s1', draft('will be removed'))
      writer.removeBucket('s1')
      // 不推进 timer，删除应已生效
      expect(window.localStorage.getItem(DRAFT_KEY_PREFIX + 's1')).toBeNull()
    })

    it('clears a new-session draft before unmount so remount cannot restore sent content', () => {
      vi.useFakeTimers()
      const writer = createComposerDraftWriter({ debounceMs: 500 })
      const initialDrafts: ComposerDraftMap = {
        [NEW_SESSION_DRAFT_BUCKET]: draft('first message'),
      }

      writer.writeBucket(NEW_SESSION_DRAFT_BUCKET, draft('first message'))
      vi.advanceTimersByTime(500)
      writer.writeBucket(NEW_SESSION_DRAFT_BUCKET, draft('pending stale message'))

      const clearedBuckets = clearComposerDraftBuckets(
        [NEW_SESSION_DRAFT_BUCKET, NEW_SESSION_DRAFT_BUCKET],
        writer,
      )
      const clearedDrafts = clearComposerDraftMapBuckets(initialDrafts, clearedBuckets)
      writer.dispose() // 模拟 hero → 会话布局导致旧 Composer 卸载

      expect(clearedBuckets).toEqual([NEW_SESSION_DRAFT_BUCKET])
      expect(clearedDrafts[NEW_SESSION_DRAFT_BUCKET]?.value).toBe('')
      expect(readComposerDrafts()[NEW_SESSION_DRAFT_BUCKET]).toBeUndefined()
    })

    it('restores a failed new-session send across remount through storage and an event', () => {
      const restoredDraft = draft('retry this message')
      const onRestore = vi.fn((event: Event) => {
        const detail = (event as CustomEvent<ComposerDraftRestoreDetail>).detail
        expect(detail.bucket).toBe('session-created-before-failure')
        expect(detail.draft).toEqual(restoredDraft)
      })
      window.addEventListener(COMPOSER_DRAFT_RESTORE_EVENT, onRestore)

      restoreComposerDraftBucket('session-created-before-failure', restoredDraft)

      expect(onRestore).toHaveBeenCalledTimes(1)
      expect(readComposerDrafts()['session-created-before-failure']).toEqual(restoredDraft)
      window.removeEventListener(COMPOSER_DRAFT_RESTORE_EVENT, onRestore)
    })

    it('reports a persistence failure once instead of failing silently', () => {
      vi.useFakeTimers()
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      const onPersistError = vi.fn()
      const writer = createComposerDraftWriter({ debounceMs: 10, onPersistError })

      writer.writeBucket('s1', draft('a'))
      vi.advanceTimersByTime(10)
      writer.writeBucket('s1', draft('ab'))
      vi.advanceTimersByTime(10)

      expect(onPersistError).toHaveBeenCalledTimes(1)
    })
  })

  describe('writeComposerDraftBucket', () => {
    it('reports failure when storage rejects', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(writeComposerDraftBucket('s1', draft('x'))).toBe(false)
    })

    it('only writes one bucket — other buckets are untouched on the same write', () => {
      window.localStorage.setItem(DRAFT_KEY_PREFIX + 'other', JSON.stringify(draft('other')))

      writeComposerDraftBucket('s1', draft('mine'))

      expect(readComposerDrafts().s1?.value).toBe('mine')
      expect(readComposerDrafts().other?.value).toBe('other')
    })
  })

  describe('isEmptyDraft', () => {
    it('treats whitespace-only text with no attachments as empty', () => {
      expect(isEmptyDraft(draft('  \n '))).toBe(true)
      expect(isEmptyDraft(draft('x'))).toBe(false)
      expect(isEmptyDraft(undefined)).toBe(true)
    })
  })
})

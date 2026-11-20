import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SESSION_FILTER, matchSession } from '../../mobile/src/utils/session-filters'
import { classifySearchResult, hydrateSessionSearch } from './session-search'

const hit = { id: '51', title: '搜索命中', snippet: '正文片段' }

test('search finds a session beyond page one when using combined filters', async () => {
  const offsets: number[] = []
  const matches = await hydrateSessionSearch(
    [hit],
    async (offset) => {
      offsets.push(offset)
      if (offset === 0) {
        return {
          sessions: Array.from({ length: 50 }, (_, id) => ({
            id: String(id + 1),
            title: '其他会话',
          })),
          nextOffset: 50,
        }
      }
      return {
        sessions: [
          {
            ...hit,
            status: 'running',
            sessionLabel: 'pending-review',
            pinnedAt: '2026-11-20T00:00:00Z',
            projectId: 'project',
          },
        ],
        nextOffset: 100,
      }
    },
    () => true,
  )
  assert.deepEqual(offsets, [0, 50])
  assert.deepEqual(
    matches
      .filter((row) =>
        matchSession(row, {
          ...DEFAULT_SESSION_FILTER,
          statuses: ['running'],
          labels: ['pending-review'],
          pinnedOnly: true,
          projectIds: ['project'],
        }),
      )
      .map(({ id, snippet }) => ({ id, snippet })),
    [{ id: '51', snippet: '正文片段' }],
  )
})

test('a superseded search stops requesting later pages', async () => {
  let current = true
  const offsets: number[] = []
  const matches = await hydrateSessionSearch(
    [hit],
    async (offset) => {
      offsets.push(offset)
      current = false
      return { sessions: [], nextOffset: 50 }
    },
    () => current,
  )
  assert.deepEqual(offsets, [0])
  assert.deepEqual(matches, [])
})

test('a promoted search hit survives unstable desktop pagination', async () => {
  const recent = Array.from({ length: 50 }, (_, index) => ({
    id: String(index + 1),
    title: '其他会话',
  }))
  const promoted = { ...hit, sessionLabel: 'pending-review' as const }
  const matches = await hydrateSessionSearch(
    [hit],
    async (offset) => {
      // The legacy desktop sorts only the candidates fetched for this page.
      const candidates = [...recent, promoted].slice(0, offset + 50)
      const sorted = candidates.includes(promoted)
        ? [promoted, ...candidates.filter((row) => row !== promoted)]
        : candidates
      return { sessions: sorted.slice(offset, offset + 50), nextOffset: offset === 0 ? 50 : null }
    },
    () => true,
  )
  assert.deepEqual(matches, [{ ...hit, detailsMissing: true }])
  assert.equal(classifySearchResult(matches[0], DEFAULT_SESSION_FILTER), 'matched')
  assert.equal(
    classifySearchResult(matches[0], { ...DEFAULT_SESSION_FILTER, labels: ['pending-review'] }),
    'unverified',
  )
  assert.equal(
    classifySearchResult(matches[0], { ...DEFAULT_SESSION_FILTER, labels: ['unlabeled'] }),
    'unverified',
  )
})

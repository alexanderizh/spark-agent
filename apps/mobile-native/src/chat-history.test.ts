import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import { ChatCache } from './ChatCache'
import { loadHistoryWindow, reconcileHistory } from './chat-history'

const event = (seq: number): MobileBridgeEvent => ({
  seq,
  id: `e${seq}`,
  turnId: 'turn',
  type: 'assistant_message',
  timestamp: '2026-11-20T00:00:00Z',
  content: `回复 ${seq}`,
})
const page = (seqs: number[], nextBeforeSeq: number | null) => ({
  events: seqs.map(event),
  nextBeforeSeq,
  running: true,
})

test('reconnect fills unseen pages, deduplicates overlap, and preserves the live tail', async () => {
  const cursors: (number | undefined)[] = []
  const history = await loadHistoryWindow(
    async (cursor) => {
      cursors.push(cursor)
      if (cursor === undefined) return page([7, 8], 7)
      if (cursor === 7) return page([], 6)
      if (cursor === 6) return page([4, 5], 4)
      return page([2, 3], 2)
    },
    event(3),
    () => true,
  )
  const snapshot = reconcileHistory(
    {
      timeline: { events: [1, 2, 3, 8, 9].map(event), running: undefined },
      nextBeforeSeq: null,
    },
    history,
    true,
  )
  assert.deepEqual(cursors, [undefined, 7, 6, 4])
  assert.deepEqual(
    snapshot.timeline.events.map(({ seq }) => seq),
    [1, 2, 3, 4, 5, 7, 8, 9],
  )
  assert.equal(snapshot.nextBeforeSeq, null)
  assert.equal(snapshot.timeline.running, undefined)
})

test('a failed catch-up keeps the contiguous recent window and the retryable older cursor', async () => {
  const history = await loadHistoryWindow(
    async (cursor) => {
      if (cursor === undefined) return page([10, 11], 10)
      if (cursor === 10) return page([8, 9], 8)
      throw new Error('temporary failure')
    },
    event(2),
    () => true,
  )
  const snapshot = reconcileHistory(
    {
      timeline: { events: [1, 2, 11, 12].map(event) },
      nextBeforeSeq: null,
    },
    history,
    false,
  )
  assert.equal(history.overlaps, false)
  assert.deepEqual(
    snapshot.timeline.events.map(({ seq }) => seq),
    [8, 9, 10, 11, 12],
  )
  assert.equal(snapshot.nextBeforeSeq, 8)
  assert.equal(snapshot.timeline.running, true)
})

test('a long disconnect limits automatic backfill and exposes the next cursor', async () => {
  const cursors: (number | undefined)[] = []
  const history = await loadHistoryWindow(
    async (cursor) => {
      cursors.push(cursor)
      const start = cursor === undefined ? 20 : cursor - 2
      return page([start, start + 1], start)
    },
    event(2),
    () => true,
  )
  assert.deepEqual(cursors, [undefined, 20, 18, 16, 14])
  assert.equal(history.overlaps, false)
  assert.equal(history.nextBeforeSeq, 12)
})

test('reopening after a failed refresh resumes from the confirmed cache anchor', async () => {
  const cache = new ChatCache()
  const target = { deviceId: 'desktop', sessionId: 'chat' }
  const confirmed = reconcileHistory(
    { timeline: { events: [] }, nextBeforeSeq: null },
    await loadHistoryWindow(
      async () => page([1, 2], null),
      undefined,
      () => true,
    ),
    false,
  )
  await assert.rejects(
    loadHistoryWindow(
      async () => {
        throw new Error('disconnected')
      },
      event(2),
      () => true,
    ),
  )
  cache.write(target, {
    ...confirmed,
    timeline: { events: [...confirmed.timeline.events, event(9)] },
  })
  const cached = cache.read(target)
  assert.ok(cached)
  assert.deepEqual(cached.historyAnchor, { id: 'e2', seq: 2 })
  const requests: (number | undefined)[] = []
  const reopened = await loadHistoryWindow(
    async (cursor) => {
      requests.push(cursor)
      return cursor === undefined ? page([8, 9], 8) : page([2, 3, 4, 5, 6, 7], 2)
    },
    cached.historyAnchor,
    () => true,
  )
  const restored = reconcileHistory(cached, reopened, false)
  assert.deepEqual(requests, [undefined, 8])
  assert.deepEqual(
    restored.timeline.events.map(({ seq }) => seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  )
})

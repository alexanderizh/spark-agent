import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import { ChatCache } from './ChatCache'

test('keeps cached history and drafts isolated and uses the retained history boundary', () => {
  const cache = new ChatCache()
  const target = { deviceId: 'first', sessionId: 'same' }
  const other = { ...target, deviceId: 'second' }
  const events: MobileBridgeEvent[] = Array.from({ length: 161 }, (_, seq) => ({
    id: `event-${seq}`,
    seq,
    turnId: 'turn',
    type: 'user_message',
    timestamp: '2026-11-19T00:00:00.000Z',
  }))
  cache.write(target, { timeline: { events, running: true }, nextBeforeSeq: null })
  assert.equal(cache.read(target)?.timeline.events.length, 160)
  assert.equal(cache.read(target)?.nextBeforeSeq, 1)
  assert.equal(cache.read(target)?.timeline.running, undefined)
  assert.equal(cache.read(other), undefined)
  const files = [{ name: 'photo.jpg', uri: 'file:///photo.jpg' }]
  cache.setFiles(target, files)
  assert.deepEqual(cache.getFiles(target), files)
  assert.deepEqual(cache.getFiles(other), [])
})

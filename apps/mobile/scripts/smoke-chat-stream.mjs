#!/usr/bin/env node
/**
 * 流式时间线回归：真实助手增量、思考增量、final 收敛与中继重连重放去重。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { applyEvents, emptyTimeline, filterUnseenEvents } = require(
  join(root, 'dist/utils/chat-reducer.js'),
)
const { buildTimelineItems } = require(join(root, 'dist/utils/chat-view.js'))

const timestamp = '2026-10-16T00:00:00.000Z'
const userEvent = {
  id: 'evt-user',
  seq: 1,
  turnId: 'turn-1',
  type: 'user_message',
  timestamp,
  content: '请解释流式输出',
}
const assistantDelta1 = {
  id: 'evt-assistant-1',
  seq: 2,
  turnId: 'turn-1',
  type: 'assistant_message',
  timestamp,
  content: '流式',
  mode: 'delta',
  segmentId: 'assistant-segment-1',
}
const thinkingDelta1 = {
  id: 'evt-thinking-1',
  seq: 3,
  turnId: 'turn-1',
  type: 'agent_thinking',
  timestamp,
  content: '先读取上下文，',
  mode: 'delta',
  segmentId: 'thinking-segment-1',
}

const seenEventIds = new Set()
const firstBatch = filterUnseenEvents(seenEventIds, [userEvent, assistantDelta1, thinkingDelta1])
let timeline = applyEvents(emptyTimeline(), firstBatch)
let items = buildTimelineItems(timeline.messages)
assert.equal(items.find((item) => item.kind === 'assistant')?.text, '流式')
assert.equal(items.find((item) => item.kind === 'thinking')?.text, '先读取上下文，')

// 中继重连会重放同一回合已有事件：相同 ID 不得再次拼接 delta。
const replayBatch = filterUnseenEvents(seenEventIds, [userEvent, assistantDelta1, thinkingDelta1])
assert.equal(replayBatch.length, 0)
timeline = applyEvents(timeline, replayBatch)
items = buildTimelineItems(timeline.messages)
assert.equal(items.find((item) => item.kind === 'assistant')?.text, '流式')
assert.equal(items.find((item) => item.kind === 'thinking')?.text, '先读取上下文，')

const assistantDelta2 = {
  ...assistantDelta1,
  id: 'evt-assistant-2',
  seq: 4,
  content: '输出',
}
const thinkingDelta2 = {
  ...thinkingDelta1,
  id: 'evt-thinking-2',
  seq: 5,
  content: '再展示思考增量。',
}
timeline = applyEvents(
  timeline,
  filterUnseenEvents(seenEventIds, [assistantDelta2, thinkingDelta2]),
)
items = buildTimelineItems(timeline.messages)
assert.equal(items.find((item) => item.kind === 'assistant')?.text, '流式输出')
assert.equal(items.find((item) => item.kind === 'thinking')?.text, '先读取上下文，再展示思考增量。')

timeline = applyEvents(
  timeline,
  filterUnseenEvents(seenEventIds, [
    {
      id: 'evt-assistant-final',
      seq: 6,
      turnId: 'turn-1',
      type: 'assistant_message',
      timestamp,
      content: '流式输出',
      isFinal: true,
    },
    {
      id: 'evt-completed',
      seq: 7,
      turnId: 'turn-1',
      type: 'agent_status',
      timestamp,
      status: 'completed',
    },
  ]),
)
items = buildTimelineItems(timeline.messages)
assert.equal(items.filter((item) => item.kind === 'assistant').length, 1)
assert.equal(items.find((item) => item.kind === 'assistant')?.text, '流式输出')
assert.equal(items.find((item) => item.kind === 'thinking')?.text, '先读取上下文，再展示思考增量。')
assert.equal(timeline.running, false)

console.log('smoke:chat-stream 通过：正文增量、思考增量、final 收敛、重连重放去重')

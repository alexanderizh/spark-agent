#!/usr/bin/env node
/**
 * 会话内消息排序回归冒烟（需先 build）。
 *
 * 用户反馈：截图里 14:56 的分块横线排在 23:06 之后，新的会话内容被排到
 * 下午的会话附近。根因是端上把「未见过的事件」直接 applyEvents(当前时间线, 新事件)
 * 追加到末尾，服务端补写/晚到的旧 seq 事件因此跑到最新消息下面；同时横线时间
 * 直接取 event.timestamp，而上游 seq 与 timestamp 并不保证同步。
 *
 * 本脚本固化三条口径：
 *   1. 事件合并按 id 去重 + 按 seq 排序，出现补写旧事件就全量重放（不追加）
 *   2. 展示时间单调化，不倒退、不改写事件原始 timestamp
 *   3. 同一分段的 delta 与 complete 只认完整版，agent 输出不得出现两遍
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// chat-* 工具模块只在函数内部访问 wx，这里给最小 mock 备着
const store = new Map()
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/spark-mobile-smoke' },
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => store.set(key, value),
  removeStorageSync: (key) => store.delete(key),
}

const order = require(join(root, 'dist/utils/chat-order.js'))
const reducer = require(join(root, 'dist/utils/chat-reducer.js'))
const view = require(join(root, 'dist/utils/chat-view.js'))

const results = []
function check(name, fn) {
  fn()
  results.push(name)
  console.log(`✅ ${name}`)
}

const iso = (hour, minute) => {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

const evt = (seq, id, type, timestamp, extra = {}) => ({
  id,
  seq,
  turnId: `turn-${Math.floor(seq / 10)}`,
  type,
  timestamp,
  ...extra,
})

// ─── 1. 排序口径 ─────────────────────────────────────────────────────────────

check('sortEvents 按 seq 升序，seq 相同按 timestamp / id 稳定排序', () => {
  const events = [
    evt(5, 'e5', 'agent_thinking', iso(23, 6)),
    evt(2, 'e2b', 'tool_result', iso(23, 5)),
    evt(2, 'e2a', 'tool_call', iso(23, 5)),
    evt(1, 'e1', 'user_message', iso(23, 4)),
  ]
  assert.deepEqual(
    order.sortEvents(events).map((e) => e.id),
    ['e1', 'e2a', 'e2b', 'e5'],
  )
  assert.equal(events[0].id, 'e5', 'sortEvents 不得修改入参')
})

check('monotonicCreatedAt 钳住倒退时间，保留前进时间，不改原始事件', () => {
  const earlier = iso(14, 56)
  const later = iso(23, 6)
  assert.equal(order.monotonicCreatedAt(earlier, later), later)
  assert.equal(order.monotonicCreatedAt(later, earlier), later)
  assert.equal(order.monotonicCreatedAt(later, ''), later)
  assert.equal(order.monotonicCreatedAt(undefined, later), later)
  assert.equal(order.monotonicCreatedAt('not-a-date', later), later)
})

// ─── 2. 合并与补写识别 ───────────────────────────────────────────────────────

const baseEvents = () => [
  evt(1, 'u1', 'user_message', iso(23, 6), { content: '验证一下今天的开奖数据' }),
  evt(2, 't1', 'tool_call', iso(23, 6), { toolCallId: 'tc1', toolName: 'read_file' }),
  evt(4, 'u2', 'user_message', iso(23, 6), { content: '给我重新推一下' }),
  evt(5, 'a2', 'assistant_message', iso(23, 6), { content: '稍等，我先核实', isFinal: true }),
]

check('mergeEvents 按 id 去重，重复事件不会进入 added（防 delta 二次拼接）', () => {
  const base = baseEvents()
  const merged = order.mergeEvents(base, [
    base[1],
    evt(6, 'a3', 'assistant_message', iso(23, 7), { content: '新回复' }),
  ])
  assert.deepEqual(
    merged.added.map((e) => e.id),
    ['a3'],
  )
  assert.equal(merged.events.length, 5)
  assert.equal(merged.maxSeq, 6)
  assert.equal(merged.hasBackfill, false)
})

check('mergeEvents 识别补写旧事件（hasBackfill），并按 seq 插回原位而非追加末尾', () => {
  const base = baseEvents()
  // 桌面端补写了一条 seq=3 的旧事件，timestamp 是下午（seq 与 timestamp 脱钩）
  const backfill = evt(3, 't2', 'tool_call', iso(14, 56), {
    toolCallId: 'tc2',
    toolName: 'query_lottery',
  })
  const merged = order.mergeEvents(base, [backfill])
  assert.equal(merged.hasBackfill, true)
  assert.deepEqual(
    merged.events.map((e) => e.seq),
    [1, 2, 3, 4, 5],
  )
  assert.equal(merged.events[2].id, 't2')
  assert.equal(merged.events[4].id, 'a2', '最新回复仍在末尾')
  assert.equal(merged.events[2].timestamp, iso(14, 56), '不得改写服务端原始 timestamp')
})

check('hasGap 只在整批事件越过已应用区间且中间无补写时为真', () => {
  const base = baseEvents()
  assert.equal(order.mergeEvents(base, [evt(6, 'x', 'tool_call', iso(23, 7))]).hasGap, false)
  assert.equal(order.mergeEvents(base, [evt(9, 'x', 'tool_call', iso(23, 7))]).hasGap, true)
  assert.equal(
    order.mergeEvents(base, [
      evt(3, 'y', 'tool_call', iso(14, 56)),
      evt(9, 'x', 'tool_call', iso(23, 7)),
    ]).hasGap,
    false,
  )
})

// ─── 3. 端到端：补写后全量重放，渲染顺序与时间标签都不倒退 ──────────────────

check('补写事件触发全量重放后，渲染顺序严格按 seq（旧事件不会跑到新内容之后）', () => {
  const base = baseEvents()
  const backfill = evt(3, 't2', 'tool_call', iso(14, 56), {
    toolCallId: 'tc2',
    toolName: 'query_lottery',
  })
  const merged = order.mergeEvents(base, [backfill])
  // 页面在 hasBackfill 时走全量重放；旧实现走 applyEvents(latestTimeline, added)
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), merged.events)
  const keys = timeline.messages.map((m) => m.key)
  assert.deepEqual(keys, ['u:u1', 't:tc1', 't:tc2', 'u:u2', 'a:turn-0'])

  // 对照：旧行为会把补写的工具行追加到末尾（这正是 bug）
  const stale = reducer.applyEvents(reducer.emptyTimeline(), base)
  const appended = reducer.applyEvents(stale, merged.added)
  assert.equal(appended.messages[appended.messages.length - 1].key, 't:tc2')
})

check('时间倒挂时横线标签单调不减，且天分界只出现一次', () => {
  const messages = [
    { key: 'u:1', role: 'user', text: '开始', createdAt: iso(23, 6) },
    { key: 't:1', role: 'tool', text: '读取', toolStatus: 'success', createdAt: iso(23, 6) },
    { key: 'a:1', role: 'assistant', text: '第一轮', createdAt: iso(23, 6) },
    // seq 更靠后，但服务端透传的 timestamp 是下午
    { key: 't:2', role: 'tool', text: '查询', toolStatus: 'success', createdAt: iso(14, 56) },
    { key: 'a:2', role: 'assistant', text: '第二轮', createdAt: iso(14, 56) },
  ]
  const items = view.filterExecutionDetails(view.buildTimelineItems(messages), true)
  const times = items.filter((item) => item.kind === 'time')
  assert.equal(times.length, 1, '时间倒退不该让天分界来回跳')
  const dividers = items.filter((item) => item.kind === 'divider')
  assert.equal(dividers.length, 2)
  assert.equal(dividers[0].label, '23:06')
  assert.equal(dividers[1].label, '23:06', '14:56 不该出现在 23:06 之后')
  assert.equal(items[items.length - 1].text, '第二轮', '消息本体顺序不受影响')
})

check('混合新增 + 补写时，新增事件仍排在正确位置且 running 由权威值收敛', () => {
  const base = baseEvents()
  const incoming = [
    evt(3, 't2', 'tool_call', iso(14, 56), { toolCallId: 'tc2', toolName: 'query_lottery' }),
    evt(6, 's1', 'agent_status', iso(23, 8), { status: 'completed' }),
  ]
  const merged = order.mergeEvents(base, incoming)
  assert.equal(merged.hasBackfill, true)
  assert.deepEqual(
    merged.events.map((e) => e.seq),
    [1, 2, 3, 4, 5, 6],
  )
  const timeline = reducer.withServerRunning(
    reducer.applyEvents(reducer.emptyTimeline(), merged.events),
    false,
  )
  assert.equal(timeline.running, false)
  assert.equal(
    timeline.messages.some((m) => m.role === 'tool' && m.toolStatus === 'running'),
    false,
  )
})

// ─── 4. 输出唯一性：回放 delta 不能和完整版叠加成两遍 ──────────────────────

const fullText =
  '主人好，今天是 2026128 期开奖日。Eva 先核对开奖数据，再和库里十注对比，最后给出结论与建议。'
const turnId = 'turn-7'
const segId = 'seg-1'
const deltaEvent = (seq, id, chunk) =>
  evt(seq, id, 'assistant_message', iso(23, 6), {
    turnId,
    segmentId: segId,
    mode: 'delta',
    content: chunk,
  })
const completeEvent = (seq, id) =>
  evt(seq, id, 'assistant_message', iso(23, 6), {
    turnId,
    segmentId: segId,
    mode: 'complete',
    content: fullText,
  })

const replayDeltas = () => {
  const cut1 = Math.floor(fullText.length / 3)
  const cut2 = Math.floor((fullText.length * 2) / 3)
  return [
    deltaEvent(2, 'd1', fullText.slice(0, cut1)),
    deltaEvent(3, 'd2', fullText.slice(cut1, cut2)),
    deltaEvent(4, 'd3', fullText.slice(cut2)),
  ]
}

check('历史已有完整版时，回放 delta 被合并器丢弃，不再追加成两遍', () => {
  const base = [completeEvent(5, 'c1')]
  const merged = order.mergeEvents(base, replayDeltas())
  assert.equal(merged.droppedRedundantDeltas, 3)
  assert.equal(merged.added.length, 0)
  assert.equal(merged.events.length, 1)
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), merged.events)
  assert.equal(timeline.messages.length, 1)
  assert.equal(timeline.messages[0].text, fullText)
})

check('同一批事件里 delta 与 complete 混合时，归一化只认完整版', () => {
  const mixed = [...replayDeltas(), completeEvent(5, 'c1')]
  assert.deepEqual(
    order.normalizeTextEvents(mixed).map((e) => e.id),
    ['c1'],
  )
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), mixed)
  assert.equal(timeline.messages.length, 1)
  assert.equal(timeline.messages[0].text, fullText)
})

check('只有 delta 的流式分段仍正常累加，不被误杀', () => {
  const merged = order.mergeEvents([], replayDeltas())
  assert.equal(merged.added.length, 3)
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), merged.events)
  assert.equal(timeline.messages.length, 1)
  assert.equal(timeline.messages[0].text, fullText)
})

check('绕过合并器时，气泡自重复兜底也能把两遍收敛成一遍', () => {
  const base = reducer.applyEvents(reducer.emptyTimeline(), [completeEvent(5, 'c1')])
  const doubled = reducer.applyEvents(base, order.sortEvents(replayDeltas()))
  assert.equal(doubled.messages.length, 1)
  assert.equal(doubled.messages[0].text, fullText)
})

check('final 与分段 turnId 不一致时，不重复插入整段输出', () => {
  const finalEvent = evt(6, 'f1', 'assistant_message', iso(23, 7), {
    turnId: 'turn-other',
    isFinal: true,
    content: fullText,
  })
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), [
    completeEvent(5, 'c1'),
    finalEvent,
  ])
  const assistants = timeline.messages.filter((m) => m.role === 'assistant')
  assert.equal(assistants.length, 1)
  assert.equal(assistants[0].text, fullText)
})

check('同一回合内文本完全相同的两条分段气泡只保留一条', () => {
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), [
    completeEvent(5, 'c1'),
    evt(6, 'c2', 'assistant_message', iso(23, 7), {
      turnId,
      segmentId: 'seg-2',
      mode: 'complete',
      content: fullText,
    }),
  ])
  assert.equal(timeline.messages.filter((m) => m.role === 'assistant').length, 1)
})

console.log(`\n[smoke-chat-order] ${results.length}/${results.length} 通过`)

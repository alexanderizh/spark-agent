#!/usr/bin/env node
/**
 * 会话纵向间距档位回归冒烟（需先 build）。
 *
 * 用户反馈：远程会话里「各个阶段输出之间的空隙太大」，一轮之内的
 * 思考 → 工具 → 正文 被撑得七零八落，看不出谁和谁是一轮。
 *
 * 根因：所有消息行统一 `margin: 16rpx 0`，轮边界与轮内阶段拿到同一档空隙。
 * 改法：utils/chat-view.ts 的 assignTimelineGaps 按角色回填 gap 档位，
 * WXSS 的 .gap-* 落地；各行的基准 margin 全部归零。
 *
 * 本脚本固化五条口径：
 *   1. 首行不预留顶部空隙
 *   2. 用户提问（新一轮）拿到最大档，与上一轮总结之间能「换气」
 *   3. 轮内过程段（思考 / 工具 / 状态）紧贴上一条，不抢注意力
 *   4. 轮内正文段 / 产物间距中等，与过程段明确区分
 *   5. 天级分界与折叠横线自带分隔语义，比正文松一档
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const store = new Map()
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/spark-mobile-smoke' },
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => store.set(key, value),
  removeStorageSync: (key) => store.delete(key),
}

const view = require(join(root, 'dist/utils/chat-view.js'))

const results = []
function check(name, fn) {
  fn()
  results.push(name)
  console.log(`✅ ${name}`)
}

const at = (minute) => new Date(Date.UTC(2026, 10, 14, 9, minute, 0)).toISOString()

const user = (key, minute, text = '看一下分页') => ({
  kind: 'user',
  key,
  text,
  turnId: `t-${key}`,
  createdAt: at(minute),
})
const assistant = (key, minute, text = '正文') => ({
  kind: 'assistant',
  key,
  text,
  createdAt: at(minute),
})
const thinking = (key, minute, text = '想一下') => ({
  kind: 'thinking',
  key,
  text,
  createdAt: at(minute),
})
const tool = (key, minute, name = 'bash') => ({
  kind: 'tool',
  key,
  toolName: name,
  toolStatus: 'success',
  text: `${name} 完成`,
  createdAt: at(minute),
})
const status = (key, minute, tone = 'done', text = '已完成 · 8s') => ({
  kind: 'status',
  key,
  tone,
  text,
  createdAt: at(minute),
})
const media = (key, minute) => ({
  kind: 'media',
  key,
  paths: ['/tmp/a.png'],
  createdAt: at(minute),
})
const day = (key, minute, label = '今天 09:00') => ({
  kind: 'time',
  key,
  label,
  createdAt: at(minute),
})

const gapsOf = (items) => items.map((item) => item.gap)

// ─── 1. 首行与轮边界 ────────────────────────────────────────────────────────

check('首行不预留顶部空隙（gap=first）', () => {
  const items = view.assignTimelineGaps([user('u1', 0), assistant('a1', 1)])
  assert.equal(items[0].gap, 'first')
  assert.equal(items[1].gap, 'block')
})

check('新一轮（用户提问）拿到最大档，与上一轮总结换气', () => {
  const items = view.assignTimelineGaps([
    user('u1', 0),
    assistant('a1', 1, '第一轮总结'),
    user('u2', 2),
    assistant('a2', 3, '第二轮总结'),
  ])
  assert.deepEqual(gapsOf(items), ['first', 'block', 'turn', 'block'])
})

// ─── 2. 轮内阶段要紧扣 ──────────────────────────────────────────────────────

check('轮内 思考 → 工具 → 状态 连续过程段全部贴紧（gap=tight）', () => {
  const items = view.assignTimelineGaps([
    user('u1', 0),
    thinking('th1', 1),
    tool('t1', 2),
    status('s1', 3),
    assistant('a1', 4, '结论'),
  ])
  assert.deepEqual(gapsOf(items), ['first', 'tight', 'tight', 'tight', 'block'])
})

check('轮内多段正文用中间档（gap=block），与过程段明确区分', () => {
  const items = view.assignTimelineGaps([
    user('u1', 0),
    assistant('a1', 1, '先看代码'),
    tool('t1', 2),
    assistant('a2', 3, '改完了'),
    media('m1', 4),
  ])
  assert.deepEqual(gapsOf(items), ['first', 'block', 'tight', 'block', 'block'])
})

check('产物图片与正文同级（都是交付结果，不是过程日志）', () => {
  const items = view.assignTimelineGaps([user('u1', 0), assistant('a1', 1), media('m1', 2)])
  assert.equal(items[2].gap, 'block')
})

// ─── 3. 分隔语义行 ──────────────────────────────────────────────────────────

check('天级分界与折叠横线自带分隔语义（gap=section），比正文松一档', () => {
  const items = view.assignTimelineGaps([
    day('d1', 0),
    user('u1', 1),
    assistant('a1', 2, '先看代码'),
    tool('t1', 3),
    assistant('a2', 4, '结论'),
  ])
  const folded = view.collapseFinishedTurns(items, { running: false })
  const withGaps = view.assignTimelineGaps(folded)
  assert.equal(withGaps[0].gap, 'first')
  assert.equal(withGaps[1].gap, 'turn')
  // 折叠横线落在 a1 上，比正文松一档
  assert.equal(withGaps[2].kind, 'divider')
  assert.equal(withGaps[2].gap, 'section')
  assert.equal(withGaps[3].gap, 'block')
})

// ─── 4. 与折叠管线叠加 ──────────────────────────────────────────────────────

check('折叠后再算档位：横线位置与档位都不错位', () => {
  const base = [
    user('u1', 0),
    assistant('a1', 1, '先看代码'),
    thinking('th1', 2),
    tool('t1', 3),
    assistant('a2', 4, '结论'),
    user('u2', 5),
    assistant('a3', 6, '第二轮'),
  ]
  const folded = view.collapseFinishedTurns(base, { running: false })
  const items = view.assignTimelineGaps(folded)
  assert.deepEqual(
    items.map((i) => i.kind),
    ['user', 'divider', 'assistant', 'user', 'assistant'],
  )
  assert.deepEqual(gapsOf(items), ['first', 'section', 'block', 'turn', 'block'])
})

check('执行详情过滤（隐藏工具/思考）之后再算档位，横线仍是 section', () => {
  const base = [user('u1', 0), tool('t1', 1), tool('t2', 2), assistant('a1', 3, '结论')]
  const filtered = view.filterExecutionDetails(base, true)
  const items = view.assignTimelineGaps(filtered)
  assert.equal(items[1].kind, 'divider')
  assert.equal(items[1].variant, 'execution')
  assert.equal(items[1].gap, 'section')
  assert.equal(items[2].gap, 'block')
})

check('空列表与原位返回都不炸', () => {
  assert.deepEqual(view.assignTimelineGaps([]), [])
})

console.log(`\n[smoke-chat-gap] ${results.length}/${results.length} 通过`)

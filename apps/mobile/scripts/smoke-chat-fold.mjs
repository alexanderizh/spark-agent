#!/usr/bin/env node
/**
 * 会话内「回合处理完自动折叠」回归冒烟（需先 build）。
 *
 * 用户反馈：远程会话里目标端一轮被拆成「正文 → 干活 → 正文 → 干活 → 总结」，
 * 中途消息一股脑全铺出来看不出结论；要求像桌面端主对话区那样，处理完后
 * 只展开最后一段总结，中间过程收进一条横线。
 *
 * 本脚本固化五条口径：
 *   1. 处理完的一轮只留最后一段正文，中间正文段 / 思考 / 工具 / 状态行收起
 *   2. 运行中的最后一轮保持展开（实时进展不能被收起来）
 *   3. 只有一段正文、或没有正文总结（只跑了工具）时不折叠
 *   4. 有错误提示时整轮不折叠，产物图片始终可见
 *   5. 点开折叠块（expandedKeys）后过程原地展开，横线仍在可再次收起
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

const keysOf = (items) => items.map((item) => item.key)

// ─── 1. 处理完的一轮只留最后一段正文 ────────────────────────────────────────

check('处理完的一轮：中间正文段 / 思考 / 工具 / 状态行收起，只留最后正文 + 折叠横线', () => {
  const items = [
    user('u1', 0),
    assistant('a1', 1, '我先看下代码'),
    thinking('th1', 2),
    tool('t1', 3),
    status('s1', 4),
    assistant('a2', 5, '改好了，结论是这样'),
  ]
  const folded = view.collapseFinishedTurns(items, { running: false })
  // 横线落在这轮第一段被收起的条目上（这里是中间正文 a1）
  assert.deepEqual(keysOf(folded), ['u1', 'turn:a1', 'a2'])
  const divider = folded[1]
  assert.equal(divider.kind, 'divider')
  assert.equal(divider.variant, 'turn')
  assert.equal(divider.hiddenCount, 4)
  assert.match(divider.text, /已折叠 4 段过程/)
})

check('运行中的最后一轮保持展开（实时进展不能被收起来）', () => {
  const items = [user('u1', 0), assistant('a1', 1), tool('t1', 2), assistant('a2', 3)]
  const folded = view.collapseFinishedTurns(items, { running: true })
  assert.deepEqual(keysOf(folded), ['u1', 'a1', 't1', 'a2'])
})

check('前面的轮次已处理完、最后一轮在跑：只折前面的，最后一段原样展开', () => {
  const items = [
    user('u1', 0),
    assistant('a1', 1),
    tool('t1', 2),
    assistant('a2', 3),
    user('u2', 4),
    assistant('a3', 5),
    tool('t2', 6),
    assistant('a4', 7),
  ]
  const folded = view.collapseFinishedTurns(items, { running: true })
  assert.deepEqual(keysOf(folded), ['u1', 'turn:a1', 'a2', 'u2', 'a3', 't2', 'a4'])
})

// ─── 2. 不该折叠的情形 ──────────────────────────────────────────────────────

check('只有一段正文的轮次不折（收了也没变化，只多一条横线）', () => {
  const items = [user('u1', 0), assistant('a1', 1)]
  assert.deepEqual(keysOf(view.collapseFinishedTurns(items, { running: false })), ['u1', 'a1'])
})

check('没有正文总结（只跑了工具就中断）时不折，避免只剩一条空横线', () => {
  const items = [user('u1', 0), thinking('th1', 1), tool('t1', 2)]
  assert.deepEqual(keysOf(view.collapseFinishedTurns(items, { running: false })), [
    'u1',
    'th1',
    't1',
  ])
})

check('有错误提示时整轮不折（报错必须留在折叠外）', () => {
  const items = [
    user('u1', 0),
    assistant('a1', 1),
    tool('t1', 2),
    status('s1', 3, 'error', '运行失败'),
    assistant('a2', 4),
  ]
  assert.equal(
    view.collapseFinishedTurns(items, { running: false }).filter((i) => i.kind === 'divider')
      .length,
    0,
  )
})

check('产物图片与天级分界始终可见', () => {
  const items = [
    user('u1', 0),
    day('d1', 0),
    assistant('a1', 1),
    media('m1', 2),
    tool('t1', 3),
    assistant('a2', 4),
  ]
  const folded = view.collapseFinishedTurns(items, { running: false })
  assert.deepEqual(keysOf(folded), ['u1', 'd1', 'turn:a1', 'm1', 'a2'])
})

// ─── 3. 展开态 ──────────────────────────────────────────────────────────────

check('点开折叠块后过程原地展开，横线仍在（可再次收起）', () => {
  const items = [user('u1', 0), assistant('a1', 1), tool('t1', 2), assistant('a2', 3)]
  const collapsed = view.collapseFinishedTurns(items, { running: false })
  const key = collapsed.find((item) => item.kind === 'divider').key
  const expanded = view.collapseFinishedTurns(items, {
    running: false,
    expandedKeys: new Set([key]),
  })
  assert.deepEqual(keysOf(expanded), ['u1', 'turn:a1', 'a1', 't1', 'a2'])
  assert.equal(expanded[1].expanded, true)
  // 折叠 key 只依赖首条被折叠项，两种状态之间不跳位
  assert.equal(key, 'turn:a1')
})

// ─── 4. 与「隐藏执行详情」串联 ──────────────────────────────────────────────

check('折叠后再跑执行详情过滤：折叠轮不再多出一条工具横线', () => {
  const items = [user('u1', 0), thinking('th1', 1), tool('t1', 2), assistant('a1', 3)]
  const folded = view.collapseFinishedTurns(items, { running: false })
  const filtered = view.filterExecutionDetails(folded, true, new Set())
  const dividers = filtered.filter((item) => item.kind === 'divider')
  // 工具/思考已经被回合折叠收走，执行详情过滤没有可折的东西
  assert.equal(dividers.length, 1)
  assert.equal(dividers[0].variant, 'turn')
})

check('执行详情横线文案带到达时间与条数（改版后由 text 统一承载）', () => {
  const items = [user('u1', 0), thinking('th1', 1), tool('t1', 2), assistant('a1', 3)]
  const filtered = view.filterExecutionDetails(items, true, new Set())
  const divider = filtered.find((item) => item.kind === 'divider')
  assert.equal(divider.variant, 'execution')
  assert.match(divider.text, /2 条工具记录/)
})

console.log(`\n[smoke-chat-fold] ${results.length}/${results.length} 通过`)

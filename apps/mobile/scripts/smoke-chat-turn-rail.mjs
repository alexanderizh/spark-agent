#!/usr/bin/env node
/**
 * 轮次轨道（右侧刻度）回归冒烟（需先 build）。
 *
 * 用户反馈：移动端会话缺少桌面端 ChatTurnNavigator 那样的轮次显示器，
 * 长会话滚几下就不知道自己在第几轮、某一轮讲了什么。
 *
 * 本脚本固化八条口径：
 *   1. 用户提问即新一轮起点；列表首条自成一轮（历史分页可能从助手消息开始）
 *   2. 锚点 id 去掉 `:` 等 selector 不安全字符，且只落在每轮首条上
 *   3. ordinal 从 1 起连续递增
 *   4. 摘要取「该轮最后一段有文字的助手正文」（与回合折叠留总结同口径）
 *   5. 无文字提问 / 无文字答复有兜底文案，不出空行
 *   6. pickActiveTurnKey：按滚动位置挑「最后一个已经过去的轮次」
 *   7. 全部没过去取第一轮，全部过去自然落到最后一轮
 *   8. 量不到偏移的轮次被跳过，不影响其余判定
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

const view = require(join(root, 'dist/utils/turn-rail.js'))

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
const tool = (key, minute) => ({
  kind: 'tool',
  key,
  toolName: 'bash',
  toolStatus: 'success',
  text: '跑完了',
  createdAt: at(minute),
})

// ─── 1. 轮次切分 ────────────────────────────────────────────────────────────

check('用户提问即新一轮起点，一轮之内的过程段不另起轮', () => {
  const items = [
    user('u1', 0),
    assistant('a1', 1, '先看代码'),
    tool('t1', 2),
    assistant('a2', 3, '改好了'),
    user('u2', 4),
    assistant('a3', 5, '第二轮'),
  ]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns.length, 2)
  assert.deepEqual(
    turns.map((t) => t.key),
    ['u1', 'u2'],
  )
  assert.deepEqual(
    turns.map((t) => t.ordinal),
    [1, 2],
  )
})

check('列表首条不是用户消息时也自成一轮（历史分页从助手消息开始）', () => {
  const items = [assistant('a1', 0, '上一轮没写完'), user('u1', 1), assistant('a2', 2, '这轮')]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns.length, 2)
  assert.deepEqual(
    turns.map((t) => t.key),
    ['a1', 'u1'],
  )
})

check('连续两条用户消息各算一轮（与回合折叠切段口径一致）', () => {
  const items = [user('u1', 0), user('u2', 1), assistant('a1', 2)]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns.length, 2)
})

// ─── 2. 锚点 id ─────────────────────────────────────────────────────────────

check('锚点 id 剔除 selector 不安全字符（key 里的 : 会坑 SelectorQuery）', () => {
  const items = [user('u1', 0), assistant('a:turn-1', 1), user('u2', 2)]
  const { turns, items: out } = view.buildTurnRail(items)
  assert.equal(turns[0].anchorId, 'turn-u1')
  assert.equal(turns[1].anchorId, 'turn-u2')
  // 助手消息的 key 含冒号，但不是轮次首条，不该拿到锚点
  assert.equal(out[1].turnAnchorId, undefined)
  for (const turn of turns) assert.match(turn.anchorId, /^turn-[a-zA-Z0-9_-]+$/)
})

check('锚点 id 只回填到每轮首条，同一条消息不会被两个轮次认领', () => {
  const items = [user('u1', 0), assistant('a1', 1), user('u2', 2), assistant('a2', 3)]
  const { items: out } = view.buildTurnRail(items)
  assert.equal(out[0].turnAnchorId, 'turn-u1')
  assert.equal(out[2].turnAnchorId, 'turn-u2')
  assert.equal(out[1].turnAnchorId, undefined)
  assert.equal(out[3].turnAnchorId, undefined)
})

// ─── 3. 预览摘要 ────────────────────────────────────────────────────────────

check('助手摘要取该轮最后一段有文字的正文（与回合折叠留总结同口径）', () => {
  const items = [
    user('u1', 0, '修一下分页'),
    assistant('a1', 1, '先看代码'),
    tool('t1', 2),
    assistant('a2', 3, '改好了，加了 beforeSeq 游标'),
  ]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns[0].userPreview, '修一下分页')
  assert.equal(turns[0].assistantPreview, '改好了，加了 beforeSeq 游标')
})

check('超长摘要截断并加省略号', () => {
  const long = '啊'.repeat(200)
  const items = [user('u1', 0, long), assistant('a1', 1, long)]
  const { turns } = view.buildTurnRail(items)
  assert.ok(turns[0].userPreview.endsWith('…'))
  assert.ok(turns[0].userPreview.length < long.length)
  assert.ok(turns[0].assistantPreview.endsWith('…'))
})

check('纯附件提问 / 无文字答复有兜底文案，不出空行', () => {
  const items = [user('u1', 0, ''), tool('t1', 1)]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns[0].userPreview, '（这一轮没有文字提问）')
  assert.equal(turns[0].assistantPreview, '（这一轮没有文字答复）')
})

check('空白字符被压平（换行/多空格不会把预览卡撑爆）', () => {
  const items = [user('u1', 0, '  第一行\n\n第二行   第三行  ')]
  const { turns } = view.buildTurnRail(items)
  assert.equal(turns[0].userPreview, '第一行 第二行 第三行')
})

// ─── 4. 当前轮判定 ──────────────────────────────────────────────────────────

const sampleTurns = [
  { key: 'u1', ordinal: 1, anchorId: 'turn-u1', userPreview: '', assistantPreview: '' },
  { key: 'u2', ordinal: 2, anchorId: 'turn-u2', userPreview: '', assistantPreview: '' },
  { key: 'u3', ordinal: 3, anchorId: 'turn-u3', userPreview: '', assistantPreview: '' },
]
const sampleTops = new Map([
  ['turn-u1', 0],
  ['turn-u2', 1000],
  ['turn-u3', 2000],
])

check('滚动位置决定当前轮：最后一个「已经过去」的轮次', () => {
  assert.equal(view.pickActiveTurnKey(sampleTurns, sampleTops, 0), 'u1')
  assert.equal(view.pickActiveTurnKey(sampleTurns, sampleTops, 1050), 'u2')
  assert.equal(view.pickActiveTurnKey(sampleTurns, sampleTops, 5000), 'u3')
})

check('激活边距内就算「轮到它」：不必等锚点压到视口顶', () => {
  // 边距 80px：滚到 930 时第二轮就算激活
  assert.equal(view.pickActiveTurnKey(sampleTurns, sampleTops, 930), 'u2')
  assert.equal(view.pickActiveTurnKey(sampleTurns, sampleTops, 919), 'u1')
})

check('全部轮次都在下方时取第一轮（用户在会话最顶端）', () => {
  const tops = new Map([
    ['turn-u1', 500],
    ['turn-u2', 1500],
  ])
  assert.equal(view.pickActiveTurnKey(sampleTurns.slice(0, 2), tops, 0), 'u1')
})

check('量不到偏移的轮次被跳过，不影响其余判定', () => {
  const partial = new Map([
    ['turn-u1', 0],
    ['turn-u3', 2000],
  ])
  assert.equal(view.pickActiveTurnKey(sampleTurns, partial, 1200), 'u1')
  assert.equal(view.pickActiveTurnKey(sampleTurns, partial, 2100), 'u3')
})

// ─── 5. 边界 ────────────────────────────────────────────────────────────────

check('空列表：无轮次、无当前轮', () => {
  const { turns, items } = view.buildTurnRail([])
  assert.deepEqual(turns, [])
  assert.deepEqual(items, [])
  assert.equal(view.pickActiveTurnKey([], new Map(), 0), null)
})

console.log(`\n[smoke-chat-turn-rail] ${results.length}/${results.length} 通过`)

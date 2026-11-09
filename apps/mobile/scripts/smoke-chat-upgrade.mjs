#!/usr/bin/env node
/**
 * 会话页增强能力回归冒烟（需先 build）。
 *
 * 覆盖本轮修复的四个最容易回退的点：
 *   1. 纯图片/纯附件消息用零宽哨兵过桌面端 text 必填校验，渲染层不画文字气泡
 *   2. 隐藏工具/思考记录 → 连续段折叠成「浅色横线 + 到达时间」分块，可点开
 *   3. 服务端权威 running 覆盖本地归约 + 终态收敛工具 running 行
 *   4. 本地待发队列（幂等键 / 失败可重试 / 持久化）与复制纯文本
 */

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

// wx.storage 最小 mock（队列 / 快照模块只在函数内部访问 wx）
const store = new Map()
globalThis.wx = {
  env: { USER_DATA_PATH: '/tmp/spark-mobile-smoke' },
  getStorageSync: (key) => (store.has(key) ? store.get(key) : ''),
  setStorageSync: (key, value) => store.set(key, value),
  removeStorageSync: (key) => store.delete(key),
}

const view = require(join(root, 'dist/utils/chat-view.js'))
const reducer = require(join(root, 'dist/utils/chat-reducer.js'))
const queue = require(join(root, 'dist/utils/send-queue.js'))
const markdown = require(join(root, 'dist/utils/markdown.js'))

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

// ─── 1. 纯附件消息 ────────────────────────────────────────────────────────────

check('纯附件哨兵文本 trim 后仍非空，可过桌面端必填校验', () => {
  assert.equal(view.ATTACHMENT_ONLY_FALLBACK_TEXT.trim().length > 0, true)
  assert.equal(view.isAttachmentOnlyText(view.ATTACHMENT_ONLY_FALLBACK_TEXT), true)
})

check('纯附件消息不渲染文字气泡，普通文本不受影响', () => {
  assert.equal(view.displayTextOf(view.ATTACHMENT_ONLY_FALLBACK_TEXT), '')
  assert.equal(view.displayTextOf('你好'), '你好')
  const items = view.buildTimelineItems([
    {
      key: 'u:1',
      role: 'user',
      text: view.ATTACHMENT_ONLY_FALLBACK_TEXT,
      createdAt: iso(14, 32),
      attachments: [{ type: 'image', path: '/tmp/a.png' }],
    },
  ])
  const user = items.find((item) => item.kind === 'user')
  assert.equal(user.text, '')
  assert.equal(user.attachmentOnly, true)
  assert.equal(user.attachments.length, 1)
})

// ─── 2. 工具隐藏 → 浅色横线分块 ──────────────────────────────────────────────

const timelineItems = () => [
  { kind: 'user', key: 'u:1', text: '开始', createdAt: iso(14, 30) },
  {
    kind: 'tool',
    key: 't:1',
    toolName: 'read_file',
    toolStatus: 'success',
    createdAt: iso(14, 31),
  },
  { kind: 'thinking', key: 'r:1', text: '思考…', createdAt: iso(14, 31) },
  {
    kind: 'tool',
    key: 't:2',
    toolName: 'write_file',
    toolStatus: 'success',
    createdAt: iso(14, 32),
  },
  { kind: 'assistant', key: 'a:1', text: '完成', createdAt: iso(14, 33) },
]

check('隐藏执行详情时连续工具/思考段折叠为一条带到达时间的横线', () => {
  const out = view.filterExecutionDetails(timelineItems(), true)
  assert.equal(out.length, 3)
  assert.equal(out[0].kind, 'user')
  assert.equal(out[1].kind, 'divider')
  assert.equal(out[1].hiddenCount, 3)
  assert.match(out[1].label, /^\d{1,2}:\d{2}$/)
  assert.equal(out[1].label, '14:31')
  assert.equal(out[2].kind, 'assistant')
})

check('点击横线可临时展开被折叠的执行记录，key 稳定不随新增工具变化', () => {
  const items = timelineItems()
  const key = view.filterExecutionDetails(items, true)[1].key
  const expanded = view.filterExecutionDetails(items, true, new Set([key]))
  assert.equal(expanded.length, 6)
  assert.equal(expanded[1].kind, 'divider')
  assert.equal(expanded[1].expanded, true)
  assert.equal(expanded[2].kind, 'tool')
  const withMore = view.filterExecutionDetails(
    [
      ...items.slice(0, 4),
      { kind: 'tool', key: 't:3', toolName: 'bash', toolStatus: 'success', createdAt: iso(14, 32) },
      ...items.slice(4),
    ],
    true,
  )
  assert.equal(withMore[1].key, key)
  assert.equal(withMore[1].hiddenCount, 4)
})

check('显示执行详情时原样输出，不插横线', () => {
  const out = view.filterExecutionDetails(timelineItems(), false)
  assert.equal(out.length, 5)
  assert.equal(
    out.some((item) => item.kind === 'divider'),
    false,
  )
})

// ─── 3. 运行中状态权威校正 ────────────────────────────────────────────────────

check('终态事件收敛所有 still-running 工具行', () => {
  const timeline = reducer.applyEvents(reducer.emptyTimeline(), [
    { id: 'u1', seq: 1, type: 'user_message', timestamp: iso(14, 30), content: '跑一下' },
    {
      id: 'tc1',
      seq: 2,
      type: 'tool_call',
      timestamp: iso(14, 31),
      toolCallId: 'c1',
      toolName: 'bash',
    },
    { id: 'st1', seq: 3, type: 'agent_status', timestamp: iso(14, 32), status: 'completed' },
  ])
  assert.equal(timeline.running, false)
  const tool = timeline.messages.find((item) => item.role === 'tool')
  assert.equal(tool.toolStatus, 'success')
})

check('服务端权威 running=false 覆盖本地归约并清掉运行指示', () => {
  const stale = {
    messages: [
      { key: 's:1', role: 'status', tone: 'running', text: '思考中', createdAt: iso(14, 31) },
      {
        key: 't:1',
        role: 'tool',
        toolName: 'bash',
        toolStatus: 'running',
        text: '',
        createdAt: iso(14, 31),
      },
    ],
    running: true,
  }
  const fixed = reducer.withServerRunning(stale, false)
  assert.equal(fixed.running, false)
  assert.equal(
    fixed.messages.some((item) => item.role === 'status'),
    false,
  )
  assert.equal(fixed.messages[0].toolStatus, 'success')
})

// ─── 4. 本地待发队列 ──────────────────────────────────────────────────────────

check('待发队列落盘、串行取件、失败可重试、成功后移除', () => {
  const sessionId = 'smoke-session'
  const clientId = queue.makeClientId()
  assert.match(clientId, /^cm-/)
  queue.enqueueMessage(sessionId, {
    clientId,
    text: '只发一张图',
    attachmentPaths: ['/tmp/a.png'],
    attachments: [{ type: 'image', path: '/tmp/a.png', localPath: 'wxfile://a.png' }],
    createdAt: Date.now(),
    status: 'sending',
    attempts: 0,
  })
  const loaded = queue.loadSendQueue(sessionId)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].attachments[0].localPath, 'wxfile://a.png')
  assert.equal(queue.nextSendable(loaded)?.clientId, clientId)

  queue.patchQueuedMessage(sessionId, clientId, {
    status: 'failed',
    attempts: 1,
    error: '连接已断开',
  })
  assert.equal(queue.nextSendable(queue.loadSendQueue(sessionId))?.clientId, clientId)
  queue.patchQueuedMessage(sessionId, clientId, { status: 'failed', attempts: 0, error: undefined })
  assert.equal(queue.loadSendQueue(sessionId)[0].error, undefined)

  queue.dropQueuedMessage(sessionId, clientId)
  assert.equal(queue.loadSendQueue(sessionId).length, 0)
})

check('错误信息归一为可操作文案', () => {
  assert.equal(queue.sendFailureMessage(new Error('电脑端响应超时')), '电脑端响应超时')
  assert.equal(queue.sendFailureMessage(new Error('NETWORK')), '连接已断开')
})

check('Markdown 可复制为纯文本', () => {
  const plain = markdown.markdownPlainText('## 标题\n\n**加粗** 与 `代码`\n\n- 列表项')
  assert.ok(plain.includes('标题'))
  assert.ok(plain.includes('加粗'))
  assert.ok(plain.includes('代码'))
  assert.ok(plain.includes('列表项'))
  assert.equal(plain.includes('**'), false)
})

console.log(`\n会话页增强冒烟：${results.length} 项断言全部通过`)

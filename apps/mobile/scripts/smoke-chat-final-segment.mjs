#!/usr/bin/env node
/**
 * 回合收尾（isFinal）事件对账回归：三种引擎的 final 形态不得造成双份渲染。
 *
 * 真实形态来源（生产库实测）：
 *   claude  分段 complete（isFinal=false, segmentId=<uuid>）+ 回合收尾
 *           （isFinal=true, 无 segmentId，内容 = 最后一段/整轮全文）
 *   codex   分段 complete（isFinal=false, segmentId=`codex-sdk-{turnId}-text-N`）
 *           + 回合收尾（isFinal=true, segmentId=`codex-sdk-{turnId}`，
 *           内容 = 整轮总结，内嵌各分段正文）
 *   spark   每段 complete 都带 isFinal=true + 独立 segmentId（无独立收尾事件）
 *
 * 历史缺陷：移动端要求 `segmentId == null` 才走收尾对账，codex 收尾落到分段
 * 路径 → 整轮总结被当成新分段，与各分段气泡并存 → 同一段输出显示两遍。
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
const { mergeEvents } = require(join(root, 'dist/utils/chat-order.js'))
const { buildTimelineItems, collapseFinishedTurns } = require(join(root, 'dist/utils/chat-view.js'))

const ts = '2026-11-21T00:00:00.000Z'

/** 重复判据：一条气泡的完整正文（≥20 字）被另一条更长气泡包含 */
function findContainedTexts(texts) {
  const contained = []
  for (const a of texts) {
    if (a.trim().length < 20) continue
    for (const b of texts) {
      if (a === b || b.length <= a.length) continue
      if (b.includes(a)) {
        contained.push(a.slice(0, 20))
        break
      }
    }
  }
  return contained
}

function assistantTexts(timeline) {
  return buildTimelineItems(timeline.messages)
    .filter((item) => item.kind === 'assistant')
    .map((item) => item.text)
}

// ─── codex：收尾带独立 segmentId，内容为整轮总结（内嵌分段正文） ───────────────
{
  const turnId = 't-codex'
  const segBase = `codex-sdk-${turnId}`
  const events = [
    { id: 'u1', seq: 1, turnId, type: 'user_message', timestamp: ts, content: '查一下线上问题' },
    {
      id: 'a1',
      seq: 2,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: '我先接手当前问题，按顺序排查根因。',
      segmentId: `${segBase}-text-1`,
    },
    {
      id: 'a2',
      seq: 3,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: '日志已加载，前 20 分钟在做画布。',
      segmentId: `${segBase}-text-2`,
    },
    {
      id: 'c1',
      seq: 4,
      turnId,
      type: 'tool_call',
      timestamp: ts,
      toolName: 'bash',
      toolCallId: 'tc1',
    },
    {
      id: 'a3',
      seq: 5,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: '定位到了，是重连重放把 delta 拼了两遍。',
      segmentId: `${segBase}-text-3`,
    },
    // 回合收尾：isFinal=true 且带独立 segmentId（= bare id），内容为整轮总结
    {
      id: 'af',
      seq: 6,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      isFinal: true,
      content:
        '我先接手当前问题，按顺序排查根因。\n\n日志已加载，前 20 分钟在做画帆布面板。\n\n定位到了，是重连重放把 delta 拼了两遍，已修复并验证通过。',
      segmentId: segBase,
    },
    { id: 's1', seq: 7, turnId, type: 'agent_status', timestamp: ts, status: 'completed' },
  ]

  // 全量重放：收尾必须对账（不新增分段），总结内容只出现一遍
  const timeline = applyEvents(emptyTimeline(), events)
  const texts = assistantTexts(timeline)
  assert.equal(
    findContainedTexts(texts).length,
    0,
    `codex 收尾不得与分段并存造成包含式重复: ${findContainedTexts(texts).join(' | ')}`,
  )
  const finalText = events.find((e) => e.isFinal === true).content
  assert.equal(texts.filter((t) => t === finalText).length, 1, 'codex 收尾文本应恰好渲染一次')

  // 分批增量（模拟实时流切片）：同样不得重复
  let allEvents = []
  let incremental = null
  const seen = new Set()
  for (let i = 0; i < events.length; i += 3) {
    const unseen = filterUnseenEvents(seen, events.slice(i, i + 3))
    if (unseen.length === 0) continue
    const merged = mergeEvents(allEvents, unseen)
    for (const e of merged.dropped) seen.add(e.id)
    if (merged.added.length > 0) {
      allEvents = merged.events
      incremental =
        merged.hasBackfill || incremental == null
          ? applyEvents(emptyTimeline(), allEvents)
          : applyEvents(incremental, merged.added)
    }
  }
  const liveTexts = assistantTexts(incremental)
  assert.equal(findContainedTexts(liveTexts).length, 0, 'codex 增量管线收尾不得造成包含式重复')
  assert.equal(
    liveTexts.filter((t) => t === finalText).length,
    1,
    'codex 增量管线收尾文本应恰好渲染一次',
  )
  console.log('✅ codex 收尾（isFinal + segmentId）按回合对账，总结不再渲染两遍')
}

// ─── claude：收尾无 segmentId（回归保护：原路径不回退） ────────────────────────
{
  const turnId = 't-claude'
  const events = [
    { id: 'u1', seq: 1, turnId, type: 'user_message', timestamp: ts, content: '继续' },
    {
      id: 'a1',
      seq: 2,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: '分段正文一，先说结论。',
      segmentId: 'seg-1',
    },
    {
      id: 'a2',
      seq: 3,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: '分段正文二，补充验证细节。',
      segmentId: 'seg-2',
    },
    {
      id: 'af',
      seq: 4,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      isFinal: true,
      content: '分段正文二，补充验证细节。',
    },
    { id: 's1', seq: 5, turnId, type: 'agent_status', timestamp: ts, status: 'completed' },
  ]
  const timeline = applyEvents(emptyTimeline(), events)
  const texts = assistantTexts(timeline)
  assert.equal(findContainedTexts(texts).length, 0)
  assert.equal(texts.length, 2, 'claude 收尾等于末段时只保留两个分段气泡')
  console.log('✅ claude 收尾（isFinal 无 segmentId）末段对齐不重复')
}

// ─── spark：每段 complete 都带 isFinal（不得互相吞并） ────────────────────────
{
  const turnId = 't-spark'
  const events = [
    { id: 'u1', seq: 1, turnId, type: 'user_message', timestamp: ts, content: '跑通链路' },
    {
      id: 'a1',
      seq: 2,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      isFinal: true,
      content: '第一步：环境自检全部通过。',
      segmentId: 'spark-seg-1',
    },
    {
      id: 'c1',
      seq: 3,
      turnId,
      type: 'tool_call',
      timestamp: ts,
      toolName: 'bash',
      toolCallId: 'tc1',
    },
    {
      id: 'r1',
      seq: 4,
      turnId,
      type: 'tool_result',
      timestamp: ts,
      toolName: 'bash',
      toolCallId: 'tc1',
      toolStatus: 'success',
    },
    {
      id: 'a2',
      seq: 5,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      isFinal: true,
      content: '第二步：端到端用例跑通，十六项断言全部通过。',
      segmentId: 'spark-seg-2',
    },
    { id: 's1', seq: 6, turnId, type: 'agent_status', timestamp: ts, status: 'completed' },
  ]
  const timeline = applyEvents(emptyTimeline(), events)
  const texts = assistantTexts(timeline)
  assert.equal(texts.length, 2, 'spark 各分段保留为独立气泡')
  assert.ok(
    texts.some((t) => t.startsWith('第一步')),
    'spark 第一段内容可见',
  )
  assert.ok(
    texts.some((t) => t.startsWith('第二步')),
    'spark 第二段内容可见',
  )
  console.log('✅ spark 逐段 isFinal complete 保留为独立分段（不被收尾对账吞并）')
}

// ─── 折叠视图（渲染链路末端）下 codex 收尾也只出现一次 ─────────────────────────
{
  const turnId = 't-fold'
  const segBase = `codex-sdk-${turnId}`
  const segA = '收尾对账修复后，整轮总结只渲染一遍，分段叙述不再重复出现。'
  const summary = `${segA}\n\n以上就是本次修复的全部内容与验证结论。`
  const events = [
    { id: 'u1', seq: 1, turnId, type: 'user_message', timestamp: ts, content: '总结一下' },
    {
      id: 'a1',
      seq: 2,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      content: segA,
      segmentId: `${segBase}-text-1`,
    },
    {
      id: 'af',
      seq: 3,
      turnId,
      type: 'assistant_message',
      timestamp: ts,
      mode: 'complete',
      isFinal: true,
      content: summary,
      segmentId: segBase,
    },
    { id: 's1', seq: 4, turnId, type: 'agent_status', timestamp: ts, status: 'completed' },
  ]
  const timeline = applyEvents(emptyTimeline(), events)
  const folded = collapseFinishedTurns(buildTimelineItems(timeline.messages), { running: false })
  const foldedTexts = folded.filter((i) => i.kind === 'assistant').map((i) => i.text)
  assert.equal(foldedTexts.filter((t) => t.includes(segA)).length, 1, '折叠后总结正文只出现一次')
  console.log('✅ 折叠视图下收尾总结只出现一次')
}

console.log('smoke:chat-final-segment 通过：三引擎收尾对账无双份渲染')

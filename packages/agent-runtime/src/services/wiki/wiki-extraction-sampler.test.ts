/**
 * @module wiki-extraction-sampler.test
 *
 * 增量采样与本地噪声过滤测试（S2 §9.3 成本模型）。
 *
 * 断言重点是**成本与增量语义**：水位线之后才采样、寒暄 / 过短 / 无回复被
 * 本地筛掉（不花模型 token）、总量超限时均匀抽样、隐藏内部轮次不外泄。
 */

import { describe, it, expect } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  WIKI_SAMPLE_MAX_TURNS,
  WIKI_SAMPLE_TOTAL_MAX_CHARS,
  renderSampledTurns,
  sampleWikiExtractionTurns,
} from './wiki-extraction-sampler.js'

let seq = 0

function userEvent(turnId: string, content: string, hidden = false): AgentEvent {
  seq += 1
  return {
    type: 'user_message',
    id: `u${seq}`,
    turnId,
    timestamp: new Date().toISOString(),
    seq,
    content,
    ...(hidden ? { userMessageVisibility: 'hidden' as const } : {}),
  } as unknown as AgentEvent
}

function assistantEvent(turnId: string, content: string): AgentEvent {
  seq += 1
  return {
    type: 'assistant_message',
    id: `a${seq}`,
    turnId,
    timestamp: new Date().toISOString(),
    seq,
    mode: 'complete',
    content,
    isFinal: true,
  } as unknown as AgentEvent
}

/** 造一轮完整对话（用户 + 助手）。 */
function turn(turnId: string, user: string, assistant: string, hidden = false): AgentEvent[] {
  return [userEvent(turnId, user, hidden), assistantEvent(turnId, assistant)]
}

const LONG_USER = '我们线上 SQLite 的 FTS5 contentless 表在增量更新时检索不到新行，需要定位根因。'
const LONG_ASSISTANT =
  '根因是 contentless 表不存原文，增量更新必须显式 DELETE 旧行再 INSERT 新行，' +
  '否则同事务里的 FTS 索引会和外表不一致，后续查询直接漏数据。修复方式见下。'

describe('sampleWikiExtractionTurns', () => {
  it('按 turnId 配对用户与助手，输出稳定轮次序号', () => {
    const events = [
      ...turn('t1', LONG_USER, LONG_ASSISTANT),
      ...turn('t2', LONG_USER, LONG_ASSISTANT),
    ]
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns.map((t) => t.turnIndex)).toEqual([1, 2])
    expect(result.stats.totalTurns).toBe(2)
    expect(result.stats.newTurns).toBe(2)
    expect(result.stats.sampledTurns).toBe(2)
  })

  it('增量：只返回水位线之后的轮次', () => {
    const events = [
      ...turn('t1', LONG_USER, LONG_ASSISTANT),
      ...turn('t2', LONG_USER, LONG_ASSISTANT),
      ...turn('t3', LONG_USER, LONG_ASSISTANT),
    ]
    const result = sampleWikiExtractionTurns(events, 2)
    expect(result.turns.map((t) => t.turnIndex)).toEqual([3])
    expect(result.stats.totalTurns).toBe(3)
    expect(result.stats.newTurns).toBe(1)
  })

  it('纯寒暄轮被本地筛掉（不花模型 token）', () => {
    const events = [
      ...turn('t1', '你好', '你好！有什么可以帮你的吗？'),
      ...turn('t2', '谢谢', '不客气～'),
      ...turn('t3', LONG_USER, LONG_ASSISTANT),
    ]
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns.map((t) => t.turnIndex)).toEqual([3])
    expect(result.stats.skipped.greeting).toBe(2)
  })

  it('过短轮次被筛掉（一句话确认不算知识）', () => {
    const events = [
      ...turn('t1', '帮我看下这个报错', '可以，把日志发我'),
      ...turn('t2', LONG_USER, LONG_ASSISTANT),
    ]
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns.map((t) => t.turnIndex)).toEqual([2])
    expect(result.stats.skipped.too_short).toBe(1)
  })

  it('没有助手回复的轮次被筛掉', () => {
    const events = [userEvent('t1', LONG_USER), assistantEvent('t1', LONG_ASSISTANT)]
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns.map((t) => t.turnIndex)).toEqual([1])
    expect(result.stats.skipped.no_assistant).toBe(0)

    const events2 = [userEvent('t1', LONG_USER)]
    const result2 = sampleWikiExtractionTurns(events2)
    expect(result2.turns).toHaveLength(0)
    expect(result2.stats.skipped.no_assistant).toBe(1)
  })

  it('delta 模式的流式片段不参与采样（只要 complete）', () => {
    const events = [
      userEvent('t1', LONG_USER),
      {
        type: 'assistant_message',
        id: 'a1',
        turnId: 't1',
        timestamp: new Date().toISOString(),
        seq: (seq += 1),
        mode: 'delta',
        content: '正在思考…',
        isFinal: false,
      } as unknown as AgentEvent,
      assistantEvent('t1', LONG_ASSISTANT),
    ]
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]!.assistant).toBe(LONG_ASSISTANT)
  })

  it('总量超限时均匀抽样并标记 downsampled', () => {
    const events: AgentEvent[] = []
    for (let index = 1; index <= 60; index += 1) {
      events.push(...turn(`t${index}`, LONG_USER, LONG_ASSISTANT))
    }
    const result = sampleWikiExtractionTurns(events)
    expect(result.stats.downsampled).toBe(true)
    expect(result.turns.length).toBeLessThanOrEqual(WIKI_SAMPLE_MAX_TURNS)
    expect(result.stats.sampledChars).toBeLessThanOrEqual(WIKI_SAMPLE_TOTAL_MAX_CHARS)
    // 首尾都要保留，避免标题/结论只反映开场
    expect(result.turns[0]!.turnIndex).toBe(1)
    expect(result.turns[result.turns.length - 1]!.turnIndex).toBe(60)
  })

  it('单轮文本超限被截断', () => {
    const events = turn('t1', 'x'.repeat(5000), 'y'.repeat(5000))
    const result = sampleWikiExtractionTurns(events)
    expect(result.turns).toHaveLength(1)
    expect(result.turns[0]!.user.length).toBeLessThan(5000)
    expect(result.turns[0]!.assistant.length).toBeLessThan(5000)
  })

  it('渲染出的片段带轮次编号（溯源锚点）', () => {
    const events = [...turn('t1', LONG_USER, LONG_ASSISTANT)]
    const result = sampleWikiExtractionTurns(events)
    const rendered = renderSampledTurns(result.turns)
    expect(rendered).toContain('[第1轮]')
    expect(rendered).toContain('用户：')
    expect(rendered).toContain('助手：')
  })

  it('空事件流返回空采样而不是抛错', () => {
    const result = sampleWikiExtractionTurns([])
    expect(result.turns).toHaveLength(0)
    expect(result.stats.totalTurns).toBe(0)
  })
})

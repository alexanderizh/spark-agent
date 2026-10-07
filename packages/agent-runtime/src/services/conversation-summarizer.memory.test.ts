import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { estimateTokens } from '@spark/shared'
import {
  buildMemoryExtractionRecentContext,
  shouldExpandMemoryExtractionContext,
} from './conversation-summarizer.js'

function userMsg(turnId: string, content: string, seq: number): AgentEvent {
  return {
    type: 'user_message',
    id: `evt-${seq}`,
    sessionId: 'test-session',
    turnId,
    timestamp: new Date().toISOString(),
    seq,
    content,
  }
}

function assistantMsg(turnId: string, content: string, seq: number): AgentEvent {
  return {
    type: 'assistant_message',
    id: `evt-${seq}`,
    sessionId: 'test-session',
    turnId,
    timestamp: new Date().toISOString(),
    seq,
    content,
    mode: 'complete',
    provider: 'claude-sdk',
    isFinal: true,
  }
}

function dialogueRows(events: AgentEvent[]): Array<{ event_json: string; id: string }> {
  return events.map((event, i) => ({ event_json: JSON.stringify(event), id: `row-${i}` }))
}

describe('buildMemoryExtractionRecentContext', () => {
  it('returns a clipped session context for memory extraction', () => {
    const events: AgentEvent[] = [
      userMsg('t1', '先用架构师视角分析方案。', 1),
      assistantMsg('t1', '已按架构师视角给出技术选型分析。', 2),
      userMsg('t2', '对，就按刚才那个方式记一下。', 3),
    ]
    const mockEventRepo = {
      queryDialogueEvents: () => dialogueRows(events),
    } as any
    const result = buildMemoryExtractionRecentContext(mockEventRepo, 's1', { maxTokens: 120 })

    expect(estimateTokens(result)).toBeLessThanOrEqual(120)
    expect(result).toContain('记忆抽取近期上下文')
    expect(result).toContain('刚才那个方式')
  })

  it('returns an empty string when there is no dialogue history', () => {
    const mockEventRepo = {
      queryDialogueEvents: () => [],
    } as any
    const result = buildMemoryExtractionRecentContext(mockEventRepo, 's1')

    expect(result).toBe('')
  })

  it('excludes the current turn so the budget covers earlier history', () => {
    const events: AgentEvent[] = [
      userMsg('t1', '第一轮约定的架构决策内容。', 1),
      assistantMsg('t1', '已记录第一轮架构决策。', 2),
      userMsg('t2', '按刚才约定的架构记一下。', 3),
      assistantMsg('t2', '已记住。', 4),
    ]
    const mockEventRepo = {
      queryDialogueEvents: () => dialogueRows(events),
    } as any
    const result = buildMemoryExtractionRecentContext(mockEventRepo, 's1', {
      maxTokens: 500,
      excludeTurnId: 't2',
    })

    // 当前轮（t2）已单独进抽取 prompt，不应再挤占近期上下文窗口。
    expect(result).not.toContain('按刚才约定的架构记一下')
    expect(result).toContain('第一轮约定的架构决策')
  })

  it('exclusion is skipped when excludeTurnId is absent or empty', () => {
    const events: AgentEvent[] = [
      userMsg('t1', '第一轮内容。', 1),
      userMsg('t2', '第二轮内容。', 2),
    ]
    const mockEventRepo = {
      queryDialogueEvents: () => dialogueRows(events),
    } as any

    expect(buildMemoryExtractionRecentContext(mockEventRepo, 's1', { maxTokens: 500 })).toContain(
      '第二轮内容',
    )
    expect(
      buildMemoryExtractionRecentContext(mockEventRepo, 's1', {
        maxTokens: 500,
        excludeTurnId: '',
      }),
    ).toContain('第二轮内容')
  })
})

describe('shouldExpandMemoryExtractionContext', () => {
  it('detects explicit backward references (zh + en)', () => {
    expect(shouldExpandMemoryExtractionContext('按刚才那个方式处理')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('记住我们之前定的架构决策')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('沿用上述方案')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('你上面说的那个约定记一下')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('as we discussed earlier, remember this')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('the approach we agreed on last time')).toBe(true)
    expect(shouldExpandMemoryExtractionContext('apply the way we defined before')).toBe(true)
  })

  it('ignores ordinary phrasing without backward references', () => {
    expect(shouldExpandMemoryExtractionContext('帮我修这个 bug')).toBe(false)
    expect(shouldExpandMemoryExtractionContext('打开那个文件看看')).toBe(false)
    expect(shouldExpandMemoryExtractionContext('新建一个组件')).toBe(false)
    expect(shouldExpandMemoryExtractionContext('')).toBe(false)
  })
})

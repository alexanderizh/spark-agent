import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { buildMemoryExtractionRecentContext } from './conversation-summarizer.js'

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
    const mockDb = {
      raw: { prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }) },
    } as any

    const result = buildMemoryExtractionRecentContext(mockEventRepo, mockDb, 's1', 3, { maxChars: 120 })

    expect(result.length).toBeLessThanOrEqual(120)
    expect(result).toContain('记忆抽取近期上下文')
    expect(result).toContain('刚才那个方式')
  })

  it('returns an empty string when there is no dialogue history', () => {
    const mockEventRepo = {
      queryDialogueEvents: () => [],
    } as any
    const mockDb = {
      raw: { prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }) },
    } as any

    const result = buildMemoryExtractionRecentContext(mockEventRepo, mockDb, 's1', 0)

    expect(result).toBe('')
  })
})

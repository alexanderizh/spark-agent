/**
 * ConversationSummarizer unit tests
 *
 * Tests the extractive summarization logic and prompt generation.
 */

import { describe, it, expect } from 'vitest'
import { buildConversationHistoryWithSummary } from './conversation-summarizer.js'
import type { AgentEvent } from '@spark/protocol'

function mockRows(events: AgentEvent[], eventType?: string): Array<{ event_json: string; id: string }> {
  return events
    .filter((event) => eventType == null || event.type === eventType)
    .map((event, i) => ({ event_json: JSON.stringify(event), id: `row-${event.type}-${i}` }))
}

/** 模拟 EventRepository.queryDialogueEvents：对话类型 + 仅 complete（排除 delta） */
function dialogueRows(events: AgentEvent[]): Array<{ event_json: string; id: string }> {
  return mockRows(
    events.filter((e) => {
      if (e.type === 'user_message' || e.type === 'turn_prompt_snapshot') return true
      if (e.type === 'assistant_message' || e.type === 'team_member_message') {
        return (e as { mode?: string }).mode === 'complete'
      }
      return false
    }),
  )
}

// Helper: create a user_message event
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

// Helper: create an assistant_message event
function assistantMsg(turnId: string, content: string, seq: number, isFinal = true): AgentEvent {
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
    isFinal,
  }
}

function promptSnapshot(turnId: string, userMessage: string, seq: number): AgentEvent {
  return {
    type: 'turn_prompt_snapshot',
    id: `evt-${seq}`,
    sessionId: 'test-session',
    turnId,
    timestamp: new Date().toISOString(),
    seq,
    userMessage,
    systemPromptSections: [],
    model: 'glm-5',
    adapterKind: 'claude-sdk',
    permissionMode: 'claude-plan',
    toolCount: 12,
  }
}

// We test the summarization logic without DB by directly testing the core functions.
// Since the function needs EventRepository and SparkDatabase, we test the internal
// logic via the exported buildConversationHistoryWithSummary.

describe('ConversationSummarizer', () => {
  describe('buildConversationHistoryWithSummary', () => {
    it('returns undefined when no events exist', () => {
      // With a mock event repo that returns empty results
      const mockEventRepo = {
        queryBySession: () => ({ events: [] }),
        queryDialogueEvents: () => [],
      } as any
      const mockDb = {
        raw: {
          prepare: () => ({ get: () => null, run: () => {} }),
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 0)
      expect(result.prompt).toBeUndefined()
      expect(result.summarization).toBeUndefined()
    })

    it('aggregates multi-segment assistant text and ignores delta rows', () => {
      // 一个 turn 内被工具分隔的两段正文（各自一个 segmentId 的 complete），
      // 外加一条 isFinal result（无 segmentId）。delta 行由 dialogueRows 过滤掉，
      // 模拟 SQL 层排除。期望历史保留两段而非只剩最后一段。
      const seg1 = assistantMsg('t1', 'first analysis paragraph', 2, false)
      ;(seg1 as { segmentId?: string }).segmentId = 'seg-1'
      const seg2 = assistantMsg('t1', 'second conclusion paragraph', 4, false)
      ;(seg2 as { segmentId?: string }).segmentId = 'seg-2'
      const finalResult = assistantMsg('t1', 'second conclusion paragraph', 5, true)
      const deltaRow = {
        ...assistantMsg('t1', 'noise-delta', 3, false),
        mode: 'delta',
      } as AgentEvent

      const events: AgentEvent[] = [
        userMsg('t1', 'analyze and conclude', 1),
        seg1,
        deltaRow,
        seg2,
        finalResult,
      ]

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: { prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }) },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 5)
      expect(result.prompt).toContain('first analysis paragraph')
      expect(result.prompt).toContain('second conclusion paragraph')
      // delta 噪声不得进入历史
      expect(result.prompt).not.toContain('noise-delta')
      // 最终 result 与第二段重复，不应出现两次「second conclusion paragraph」
      const occurrences = result.prompt!.split('second conclusion paragraph').length - 1
      expect(occurrences).toBe(1)
    })

    it('produces a plain prompt for short conversations (below threshold)', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'Hello, help me with something', 1),
        assistantMsg('t1', 'Sure, I can help!', 2),
        userMsg('t2', 'Fix the bug in parser', 3),
        assistantMsg('t2', 'Fixed the parser bug by updating the regex.', 4),
      ]

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: {
          prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }),
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 4)
      expect(result.prompt).toContain('[Session History]')
      expect(result.prompt).toContain('Fix the bug in parser')
      expect(result.summarization).toBeUndefined()
    })

    it('preserves attachment ledger from turn snapshots during history recovery', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'Use the attached report to make a deck', 1),
        promptSnapshot(
          't1',
          'Use the attached report to make a deck\n\nAttachments:\n1. file: 第二季度工作述职报告.docx (/tmp/第二季度工作述职报告.docx)',
          2,
        ),
        assistantMsg('t1', 'I extracted the document and started the PPT flow.', 3),
      ]

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: {
          prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }),
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 3)
      expect(result.prompt).toContain('Attachments:')
      expect(result.prompt).toContain('/tmp/第二季度工作述职报告.docx')
      expect(result.prompt).toContain('I extracted the document')
    })

    it('produces a summarized prompt for long conversations', () => {
      // Generate 40 turns with longer content to exceed thresholds
      const events: AgentEvent[] = []
      for (let i = 0; i < 40; i++) {
        events.push(userMsg(`t${i}`, `User message ${i}: Please help me implement feature ${i} in the codebase. I need to add a new module that handles data processing and validation.`, events.length + 1))
        events.push(assistantMsg(`t${i}`, `Assistant response ${i}: Done with task ${i}. I have updated file_${i}.ts with the new implementation. Created a new file called module_${i}.ts. Fixed the validation logic. Added comprehensive tests for the new feature.`, events.length + 1))
      }

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: {
          prepare: (sql: string) => {
            if (sql.includes('ORDER BY')) {
              return { get: () => null }
            }
            return { get: () => null, run: () => ({ changes: 1 }) }
          },
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 80)
      expect(result.prompt).toContain('[Session History — Earlier Summary]')
      expect(result.prompt).toContain('[Recent Exchanges]')
      expect(result.summarization).toBeDefined()
      expect(result.summarization!.summarizedEntryCount).toBeGreaterThan(0)
    })

    it('uses cached summary when available', () => {
      // Generate 25 turns
      const events: AgentEvent[] = []
      for (let i = 0; i < 25; i++) {
        events.push(userMsg(`t${i}`, `User message ${i}`, events.length + 1))
        events.push(assistantMsg(`t${i}`, `Assistant response ${i}`, events.length + 1))
      }

      const cachedSummary = {
        id: 'summary-1',
        session_id: 's1',
        summary_turn_id: 'summary-50',
        summary_text: 'Cached summary of earlier work.',
        summarized_entry_count: 20,
        summarized_from_seq: 0,
        summarized_to_seq: 40,
        estimated_tokens: 100,
        model_id: null,
        created_at: new Date().toISOString(),
      }

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: {
          prepare: (sql: string) => {
            if (sql.includes('ORDER BY')) {
              return { get: () => cachedSummary }
            }
            return { get: () => null, run: () => ({ changes: 0 }) }
          },
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 50)
      expect(result.prompt).toContain('Cached summary of earlier work.')
      expect(result.prompt).toContain('[Recent Exchanges]')
      // No new summarization when using cache
      expect(result.summarization).toBeUndefined()
    })

    it('keeps dialogue history even when many tool events are newer', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'Important original requirement: keep audit logs visible.', 1),
        assistantMsg('t1', 'Confirmed. Updated audit log rendering.', 2),
      ]
      for (let i = 0; i < 400; i++) {
        events.push({
          type: 'tool_call',
          id: `tool-${i}`,
          sessionId: 'test-session',
          turnId: 'tool-turn',
          timestamp: new Date().toISOString(),
          seq: 3 + i,
          toolCallId: `tc-${i}`,
          toolName: 'Read',
          toolInput: { file: `file-${i}.ts` },
          source: 'builtin',
        })
      }
      events.push(userMsg('t2', 'What was the original requirement?', 500))

      const mockEventRepo = {
        queryBySession: (params: { eventType?: string }) => ({ events: mockRows(events, params.eventType) }),
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const mockDb = {
        raw: {
          prepare: () => ({ get: () => null, run: () => ({ changes: 0 }) }),
        },
      } as any

      const result = buildConversationHistoryWithSummary(mockEventRepo, mockDb, 's1', 500)
      expect(result.prompt).toContain('Important original requirement')
      expect(result.prompt).toContain('What was the original requirement?')
    })
  })

})

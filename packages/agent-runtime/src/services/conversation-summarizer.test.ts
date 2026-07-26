/**
 * Conversation history recovery tests.
 */

import { describe, it, expect } from 'vitest'
import { buildConversationHistory } from './conversation-summarizer.js'
import type { AgentEvent } from '@spark/protocol'

function mockRows(
  events: AgentEvent[],
  eventType?: string,
): Array<{ event_json: string; id: string }> {
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

describe('ConversationHistory', () => {
  describe('buildConversationHistory', () => {
    it('returns undefined when no events exist', () => {
      const mockEventRepo = {
        queryDialogueEvents: () => [],
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1')
      expect(result.prompt).toBeUndefined()
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
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1')
      expect(result.prompt).toContain('first analysis paragraph')
      expect(result.prompt).toContain('second conclusion paragraph')
      // delta 噪声不得进入历史
      expect(result.prompt).not.toContain('noise-delta')
      // 最终 result 与第二段重复，不应出现两次「second conclusion paragraph」
      const occurrences = result.prompt!.split('second conclusion paragraph').length - 1
      expect(occurrences).toBe(1)
    })

    it('produces a plain prompt without a Spark-generated summary', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'Hello, help me with something', 1),
        assistantMsg('t1', 'Sure, I can help!', 2),
        userMsg('t2', 'Fix the bug in parser', 3),
        assistantMsg('t2', 'Fixed the parser bug by updating the regex.', 4),
      ]

      const mockEventRepo = {
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1')
      expect(result.prompt).toContain('[Session History]')
      expect(result.prompt).toContain('Fix the bug in parser')
      expect(result.prompt).not.toContain('Earlier Summary')
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
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1')
      expect(result.prompt).toContain('Attachments:')
      expect(result.prompt).toContain('/tmp/第二季度工作述职报告.docx')
      expect(result.prompt).toContain('I extracted the document')
    })

    it('uses a larger supplied history budget for long conversations', () => {
      const events: AgentEvent[] = []
      for (let i = 0; i < 40; i++) {
        events.push(
          userMsg(
            `t${i}`,
            `User message ${i}: Please help me implement feature ${i} in the codebase. I need to add a new module that handles data processing and validation.`,
            events.length + 1,
          ),
        )
        events.push(
          assistantMsg(
            `t${i}`,
            `Assistant response ${i}: Done with task ${i}. I have updated file_${i}.ts with the new implementation. Created a new file called module_${i}.ts. Fixed the validation logic. Added comprehensive tests for the new feature.`,
            events.length + 1,
          ),
        )
      }

      const mockEventRepo = {
        queryDialogueEvents: () => dialogueRows(events),
      } as any
      const small = buildConversationHistory(mockEventRepo, 's1', { historyTokenBudget: 1_000 })
      const large = buildConversationHistory(mockEventRepo, 's1', { historyTokenBudget: 20_000 })
      expect(large.prompt!.length).toBeGreaterThan(small.prompt!.length)
      expect(large.prompt).toContain('User message 0')
      expect(large.prompt).not.toContain('Earlier Summary')
    })

    it('clips an oversized latest entry before applying the total budget', () => {
      const longContent = `START-${'x'.repeat(100_000)}-END`
      const events: AgentEvent[] = [userMsg('t1', longContent, 1)]
      const mockEventRepo = { queryDialogueEvents: () => dialogueRows(events) } as any

      const result = buildConversationHistory(mockEventRepo, 's1', {
        historyTokenBudget: 1_000,
        entryTokenBudget: 200,
      })
      expect(result.prompt).toContain('START-')
      expect(result.prompt).toContain('-END')
      expect(result.prompt).toContain('[truncated middle]')
    }, 15_000)

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
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1')
      expect(result.prompt).toContain('Important original requirement')
      expect(result.prompt).toContain('What was the original requirement?')
    })

    it('W1.1b: skipForSdkResume=true 时返回 recent fallback 而非 undefined（细致审查修正）', () => {
      // 场景：SDK resume 可用路径下，history builder 仍提供 recent entries 作为
      // fresh session fallback 兜底（防止 SDK 内部 resume 失败时 agent 失忆）。
      const events: AgentEvent[] = [userMsg('t1', 'Topic A requirement', 1)]
      for (let i = 0; i < 25; i++) {
        events.push(assistantMsg('t1', `Assistant response ${i} with details`, 100 + i))
        events.push(userMsg(`t${i + 2}`, `User follow-up ${i}`, 200 + i * 10))
      }

      const mockEventRepo = {
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1', {
        skipForSdkResume: true,
      })
      // 仍返回 prompt（recent fallback），不是 undefined
      expect(result.prompt).toBeDefined()
      expect(result.prompt).toContain('SDK resume fallback')
    })

    it('W1.1b: skipForSdkResume=true 且无对话事件时仍返回 undefined', () => {
      const mockEventRepo = {
        queryDialogueEvents: () => [],
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1', {
        skipForSdkResume: true,
      })
      expect(result.prompt).toBeUndefined()
    })

    it('combines a validated capsule with exact dialogue after its seq waterline', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'old requirement already summarized', 1),
        assistantMsg('t1', 'old result already summarized', 2),
        userMsg('t2', 'new exact requirement', 3),
        assistantMsg('t2', 'new exact result', 4),
      ]
      const mockEventRepo = {
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1', {
        continuitySummary: {
          summaryText: JSON.stringify({
            version: 1,
            objective: 'Keep the durable objective',
            constraints: [],
            decisions: [],
            completedWork: [],
            artifacts: [],
            openItems: [],
            risks: [],
            lastOutcome: '',
          }),
          summarizedToSeq: 2,
        },
      })

      expect(result.prompt).toContain('[Session Continuity Capsule]')
      expect(result.prompt).toContain('Keep the durable objective')
      expect(result.prompt).toContain('new exact requirement')
      expect(result.prompt).not.toContain('old requirement already summarized')
    })

    it('keeps recovery history on standby for native SDK resume', () => {
      const events: AgentEvent[] = [
        userMsg('t1', 'recover this requirement', 1),
        assistantMsg('t1', 'recover this outcome', 2),
      ]
      const mockEventRepo = {
        queryDialogueEvents: () => dialogueRows(events),
      } as any

      const result = buildConversationHistory(mockEventRepo, 's1', {
        deferForSdkResume: true,
      })

      expect(result.prompt).toBeUndefined()
      expect(result.recoveryPrompt).toContain('recover this requirement')
      expect(result.recoveryPrompt).toContain('recover this outcome')
    })
  })
})

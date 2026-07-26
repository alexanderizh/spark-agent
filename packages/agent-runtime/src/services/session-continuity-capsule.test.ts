import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import { parseStoredCapsule, updateSessionContinuityCapsule } from './session-continuity-capsule.js'

function dialogueEvents(count: number, startSeq = 1): AgentEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const seq = startSeq + index
    const turnId = `turn-${Math.floor(index / 2)}`
    if (index % 2 === 0) {
      return {
        id: `event-${seq}`,
        type: 'user_message',
        sessionId: 'session-1',
        turnId,
        timestamp: '2026-07-26T00:00:00.000Z',
        seq,
        content: `requirement ${seq}`,
      }
    }
    return {
      id: `event-${seq}`,
      type: 'assistant_message',
      sessionId: 'session-1',
      turnId,
      timestamp: '2026-07-26T00:00:00.000Z',
      seq,
      content: `completed work ${seq}`,
      mode: 'complete',
      provider: 'claude-sdk',
      isFinal: true,
    }
  }) as AgentEvent[]
}

function makeEventRepo(events: AgentEvent[]) {
  return {
    queryDialogueEvents: () => events.map((event) => ({ event_json: JSON.stringify(event) })),
    queryDialogueEventsAfterSeq: (_sessionId: string, afterSeq: number, limit: number) =>
      events
        .filter((event) => event.seq > afterSeq)
        .slice(0, limit)
        .map((event) => ({ event_json: JSON.stringify(event) })),
    countDialogueEventsAfterSeq: (_sessionId: string, afterSeq: number) =>
      events.filter((event) => event.seq > afterSeq).length,
  } as any
}

function validCapsule(objective = 'Ship context architecture') {
  return JSON.stringify({
    version: 1,
    objective,
    constraints: ['preserve exact history'],
    decisions: [],
    completedWork: [],
    artifacts: [],
    openItems: ['add recovery tests'],
    risks: [],
    lastOutcome: '',
  })
}

describe('session continuity capsule', () => {
  it('does not summarize while only the exact recent reserve exists', async () => {
    const complete = vi.fn()
    const result = await updateSessionContinuityCapsule({
      eventRepo: makeEventRepo(dialogueEvents(24)),
      summaryRepo: { getLatest: () => null, create: vi.fn() } as any,
      sessionId: 'session-1',
      turnId: 'turn-current',
      modelId: 'claude-test',
      complete,
    })

    expect(result).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it('persists a validated capsule and advances only the processed waterline', async () => {
    const create = vi.fn((params) => ({
      id: params.id,
      session_id: params.sessionId,
      summary_turn_id: params.summaryTurnId,
      summary_text: params.summaryText,
      summarized_entry_count: params.summarizedEntryCount,
      summarized_from_seq: params.summarizedFromSeq,
      summarized_to_seq: params.summarizedToSeq,
      estimated_tokens: params.estimatedTokens,
      model_id: params.modelId ?? null,
      created_at: '2026-07-26T00:00:00.000Z',
    }))
    const result = await updateSessionContinuityCapsule({
      eventRepo: makeEventRepo(dialogueEvents(40)),
      summaryRepo: { getLatest: () => null, create } as any,
      sessionId: 'session-1',
      turnId: 'turn-current',
      modelId: 'claude-test',
      complete: async () => ({ available: true, text: validCapsule() }),
    })

    expect(result?.toSeq).toBe(16)
    expect(result?.summarizedEntryCount).toBe(16)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        summarizedFromSeq: 1,
        summarizedToSeq: 16,
        modelId: 'claude-test',
      }),
    )
  })

  it('keeps the previous waterline when model output is invalid', async () => {
    const create = vi.fn()
    const result = await updateSessionContinuityCapsule({
      eventRepo: makeEventRepo(dialogueEvents(40)),
      summaryRepo: { getLatest: () => null, create } as any,
      sessionId: 'session-1',
      turnId: 'turn-current',
      complete: async () => ({ available: true, text: 'not json' }),
    })

    expect(result).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('discards a legacy free-form summary and rebuilds from the earliest dialogue', async () => {
    const deleteBySession = vi.fn()
    const create = vi.fn((params) => ({
      id: params.id,
      session_id: params.sessionId,
      summary_turn_id: params.summaryTurnId,
      summary_text: params.summaryText,
      summarized_entry_count: params.summarizedEntryCount,
      summarized_from_seq: params.summarizedFromSeq,
      summarized_to_seq: params.summarizedToSeq,
      estimated_tokens: params.estimatedTokens,
      model_id: null,
      created_at: '2026-07-26T00:00:00.000Z',
    }))
    const events = dialogueEvents(40)
    const result = await updateSessionContinuityCapsule({
      eventRepo: makeEventRepo(events),
      summaryRepo: {
        getLatest: () => ({
          summary_text: 'Topics discussed: legacy text',
          summarized_to_seq: 30,
          summarized_entry_count: 30,
          summarized_from_seq: 1,
          estimated_tokens: 50,
        }),
        deleteBySession,
        create,
      } as any,
      sessionId: 'session-1',
      turnId: 'turn-current',
      complete: async () => ({ available: true, text: validCapsule() }),
    })

    expect(deleteBySession).toHaveBeenCalledWith('session-1')
    expect(result?.fromSeq).toBe(1)
    expect(result?.toSeq).toBe(16)
  })

  it('normalizes fenced JSON, unknown fields, duplicate and oversized items', () => {
    const capsule = parseStoredCapsule(
      `\`\`\`json\n${JSON.stringify({
        version: 1,
        objective: 'Keep the session continuous',
        constraints: ['same', 'same', 'x'.repeat(2_000)],
        decisions: [],
        completedWork: [],
        artifacts: [],
        openItems: [],
        risks: [],
        lastOutcome: '',
        unknown: 'discard me',
      })}\n\`\`\``,
    )

    expect(capsule).toMatchObject({
      version: 1,
      objective: 'Keep the session continuous',
      decisions: [],
    })
    expect(capsule?.constraints).toHaveLength(2)
    expect(JSON.stringify(capsule)).not.toContain('unknown')
  })

  it('rejects unsupported versions and incomplete schemas', () => {
    expect(parseStoredCapsule(JSON.stringify({ version: 99 }))).toBeNull()
    expect(
      parseStoredCapsule(JSON.stringify({ version: 1, objective: 'missing fields' })),
    ).toBeNull()
  })
})

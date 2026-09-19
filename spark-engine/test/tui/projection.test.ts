import { describe, expect, it } from 'vitest'

import { projectTranscript } from '../../src/tui/projection.js'
import type { AgentEvent } from '../../src/events/schema.js'

const CAPABILITIES = { color: 'mono', unicode: false, width: 120 } as const

let nextSeq = 1

function turnStarted(turnId: string, text: string): AgentEvent {
  return {
    schemaVersion: 1,
    sessionId: 's1',
    seq: nextSeq++,
    ts: nextSeq,
    type: 'turn.started',
    turnId,
    input: { kind: 'text', text },
  }
}

function slimEvent(callIds: readonly string[], savedTokens: number): AgentEvent {
  return {
    schemaVersion: 1,
    sessionId: 's1',
    seq: nextSeq++,
    ts: nextSeq,
    type: 'context.tool_results_slimmed',
    slimmed: callIds.map((callId) => ({
      callId,
      fullRef: {
        sha256: 'a'.repeat(64),
        bytes: 10,
        mediaType: 'text/plain',
        summary: 'out',
        readHint: 'artifact',
      },
      slimmedContent: 'stub',
      savedTokens,
    })),
  }
}

function slimRows(events: readonly AgentEvent[]): { key: string; text: string }[] {
  return projectTranscript([...events], CAPABILITIES)
    .settled.filter((row) => row.text.includes('已瘦身'))
    .map((row) => ({ key: row.key, text: row.text }))
}

describe('tool-results-slimmed transcript rows', () => {
  it('folds every batch of one turn into a single row with cumulative totals', () => {
    const rows = slimRows([
      turnStarted('t1', 'work'),
      slimEvent(['c1', 'c2'], 193),
      slimEvent(['c3'], 100),
      slimEvent(['c4', 'c5'], 93),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('slim-t1')
    expect(rows[0]?.text).toBe('⇲ 5 个工具结果已瘦身 · 完整输出已存档 · 每步约省 672 tokens')
  })

  it('keeps one row per turn across multiple turns', () => {
    const rows = slimRows([
      turnStarted('t1', 'work'),
      slimEvent(['c1'], 100),
      turnStarted('t2', 'more'),
      slimEvent(['c2'], 50),
      slimEvent(['c3'], 60),
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]?.key).toBe('slim-t1')
    expect(rows[0]?.text).toContain('1 个工具结果已瘦身')
    expect(rows[0]?.text).toContain('100 tokens')
    expect(rows[1]?.key).toBe('slim-t2')
    expect(rows[1]?.text).toContain('2 个工具结果已瘦身')
    expect(rows[1]?.text).toContain('110 tokens')
  })

  it('aggregates stray batches that replay without a turn boundary', () => {
    const rows = slimRows([slimEvent(['c1'], 10), slimEvent(['c2'], 20)])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.key).toBe('slim-unknown')
    expect(rows[0]?.text).toContain('2 个工具结果已瘦身')
  })
})

describe('turn-boundary-rejected transcript row', () => {
  it('renders a warn row and keeps the turn active for the retry', () => {
    const rejection: AgentEvent = {
      schemaVersion: 1,
      sessionId: 's1',
      seq: nextSeq++,
      ts: nextSeq,
      type: 'turn.boundary_rejected',
      turnId: 't1',
      reason: 'process_unobserved',
      message: 'Cannot finish with unobserved managed commands.',
      processIds: ['p1', 'p2'],
    }
    const projection = projectTranscript([turnStarted('t1', 'work'), rejection], CAPABILITIES)
    const row = projection.settled.find((row) => row.text.includes('未观测的后台命令'))
    expect(row?.tone).toBe('warn')
    expect(row?.text).toContain('2')
  })
})

import { describe, expect, it } from 'vitest'

import { describeContextBreakdown } from '../../src/llm/budget.js'
import type { IrMessage } from '../../src/llm/types.js'

const message = (content: string): IrMessage => ({ role: 'user', content, sourceSeqs: [0] })

describe('describeContextBreakdown', () => {
  it('accounts per system section, per tool, and per message role', () => {
    const breakdown = describeContextBreakdown({
      system: [
        { id: 'kernel', content: 'a'.repeat(300), stability: 'stable' },
        { id: 'runtime', content: 'b'.repeat(150), stability: 'volatile' },
      ],
      messages: [
        message('c'.repeat(300)),
        { role: 'assistant', content: 'd'.repeat(90), toolCalls: [], sourceSeqs: [1] },
        {
          role: 'tool_result',
          callId: 'c1',
          tool: 'read',
          ok: true,
          content: 'e'.repeat(600),
          sourceSeqs: [2, 3],
        },
      ],
      tools: [
        {
          name: 'read',
          description: 'f'.repeat(120),
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        },
      ],
    })

    expect(breakdown.system.map((line) => line.label)).toEqual(['kernel', 'runtime'])
    expect(breakdown.tools.map((line) => line.label)).toEqual(['read'])
    // The parts reconcile with the total.
    expect(breakdown.systemTokens + breakdown.toolsTokens + breakdown.messagesTokens).toBe(
      breakdown.total,
    )
    expect(breakdown.toolResultTokens).toBeGreaterThan(breakdown.assistantTokens)
  })

  it('reports zero totals for an empty context', () => {
    const breakdown = describeContextBreakdown({ system: [], messages: [], tools: [] })
    expect(breakdown.total).toBe(0)
    expect(breakdown.messagesTokens).toBe(0)
  })
})

import type { AgentEvent } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { measureDeclaredToolSchemas, TurnRuntimeMetricsTracker } from './turn-runtime-metrics.js'

describe('TurnRuntimeMetricsTracker', () => {
  it('measures request-to-MCP and first-output latency once, then forwards usage snapshots', () => {
    const emit = vi.fn()
    const ticks = [100, 140, 180, 220]
    const scheduled: Array<() => void> = []
    const tracker = new TurnRuntimeMetricsTracker({
      emit,
      now: () => ticks.shift() ?? 220,
      schedule: (task) => scheduled.push(task),
    })

    tracker.markRequestSent()
    tracker.observe(
      event({
        type: 'agent_status',
        status: 'thinking',
        runtimeInitialization: { availableToolCount: 18, mcpServerCount: 3 },
      }),
    )
    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'H', isFinal: false }),
    )
    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'i', isFinal: false }),
    )
    tracker.observe(
      event({
        type: 'usage_update',
        provider: 'claude',
        model: 'test',
        inputTokens: 120,
        outputTokens: 2,
        cacheHitTokens: 80,
        cacheWriteTokens: 10,
      }),
    )

    expect(emit).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      availableToolCount: 18,
      mcpServerCount: 3,
      requestToMcpReadyMs: 40,
      requestToFirstOutputMs: 80,
      firstOutputKind: 'delta',
      providerInputTokens: 120,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
    })
  })

  it('adds only active MCP configuration spans instead of unrelated turn setup time', () => {
    const emit = vi.fn()
    const ticks = [100, 140, 200, 260]
    const scheduled: Array<() => void> = []
    const tracker = new TurnRuntimeMetricsTracker({
      emit,
      now: () => ticks.shift() ?? 260,
      schedule: (task) => scheduled.push(task),
    })

    tracker.markMcpConfigurationStarted()
    tracker.pauseMcpConfiguration()
    tracker.markMcpConfigurationStarted()
    tracker.recordPromptEstimate(3210)
    tracker.recordMcpConfiguration(
      ['known'],
      [
        {
          serverName: 'known',
          tools: [
            {
              name: 'search',
              description: 'Search data',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
      ],
    )

    expect(emit).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(0)

    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'H', isFinal: false }),
    )
    expect(scheduled).toHaveLength(2)
    expect(emit).not.toHaveBeenCalled()

    scheduled[0]?.()
    scheduled[1]?.()
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      sparkPromptEstimatedTokens: 3210,
      mcpServerCount: 1,
      mcpConfigurationMs: 100,
      toolSchemas: {
        declared: expect.objectContaining({
          serverCount: 1,
          measuredServerCount: 1,
          toolCount: 1,
          coverage: 'complete',
        }),
      },
    })
  })
})

describe('measureDeclaredToolSchemas', () => {
  it('reports partial coverage without treating unknown schemas as zero', () => {
    const result = measureDeclaredToolSchemas(
      ['known', 'unknown'],
      [
        {
          serverName: 'known',
          tools: [
            {
              name: 'search',
              description: 'Search data',
              inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
            },
          ],
        },
      ],
    )

    expect(result).toMatchObject({
      serverCount: 2,
      measuredServerCount: 1,
      toolCount: 1,
      coverage: 'partial',
    })
    expect(result.estimatedTokens).toBeGreaterThan(0)
  })

  it('omits token and tool counts when no schema can be observed', () => {
    expect(measureDeclaredToolSchemas(['unknown'], [])).toEqual({
      serverCount: 1,
      measuredServerCount: 0,
      coverage: 'unavailable',
    })
  })
})

function event(value: { type: AgentEvent['type'] } & Record<string, unknown>): AgentEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-08-18T00:00:00.000Z',
    seq: 0,
    ...value,
  } as AgentEvent
}

import type { AgentEvent } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { measureDeclaredToolSchemas, TurnRuntimeMetricsTracker } from './turn-runtime-metrics.js'

describe('TurnRuntimeMetricsTracker', () => {
  it('measures request-to-MCP and first-output latency once, then forwards usage snapshots', () => {
    const emit = vi.fn()
    const ticks = [0, 100, 140, 180, 220]
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
      outputTokens: 2,
      streamActiveMs: 40,
      cacheReadTokens: 80,
      cacheWriteTokens: 10,
    })
  })

  it('adds only active MCP configuration spans instead of unrelated turn setup time', () => {
    const emit = vi.fn()
    const ticks = [0, 100, 140, 200, 260]
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

describe('TurnRuntimeMetricsTracker throughput', () => {
  it('computes output throughput at terminal, excluding tool execution spans', () => {
    const emit = vi.fn()
    const onFinalized = vi.fn()
    // 0=构造, 100=请求发出, 150=首输出(开窗), 350=tool_call(关窗: 200ms 流),
    // 900=第二段输出(开窗), 1000=usage_update(关窗: 100ms 流), 1100=终态
    const ticks = [0, 100, 150, 350, 900, 1000, 1100]
    const scheduled: Array<() => void> = []
    const tracker = new TurnRuntimeMetricsTracker({
      emit,
      onFinalized,
      now: () => ticks.shift() ?? 1100,
      schedule: (task) => scheduled.push(task),
    })

    tracker.markRequestSent()
    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'answer', isFinal: false }),
    )
    tracker.observe(event({ type: 'tool_call', toolCallId: 't1', toolName: 'bash', toolInput: {} }))
    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'final', isFinal: true }),
    )
    tracker.observe(
      event({
        type: 'usage_update',
        provider: 'claude',
        model: 'test',
        inputTokens: 200,
        outputTokens: 60,
      }),
    )
    tracker.observe(event({ type: 'agent_status', status: 'completed' }))

    // 300ms 纯生成（200+100），60 token -> 200 tok/s；工具执行的 550ms 不计入。
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith({
      terminalStatus: 'completed',
      requestToFirstOutputMs: 50,
      streamActiveMs: 300,
      outputTokens: 60,
      outputTokensPerSecond: 200,
      turnDurationMs: 1100,
    })

    for (const task of scheduled) task()
    const finalEmit = emit.mock.calls.at(-1)?.[0]
    expect(finalEmit).toMatchObject({
      streamActiveMs: 300,
      outputTokens: 60,
      outputTokensPerSecond: 200,
      turnDurationMs: 1100,
      turnTerminalStatus: 'completed',
    })
  })

  it('omits throughput fields when the adapter never produced observable stream output', () => {
    const onFinalized = vi.fn()
    const ticks = [0, 200]
    const tracker = new TurnRuntimeMetricsTracker({
      emit: vi.fn(),
      onFinalized,
      now: () => ticks.shift() ?? 200,
      schedule: (task) => task(),
    })
    tracker.markRequestSent()
    tracker.observe(
      event({
        type: 'usage_update',
        provider: 'codex',
        model: 'test',
        inputTokens: 100,
        outputTokens: 40,
      }),
    )
    tracker.observe(event({ type: 'agent_status', status: 'completed' }))

    // 无流窗口 -> 不产出 streamActiveMs / 吞吐（只记可观测事实，不冒充 0）。
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith({
      terminalStatus: 'completed',
      outputTokens: 40,
      turnDurationMs: 200,
    })
  })

  it('finalizes only once and keeps cancelled turns distinguishable', () => {
    const onFinalized = vi.fn()
    const ticks = [0, 100, 300]
    const tracker = new TurnRuntimeMetricsTracker({
      emit: vi.fn(),
      onFinalized,
      now: () => ticks.shift() ?? 300,
      schedule: (task) => task(),
    })
    tracker.markRequestSent()
    tracker.observe(
      event({ type: 'assistant_message', mode: 'delta', content: 'x', isFinal: false }),
    )
    tracker.observe(event({ type: 'agent_status', status: 'cancelled' }))
    tracker.observe(event({ type: 'agent_status', status: 'error' }))

    expect(onFinalized).toHaveBeenCalledTimes(1)
    expect(onFinalized).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ terminalStatus: 'cancelled' }),
    )
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

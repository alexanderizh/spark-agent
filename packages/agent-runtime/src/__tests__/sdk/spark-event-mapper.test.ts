import { describe, expect, it } from 'vitest'

import type { AgentEvent as SparkAgentEvent, LlmDelta } from '@spark/agent'
import type { AgentEvent } from '@spark/protocol'

import { SparkEventMapper } from '../../sdk/spark-engine/event-mapper.js'

const OPTS = { sessionId: 'sess-1', turnId: 'turn-1', model: 'test-model' }

function makeMapper(): SparkEventMapper {
  return new SparkEventMapper(OPTS)
}

describe('SparkEventMapper', () => {
  it('text delta → assistant_message delta；complete 收口同段', () => {
    const mapper = makeMapper()
    const events: AgentEvent[] = []
    events.push(...mapper.mapDelta({ type: 'text', text: '你好' } as LlmDelta))
    // step.started 换段后再次 delta + complete
    events.push(...mapper.mapSparkEvent({ type: 'step.started' } as SparkAgentEvent))
    events.push(...mapper.mapDelta({ type: 'text', text: '第二段' } as LlmDelta))
    events.push(
      ...mapper.mapSparkEvent({
        type: 'assistant.completed',
        message: { text: '第二段完整', thinking: '' },
        usage: { inputTokens: 10, outputTokens: 5 },
      } as unknown as SparkAgentEvent),
    )

    const messages = events.filter((e) => e.type === 'assistant_message')
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ mode: 'delta', content: '你好' })
    // step.started 后的新段 delta 无 segmentId（属于尚未 complete 的段）或归属新段
    expect(messages[1]).toMatchObject({ mode: 'delta', content: '第二段' })
    expect(messages[2]).toMatchObject({ mode: 'complete', content: '第二段完整', isFinal: true })

    const thinking = events.filter((e) => e.type === 'agent_thinking')
    expect(thinking).toHaveLength(0) // thinking 空串不上抛

    const usage = events.filter((e) => e.type === 'usage_update')
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, provider: 'spark' })
  })

  it('thinking delta / complete 正常映射', () => {
    const mapper = makeMapper()
    const events = [
      ...mapper.mapDelta({ type: 'thinking', text: '思考中' } as LlmDelta),
      ...mapper.mapSparkEvent({
        type: 'assistant.completed',
        message: { text: '', thinking: '完整思考' },
        usage: { inputTokens: 1, outputTokens: 1 },
      } as unknown as SparkAgentEvent),
    ]
    const thinking = events.filter((e) => e.type === 'agent_thinking')
    expect(thinking[0]).toMatchObject({ mode: 'delta', content: '思考中' })
    expect(thinking[1]).toMatchObject({ mode: 'complete', content: '完整思考' })
  })

  it('tool.call → tool_call；tool.result 从记忆补齐工具名', () => {
    const mapper = makeMapper()
    const callEvents = mapper.mapSparkEvent({
      type: 'tool.call',
      callId: 'call-1',
      tool: 'read',
      args: { path: 'a.ts' },
    } as unknown as SparkAgentEvent)
    expect(callEvents).toHaveLength(1)
    expect(callEvents[0]).toMatchObject({
      type: 'tool_call',
      toolCallId: 'call-1',
      toolName: 'read',
      toolInput: { path: 'a.ts' },
    })

    const resultEvents = mapper.mapSparkEvent({
      type: 'tool.result',
      callId: 'call-1',
      ok: true,
      content: 'file body',
      durationMs: 12,
    } as unknown as SparkAgentEvent)
    expect(resultEvents[0]).toMatchObject({
      type: 'tool_result',
      toolCallId: 'call-1',
      toolName: 'read',
      status: 'success',
      output: 'file body',
      durationMs: 12,
    })

    // 未知 callId 的 result 工具名兜底 unknown
    const orphan = mapper.mapSparkEvent({
      type: 'tool.result',
      callId: 'call-x',
      ok: false,
      content: 'boom',
    } as unknown as SparkAgentEvent)
    expect(orphan[0]).toMatchObject({ toolName: 'unknown', status: 'error', error: 'boom' })
  })

  it('usage 逐步累计（工具循环多步 turn）', () => {
    const mapper = makeMapper()
    const completed = (inputTokens: number, outputTokens: number): SparkAgentEvent =>
      ({
        type: 'assistant.completed',
        message: { text: 'ok', thinking: '' },
        usage: { inputTokens, outputTokens, cacheReadTokens: 2, cacheWriteTokens: 3 },
      }) as unknown as SparkAgentEvent
    mapper.mapSparkEvent(completed(10, 5))
    const events = mapper.mapSparkEvent(completed(20, 7))
    const usage = events.filter((e) => e.type === 'usage_update')
    expect(usage[0]).toMatchObject({
      inputTokens: 30,
      outputTokens: 12,
      cacheHitTokens: 4,
      cacheWriteTokens: 6,
    })
  })

  it('终态事件：completed / cancelled / failed', () => {
    const mapper = makeMapper()
    expect(mapper.mapSparkEvent({ type: 'turn.completed' } as SparkAgentEvent)).toEqual([
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    ])
    expect(mapper.mapSparkEvent({ type: 'turn.cancelled' } as SparkAgentEvent)).toEqual([
      expect.objectContaining({ type: 'agent_status', status: 'cancelled' }),
    ])
    const failed = mapper.mapSparkEvent({
      type: 'turn.failed',
      error: { code: 'E_TEST', message: 'boom', retryable: true },
    } as unknown as SparkAgentEvent)
    expect(failed[0]).toMatchObject({
      type: 'agent_error',
      code: 'E_TEST',
      message: 'boom',
      retryable: true,
    })
    expect(failed[1]).toMatchObject({ type: 'agent_status', status: 'error' })
  })

  it('内部消化事件与噪音事件返回空数组', () => {
    const mapper = makeMapper()
    for (const event of [
      { type: 'permission.requested' },
      { type: 'permission.evaluated' },
      { type: 'permission.decided' },
      { type: 'log.rewind' },
      { type: 'session.started' },
      { type: 'turn.queued' },
      { type: 'user.answered' },
    ] as unknown as SparkAgentEvent[]) {
      expect(mapper.mapSparkEvent(event)).toEqual([])
    }
    // delta 侧噪音
    for (const delta of [
      { type: 'tool_call' },
      { type: 'usage' },
      { type: 'heartbeat' },
      { type: 'done' },
    ] as unknown as LlmDelta[]) {
      expect(mapper.mapDelta(delta)).toEqual([])
    }
  })
})

describe('SparkEventMapper M5：压缩与上下文计量', () => {
  it('context.compacted → context_compaction 压缩卡片事件', () => {
    const mapper = makeMapper()
    const events = mapper.mapSparkEvent({
      type: 'context.compacted',
      droppedRanges: [
        [1, 8],
        [20, 30],
      ],
    } as unknown as SparkAgentEvent)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'context_compaction',
      provider: 'spark',
      source: 'spark_engine',
      phase: 'completed',
      rawType: 'context.compacted',
    })
  })

  it('空 droppedRanges 的压缩事件仍有可读文案', () => {
    const mapper = makeMapper()
    const events = mapper.mapSparkEvent({
      type: 'context.compacted',
      droppedRanges: [],
    } as unknown as SparkAgentEvent)
    expect(events[0]).toMatchObject({
      type: 'context_compaction',
      message: '已压缩上下文',
    })
  })

  it('assistant.completed 附带步级 context_usage（input+cache 为真实上下文规模）', () => {
    const mapper = new SparkEventMapper({ ...OPTS, contextWindowTokens: 200_000 })
    mapper.mapSparkEvent({
      type: 'assistant.completed',
      message: { text: 'hi', thinking: '' },
      usage: { inputTokens: 1_000, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 100 },
    } as unknown as SparkAgentEvent)

    const contextUsage = mapper
      .mapSparkEvent({
        type: 'assistant.completed',
        message: { text: '', thinking: '' },
        usage: { inputTokens: 2_000, outputTokens: 10 },
      } as unknown as SparkAgentEvent)
      .filter((event) => event.type === 'context_usage')
    expect(contextUsage).toHaveLength(1)
    expect(contextUsage[0]).toMatchObject({
      type: 'context_usage',
      estimatedTokens: 2_000,
      contextWindowTokens: 200_000,
      compacted: false,
    })
    // softLimit 与共享窗口策略一致（70%）
    if (contextUsage[0]?.type === 'context_usage') {
      expect(contextUsage[0].softLimitTokens).toBe(140_000)
    }
  })

  it('未配置窗口时按 256k 兜底展示', () => {
    const mapper = makeMapper()
    const events = mapper.mapSparkEvent({
      type: 'assistant.completed',
      message: { text: '', thinking: '' },
      usage: { inputTokens: 5, outputTokens: 1 },
    } as unknown as SparkAgentEvent)
    const contextUsage = events.find((event) => event.type === 'context_usage')
    expect(contextUsage).toMatchObject({ contextWindowTokens: 256_000 })
  })
})

describe('SparkEventMapper 自动重试可见性与段复位', () => {
  const retryDelta = (overrides: Partial<Extract<LlmDelta, { type: 'retry' }>> = {}): LlmDelta =>
    ({
      type: 'retry',
      routeId: 'primary',
      attempt: 1,
      maxRetries: 10,
      delayMs: 2_000,
      resetOutput: false,
      error: { code: 'llm.transport_error', message: 'connection reset' },
      ...overrides,
    }) as LlmDelta

  it('retry delta → runtime_signal(stream_reconnect)（含进度与失败原因）', () => {
    const mapper = makeMapper()
    const events = mapper.mapDelta(retryDelta({ attempt: 3, delayMs: 500 }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'runtime_signal',
      signal: 'stream_reconnect',
      level: 'info',
      code: 'SPARK_LLM_RETRY',
      retryable: false,
      details: [
        { label: '重试进度', value: '3/10' },
        { label: '本次等待', value: '500ms' },
        { label: '失败原因', value: 'llm.transport_error' },
      ],
    })
    // 过程信号不产生终态，也不会被渲染成失败卡片。
    expect(events.some((event) => event.type === 'agent_status')).toBe(false)
  })

  it('resetOutput=true 时先复位失败尝试的正文与思考段，再给重试提示', () => {
    const mapper = makeMapper()
    mapper.mapSparkEvent({ type: 'step.started' } as SparkAgentEvent)
    const streamed = mapper.mapDelta({ type: 'text', text: '半截正文' } as LlmDelta)[0] as {
      segmentId?: string
    }
    mapper.mapDelta({ type: 'thinking', text: '半截推理' } as LlmDelta)

    const events = mapper.mapDelta(retryDelta({ resetOutput: true }))

    expect(events).toHaveLength(3)
    // 复位事件必须沿用失败尝试那一段的 segmentId，渲染层才会就地覆盖该段内容。
    expect(events[0]).toMatchObject({
      type: 'assistant_message',
      mode: 'complete',
      content: '',
      segmentId: streamed.segmentId,
    })
    expect(events[1]).toMatchObject({
      type: 'agent_thinking',
      mode: 'complete',
      content: '',
      segmentId: streamed.segmentId,
    })
    expect(events[2]).toMatchObject({ type: 'runtime_signal', signal: 'stream_reconnect' })
  })

  it('resetOutput=false（无可丢弃输出）时不发复位事件', () => {
    const mapper = makeMapper()
    mapper.mapSparkEvent({ type: 'step.started' } as SparkAgentEvent)

    const events = mapper.mapDelta(retryDelta({ resetOutput: false }))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'runtime_signal', signal: 'stream_reconnect' })
  })

  it('复位后重放正文从空串重新累积，不会被判定为重复发送复位', () => {
    const mapper = makeMapper()
    mapper.mapSparkEvent({ type: 'step.started' } as SparkAgentEvent)
    mapper.mapDelta({ type: 'text', text: '失败的正文' } as LlmDelta)
    mapper.mapDelta(retryDelta({ resetOutput: true }))
    // 复位标记只对「本次尝试」有效：重放期间没有新正文时不应重复发复位事件。
    const second = mapper.mapDelta(retryDelta({ attempt: 2, resetOutput: true }))
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ type: 'runtime_signal' })
    // 重放的正文照常映射为 delta。
    expect(mapper.mapDelta({ type: 'text', text: '重放正文' } as LlmDelta)[0]).toMatchObject({
      type: 'assistant_message',
      mode: 'delta',
      content: '重放正文',
    })
  })
})

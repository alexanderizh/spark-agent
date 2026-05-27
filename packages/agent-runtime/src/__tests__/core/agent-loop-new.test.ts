/**
 * Tests for new agent-loop logic introduced in PR2-5 and PR3-4/5:
 *   - exit_plan_mode 触发 plan_proposed + 结束 turn
 *   - context_usage 事件每轮发一次
 *   - compactMessagesIfNeeded 在超阈值时裁剪 tool_result
 *   - getDefinitions(permissionMode) 只在 claude-plan 模式注入 exit_plan_mode
 */
import { describe, it, expect } from 'vitest'
import { AgentLoop } from '../../core/agent-loop.js'
import { ToolRegistry } from '../../core/tool-registry.js'
import type { IModelAdapter, ChatParams } from '../../adapters/types.js'
import type { AgentEvent } from '@spark/protocol'

const BASE = { id: 'e1', sessionId: 's1', turnId: 't1', timestamp: new Date().toISOString(), seq: 0, provider: 'mock' as const }

function makeAdapter(eventsByCall: AgentEvent[][]): { adapter: IModelAdapter; getCallCount: () => number; getLastParams: () => ChatParams | null } {
  let callCount = 0
  let lastParams: ChatParams | null = null
  const adapter: IModelAdapter = {
    provider: 'mock',
    async *streamChat(params) {
      lastParams = params
      const events = eventsByCall[callCount] ?? eventsByCall[eventsByCall.length - 1] ?? []
      callCount += 1
      for (const e of events) yield e
    },
  }
  return { adapter, getCallCount: () => callCount, getLastParams: () => lastParams }
}

describe('AgentLoop — exit_plan_mode', () => {
  it('triggers plan_proposed and ends turn immediately', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    const { adapter, getCallCount } = makeAdapter([
      [
        { ...BASE, type: 'tool_call', toolCallId: 'tc1', toolName: 'exit_plan_mode',
          toolInput: { plan: '1. Read X\n2. Edit Y' }, source: 'builtin' },
      ],
      // If the loop wrongly continues, it would call us a second time; we'd notice via getCallCount
      [
        { ...BASE, type: 'assistant_message', mode: 'complete', content: 'should not get here', isFinal: true },
      ],
    ])

    await loop.executeTurn('s1', 't1', 'plan it', {
      adapter,
      apiKey: 'k',
      model: 'claude-opus-4',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
      permissionMode: 'claude-plan',
    })

    // Turn should end after exit_plan_mode — adapter called exactly once
    expect(getCallCount()).toBe(1)

    const types = collected.map((e) => e.type)
    expect(types).toContain('plan_proposed')

    const planEvent = collected.find((e) => e.type === 'plan_proposed') as { plan: string }
    expect(planEvent.plan).toContain('Read X')

    const statuses = collected.filter((e) => e.type === 'agent_status').map((e) => (e as { status: string }).status)
    expect(statuses).toContain('completed')
  })

  it('exit_plan_mode is exposed to the model ONLY in claude-plan permission mode', async () => {
    const loop = new AgentLoop()
    const { adapter, getLastParams } = makeAdapter([
      [{ ...BASE, type: 'assistant_message', mode: 'complete', content: 'ok', isFinal: true }],
    ])

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'k',
      model: 'claude-opus-4',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
      permissionMode: 'claude-auto-edits',
    })

    const tools = getLastParams()?.tools ?? []
    expect(tools.find((t) => t.name === 'exit_plan_mode')).toBeUndefined()
  })

  it('exit_plan_mode IS exposed in claude-plan mode', async () => {
    const loop = new AgentLoop()
    const { adapter, getLastParams } = makeAdapter([
      [{ ...BASE, type: 'assistant_message', mode: 'complete', content: 'ok', isFinal: true }],
    ])

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'k',
      model: 'claude-opus-4',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
      permissionMode: 'claude-plan',
    })

    const tools = getLastParams()?.tools ?? []
    expect(tools.find((t) => t.name === 'exit_plan_mode')).toBeDefined()
  })
})

describe('AgentLoop — context_usage emission', () => {
  it('emits context_usage every iteration before LLM call', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    let callCount = 0
    const adapter: IModelAdapter = {
      provider: 'mock',
      async *streamChat() {
        callCount += 1
        if (callCount === 1) {
          yield { ...BASE, type: 'tool_call', toolCallId: 'tc1', toolName: 'read_file',
            toolInput: { path: 'x.txt' }, source: 'builtin' }
        } else {
          yield { ...BASE, type: 'assistant_message', mode: 'complete', content: 'done', isFinal: true }
        }
      },
    }

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'k',
      model: 'claude-opus-4',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
    })

    // 2 iterations → 2 context_usage events
    const contextEvents = collected.filter((e) => e.type === 'context_usage')
    expect(contextEvents.length).toBe(2)
    const first = contextEvents[0] as { estimatedTokens: number; softLimitTokens: number; contextWindowTokens: number; compacted: boolean }
    expect(first.contextWindowTokens).toBe(200_000)  // claude
    expect(first.softLimitTokens).toBe(Math.floor(200_000 * 0.7))
    expect(first.estimatedTokens).toBeGreaterThanOrEqual(0)
    expect(first.compacted).toBe(false)  // small payload, no compaction
  })

  it('reports correct context window for non-claude models', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))
    const { adapter } = makeAdapter([
      [{ ...BASE, type: 'assistant_message', mode: 'complete', content: 'ok', isFinal: true }],
    ])

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'k',
      model: 'gpt-5-codex',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
    })
    const ctx = collected.find((e) => e.type === 'context_usage') as { contextWindowTokens: number } | undefined
    expect(ctx?.contextWindowTokens).toBe(400_000)
  })
})

describe('AgentLoop — context compaction', () => {
  it('compacts oldest tool_result content when over soft limit, emits compacted:true', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    // Build 7 tool_results, each ~50k chars, totaling ~350k chars ≈ 117k tokens.
    // Default model (no claude/gpt in name) → softLimit = 64k * 0.7 = ~45k tokens.
    // So we need a model below the threshold; use a non-matching name.
    const big = 'X'.repeat(50_000)
    const adapter: IModelAdapter = {
      provider: 'mock',
      async *streamChat(params) {
        // On the very first call (after compaction would run), check what messages look like.
        // We simply respond with a terminating assistant message.
        // capture params to assert later via collected events
        void params
        yield { ...BASE, type: 'assistant_message', mode: 'complete', content: 'done', isFinal: true }
      },
    }

    // Pre-build a history full of fat tool_results so the very first compaction check trips.
    // The agent loop reads `historyMessages` and prepends them.
    const fatHistory = [] as Array<{ role: 'assistant' | 'user'; content: Array<{ type: 'tool_use' | 'tool_result'; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string }> }>
    for (let i = 0; i < 7; i++) {
      fatHistory.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: `tc${i}`, name: 'read_file', input: { path: `f${i}.txt` } }],
      })
      fatHistory.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `tc${i}`, content: big }],
      })
    }

    await loop.executeTurn('s1', 't1', 'go', {
      adapter,
      apiKey: 'k',
      model: 'deepseek-chat',  // softLimit = 64000 * 0.7 ≈ 44_800 tokens (from ModelCapabilityRegistry)
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
    }, fatHistory as never)

    const ctx = collected.find((e) => e.type === 'context_usage') as { compacted: boolean; estimatedTokens: number; softLimitTokens: number } | undefined
    expect(ctx).toBeDefined()
    expect(ctx!.compacted).toBe(true)
    // Original 7 fat results ≈ 117k tokens; after compaction keep最近 4 个 → ≤ ~67k tokens.
    // 不要求降到软上限以下（保留最近 4 个是有意为之），仅验证显著下降。
    expect(ctx!.estimatedTokens).toBeLessThan(80_000)
  })

  it('does NOT compact when comfortably under the soft limit', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))
    const { adapter } = makeAdapter([
      [{ ...BASE, type: 'assistant_message', mode: 'complete', content: 'done', isFinal: true }],
    ])

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'k',
      model: 'claude-opus-4',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
    })
    const ctx = collected.find((e) => e.type === 'context_usage') as { compacted: boolean }
    expect(ctx.compacted).toBe(false)
  })
})

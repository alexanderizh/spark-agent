import { describe, it, expect, vi } from 'vitest'
import { AgentLoop } from '../../core/agent-loop.js'
import { ToolRegistry } from '../../core/tool-registry.js'
import type { IModelAdapter, ChatParams } from '../../adapters/types.js'
import type { AgentEvent } from '@spark/protocol'

function makeAdapter(events: AgentEvent[]): IModelAdapter {
  return {
    provider: 'mock',
    async *streamChat(_params: ChatParams, _sessionId: string, _turnId: string) {
      for (const e of events) yield e
    },
  }
}

const BASE = { id: 'e1', sessionId: 's1', turnId: 't1', timestamp: new Date().toISOString(), seq: 0, provider: 'mock' as const }

describe('AgentLoop', () => {
  it('simple text reply emits assistant_message + completed status', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    const adapter = makeAdapter([
      { ...BASE, type: 'assistant_message', mode: 'delta', content: 'Hello', isFinal: false },
      { ...BASE, type: 'assistant_message', mode: 'complete', content: 'Hello', isFinal: true },
    ])

    const registry = new ToolRegistry()
    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'key',
      model: 'model',
      tools: registry,
      toolContext: { workspaceRootPath: '/tmp' },
    })

    const types = collected.map((e) => e.type)
    expect(types).toContain('assistant_message')
    expect(types).toContain('agent_status')
    const statuses = collected.filter((e) => e.type === 'agent_status').map((e) => (e as { status: string }).status)
    expect(statuses).toContain('thinking')
    expect(statuses).toContain('completed')
  })

  it('tool call scenario: emits tool_call + tool_result then completes', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    let callCount = 0
    const adapter: IModelAdapter = {
      provider: 'mock',
      async *streamChat() {
        callCount++
        if (callCount === 1) {
          yield {
            ...BASE,
            type: 'tool_call' as const,
            toolCallId: 'tc1',
            toolName: 'read_file',
            toolInput: { path: '../etc/passwd' }, // will error (outside workspace)
            source: 'builtin' as const,
          }
        } else {
          yield { ...BASE, type: 'assistant_message' as const, mode: 'complete' as const, content: 'done', isFinal: true }
        }
      },
    }

    const registry = new ToolRegistry()
    await loop.executeTurn('s1', 't1', 'read file', {
      adapter,
      apiKey: 'key',
      model: 'model',
      tools: registry,
      toolContext: { workspaceRootPath: '/tmp' },
    })

    const types = collected.map((e) => e.type)
    expect(types).toContain('tool_call')
    expect(types).toContain('tool_result')
    expect(types).toContain('assistant_message')
    const statuses = collected.filter((e) => e.type === 'agent_status').map((e) => (e as { status: string }).status)
    expect(statuses).toContain('calling_tool')
    expect(statuses).toContain('completed')
  })

  it('cancel emits agent_error ABORTED + cancelled status', async () => {
    const loop = new AgentLoop()
    const collected: AgentEvent[] = []
    loop.onEvent((e) => collected.push(e))

    const adapter: IModelAdapter = {
      provider: 'mock',
      async *streamChat(_p, _s, _t, signal) {
        // simulate slow stream
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5000)
          signal?.addEventListener('abort', () => { clearTimeout(t); resolve() })
        })
      },
    }

    const registry = new ToolRegistry()
    const promise = loop.executeTurn('s1', 't1', 'slow', {
      adapter,
      apiKey: 'key',
      model: 'model',
      tools: registry,
      toolContext: { workspaceRootPath: '/tmp' },
    })

    // cancel immediately
    loop.cancel()
    await promise

    const types = collected.map((e) => e.type)
    expect(types).toContain('agent_error')
    const statuses = collected.filter((e) => e.type === 'agent_status').map((e) => (e as { status: string }).status)
    expect(statuses).toContain('cancelled')
  })

  it('agent_status sequence: thinking → completed for simple reply', async () => {
    const loop = new AgentLoop()
    const statuses: string[] = []
    loop.onEvent((e) => {
      if (e.type === 'agent_status') statuses.push((e as { status: string }).status)
    })

    const adapter = makeAdapter([
      { ...BASE, type: 'assistant_message', mode: 'complete', content: 'ok', isFinal: true },
    ])

    await loop.executeTurn('s1', 't1', 'hi', {
      adapter,
      apiKey: 'key',
      model: 'model',
      tools: new ToolRegistry(),
      toolContext: { workspaceRootPath: '/tmp' },
    })

    expect(statuses[0]).toBe('thinking')
    expect(statuses[statuses.length - 1]).toBe('completed')
  })
})

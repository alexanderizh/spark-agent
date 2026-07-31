import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseAgentBridge } from './ComputerUseAgentBridge.js'

const bridges: ComputerUseAgentBridge[] = []

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
})

describe('ComputerUseAgentBridge', () => {
  it('requires a per-session bearer token and never accepts the session id as authority', async () => {
    const invoke = vi.fn(async (sessionId: string, toolName: string, args: unknown) => ({
      sessionId,
      toolName,
      args,
    }))
    const bridge = new ComputerUseAgentBridge({ invoke })
    bridges.push(bridge)
    const binding = await bridge.issueSession('session-1')
    const url = `http://127.0.0.1:${binding.port}/invoke`

    const unauthorized = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session-1', toolName: 'get_capabilities', args: {} }),
    })
    expect(unauthorized.status).toBe(401)
    expect(invoke).not.toHaveBeenCalled()

    const authorized = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${binding.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sessionId: 'attacker-session',
        toolName: 'get_capabilities',
        args: {},
      }),
    })
    expect(authorized.status).toBe(200)
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      data: { sessionId: 'session-1', toolName: 'get_capabilities', args: {} },
    })
  })

  it('revokes the previous bearer token when the same Agent session starts a new turn', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const bridge = new ComputerUseAgentBridge({ invoke })
    bridges.push(bridge)
    const previous = await bridge.issueSession('session-1')
    const current = await bridge.issueSession('session-1')
    const url = `http://127.0.0.1:${current.port}/invoke`
    const body = JSON.stringify({ toolName: 'get_capabilities', args: {} })

    const stale = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${previous.token}`,
        'content-type': 'application/json',
      },
      body,
    })
    expect(stale.status).toBe(401)

    const active = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${current.token}`,
        'content-type': 'application/json',
      },
      body,
    })
    expect(active.status).toBe(200)
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown tools and oversized request bodies before dispatch', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const bridge = new ComputerUseAgentBridge({ invoke, maxBodyBytes: 128 })
    bridges.push(bridge)
    const binding = await bridge.issueSession('session-1')
    const headers = {
      authorization: `Bearer ${binding.token}`,
      'content-type': 'application/json',
    }

    const diagnostics = await fetch(`http://127.0.0.1:${binding.port}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolName: 'diagnose_native_host', args: {} }),
    })
    expect(diagnostics.status).toBe(200)
    invoke.mockClear()

    const unknown = await fetch(`http://127.0.0.1:${binding.port}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolName: 'click', args: {} }),
    })
    expect(unknown.status).toBe(400)

    const oversized = await fetch(`http://127.0.0.1:${binding.port}/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolName: 'get_capabilities', args: { value: 'x'.repeat(1_000) } }),
    })
    expect(oversized.status).toBe(413)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('serves a bearer-bound stateless MCP HTTP transport without spawning a Node subprocess', async () => {
    const invoke = vi.fn(async (sessionId: string, toolName: string) => ({ sessionId, toolName }))
    const bridge = new ComputerUseAgentBridge({ invoke })
    bridges.push(bridge)
    const binding = await bridge.issueSession('session-1')
    const headers = {
      authorization: `Bearer ${binding.token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    }
    const list = await fetch(`http://127.0.0.1:${binding.port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })

    expect(list.status).toBe(200)
    const listed = (await list.json()) as any
    expect(listed).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'get_capabilities' }),
          expect.objectContaining({ name: 'diagnose_native_host' }),
          expect.objectContaining({ name: 'start_task' }),
        ]),
      },
    })
    const startTask = listed.result.tools.find((tool: any) => tool.name === 'start_task')
    expect(startTask.description).toContain('successCriteria is optional')
    expect(startTask.description).toContain('"environment":"my_desktop"')
    expect(startTask.inputSchema.properties.environment.enum).toEqual(['my_desktop'])
    expect(startTask.inputSchema.properties.targetWindowId).toMatchObject({
      type: 'string',
      minLength: 1,
    })
    expect(startTask.inputSchema.required).toEqual(['goal', 'environment'])
    expect(startTask.inputSchema.properties.successCriteria.items).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ kind: { const: 'accessibility' } }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({ kind: { const: 'visual' } }),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({ kind: { const: 'application_state' } }),
        }),
      ]),
    })
    expect(startTask.inputSchema.properties.successCriteria.items).not.toEqual({ type: 'object' })

    const call = await fetch(`http://127.0.0.1:${binding.port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_capabilities', arguments: {} },
      }),
    })
    await expect(call.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: { structuredContent: { sessionId: 'session-1', toolName: 'get_capabilities' } },
    })
    expect(invoke).toHaveBeenCalledWith('session-1', 'get_capabilities', {})
  })
})

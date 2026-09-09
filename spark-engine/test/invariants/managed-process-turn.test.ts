import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeterministicEnv } from '../../src/env.js'
import { Agent } from '../../src/sdk/agent.js'
import { FakeModel } from '../../src/llm/fake/model.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { WorkspaceToolExecutor } from '../../src/tools/workspace/executor.js'
import { workspaceToolDefinitions } from '../../src/tools/workspace/definitions.js'
import { OrderedToolRegistry } from '../../src/tools/registry.js'
import type { LlmService } from '../../src/seams.js'
import { CompositeToolExecutor, McpToolManager } from '../../src/mcp/client.js'
import { collectEvents } from '../helpers.js'

// Shell fixture uses only a harmless wait; it must never survive turn teardown.
describe.skipIf(process.platform === 'win32')('managed process turn contract', () => {
  it.each([
    { wrapped: false, budget: false },
    { wrapped: true, budget: false },
    { wrapped: true, budget: true },
  ])('rejects an unobserved command and cleans its handle: %j', async ({ wrapped, budget }) => {
    const root = await mkdtemp(join(tmpdir(), 'spark-managed-turn-'))
    const base = createDeterministicEnv([
      toolCall('launch', 'bash', { command: 'sleep 30', yield_ms: 0 }),
      text('premature done'),
    ])
    const workspace = new WorkspaceToolExecutor(root)
    const mcp = await McpToolManager.connect({ cwd: root, servers: {} })
    const executor = wrapped ? new CompositeToolExecutor(workspace, mcp) : workspace
    const env = {
      ...base,
      tools: { registry: new OrderedToolRegistry(workspaceToolDefinitions), executor },
    }
    try {
      const session = await Agent.open({ cwd: root, env }).newSession({ permissionMode: 'auto' })
      const result = await session.turn('run', budget ? { budget: { maxSteps: 1 } } : {})
      expect(result.terminal).toMatchObject({
        type: 'turn.failed',
        error: { code: 'tool.process_unobserved' },
      })
      const events = await collectEvents(session)
      const launch = events.find((event) => event.type === 'tool.result')
      expect(launch?.type).toBe('tool.result')
      if (launch?.type !== 'tool.result') throw new Error('Missing launch result')
      const id = JSON.parse(launch.content) as {
        process_id: string
      }
      const definition = env.tools.registry.get('process_wait')
      if (!definition) throw new Error('Missing process_wait definition')
      await expect(
        executor.execute(
          {
            name: definition.name,
            callId: 'late',
            definition,
            args: { process_id: id.process_id },
          },
          {
            owner: { sessionId: session.sessionId, turnId: result.turnId },
            signal: new AbortController().signal,
            turnSignal: new AbortController().signal,
            timeoutMs: 100,
          },
        ),
      ).rejects.toMatchObject({ code: 'tool.process_not_found' })
    } finally {
      await mcp.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('denied bash cannot launch a managed process', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-managed-deny-'))
    const base = createDeterministicEnv(
      [toolCall('launch', 'bash', { command: 'touch forbidden', yield_ms: 0 }), text('denied')],
      { permissionRules: [{ id: 'no-shell', tool: 'bash', action: 'deny' }] },
    )
    const executor = new WorkspaceToolExecutor(root)
    const env = {
      ...base,
      tools: { registry: new OrderedToolRegistry(workspaceToolDefinitions), executor },
    }
    try {
      const session = await Agent.open({ cwd: root, env }).newSession({ permissionMode: 'auto' })
      await session.turn('run')
      await expect(stat(join(root, 'forbidden'))).rejects.toMatchObject({ code: 'ENOENT' })
      const events = await collectEvents(session)
      expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
        ok: false,
        content: expect.stringContaining('Permission denied'),
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('user cancellation reaps a command before the turn promise returns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-managed-cancel-'))
    const base = createDeterministicEnv([
      toolCall('launch', 'bash', { command: 'sleep 30', yield_ms: 0 }),
    ])
    const executor = new WorkspaceToolExecutor(root)
    const env = {
      ...base,
      tools: { registry: new OrderedToolRegistry(workspaceToolDefinitions), executor },
    }
    const controller = new AbortController()
    let id = ''
    try {
      const session = await Agent.open({ cwd: root, env }).newSession({ permissionMode: 'auto' })
      const result = await session.turn('run', {
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'tool.result') {
            id = (JSON.parse(event.content) as { process_id: string }).process_id
            controller.abort()
          }
        },
      })
      expect(result.terminal.type).toBe('turn.cancelled')
      const definition = env.tools.registry.get('process_wait')
      if (!definition) throw new Error('Missing process_wait')
      await expect(
        executor.execute(
          { name: 'process_wait', callId: 'late', definition, args: { process_id: id } },
          {
            owner: { sessionId: session.sessionId, turnId: result.turnId },
            signal: new AbortController().signal,
            turnSignal: new AbortController().signal,
            timeoutMs: 100,
          },
        ),
      ).rejects.toMatchObject({ code: 'tool.process_not_found' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('completes through start/wait without re-executing the command', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-managed-finish-'))
    const base = createDeterministicEnv([])
    let calls = 0
    const llm: LlmService = {
      stream(request, context) {
        calls += 1
        const last = request.messages.at(-1)
        const snapshot =
          last?.role === 'tool_result'
            ? (JSON.parse(last.content) as {
                status: string
                process_id: string
                next_cursor: number
                has_more: boolean
              })
            : undefined
        const reply =
          snapshot === undefined
            ? toolCall('launch', 'bash', { command: 'printf verified', yield_ms: 0 })
            : snapshot.status === 'running' || snapshot.has_more
              ? toolCall(`wait-${calls}`, 'process_wait', {
                  process_id: snapshot.process_id,
                  cursor: snapshot.next_cursor,
                  wait_ms: 1000,
                })
              : text('Observed completion.')
        return new FakeModel([reply]).stream(request, context)
      },
    }
    const executor = new WorkspaceToolExecutor(root)
    const env = {
      ...base,
      llm,
      tools: { registry: new OrderedToolRegistry(workspaceToolDefinitions), executor },
    }
    try {
      const session = await Agent.open({ cwd: root, env }).newSession({ permissionMode: 'auto' })
      const result = await session.turn('run')
      expect(result.terminal.type).toBe('turn.completed')
      const events = await collectEvents(session)
      expect(
        events.filter((event) => event.type === 'tool.call' && event.tool === 'bash'),
      ).toHaveLength(1)
      expect(
        events
          .filter((event) => event.type === 'tool.result')
          .map((event) => event.content)
          .join(''),
      ).toContain('verified')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

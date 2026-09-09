import { execPath } from 'node:process'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultEnv, createDefaultEnvWithMcp } from '../../src/env.js'
import { FakeModel } from '../../src/llm/fake/model.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { collectEvents } from '../helpers.js'

const debugServer = resolve(process.cwd(), '../scripts/debug-mcp/stdio-echo-server.mjs')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('external injection', () => {
  it('injects host prompts as stable sections without exposing customEnv', async () => {
    const root = makeWorkspace()
    const model = new FakeModel([text('done')])
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: model,
      systemPrompt: 'Host session contract',
      skillSystemPrompt: 'Available skill summary',
      customEnv: { SPARK_EXTERNAL_TEST: 'secret-value' },
    })

    const sections = await env.prompt.compose(
      { sessionId: 'session-1', cwd: root, permissionMode: 'manual' },
      { cwd: root, permissionMode: 'manual' },
    )

    expect(sections.map((section) => section.id)).toEqual([
      'spark-kernel-contract',
      'host-skill-prompt',
      'host-system-prompt',
      'runtime',
    ])
    expect(sections.slice(0, 3).every((section) => section.stability === 'stable')).toBe(true)
    expect(sections.map((section) => section.content).join('\n')).not.toContain('secret-value')
  })

  it('passes customEnv only to the shell child process', async () => {
    const root = makeWorkspace()
    const model = new FakeModel([
      toolCall('bash-1', 'bash', { command: 'printf "%s" "$SPARK_EXTERNAL_TEST"' }),
      text('done'),
    ])
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: model,
      customEnv: { SPARK_EXTERNAL_TEST: 'injected-value' },
    })
    const agent = Agent.open({ cwd: root, env })
    const session = await agent.newSession({ permissionMode: 'auto' })

    await session.turn('read the injected variable')

    const events = await collectEvents(session)
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: true,
      content: expect.stringContaining('injected-value'),
    })
    expect(process.env.SPARK_EXTERNAL_TEST).toBeUndefined()
  })

  it('does not leak customEnv into configured MCP server processes', async () => {
    const root = makeWorkspace()
    const managed = await createDefaultEnvWithMcp({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('done')]),
      customEnv: { SPARK_EXTERNAL_TEST: 'must-not-be-forwarded' },
      mcpServers: {
        debug: {
          type: 'stdio',
          command: execPath,
          args: [debugServer],
          env: { SPARK_MCP_EXPLICIT_TEST: 'explicit-server-value' },
        },
      },
    })
    try {
      const definition = managed.env.tools.registry.get('mcp__debug__debug_echo')
      expect(definition).toBeDefined()
      const outcome = await managed.env.tools.executor.execute(
        {
          callId: 'env-1',
          name: 'mcp__debug__debug_echo',
          args: { message: 'inspect env' },
          definition: definition!,
        },
        { signal: new AbortController().signal, timeoutMs: definition?.timeoutMs ?? 5_000 },
      )
      expect(outcome.ok).toBe(true)
      expect(outcome.content).toContain('custom=')
      expect(outcome.content).toContain('explicit=explicit-server-value')
      expect(outcome.content).not.toContain('must-not-be-forwarded')
    } finally {
      await managed.close()
    }
  })

  it('discovers and calls an MCP stdio tool through the normal tool loop', async () => {
    const root = makeWorkspace()
    const model = new FakeModel([
      toolCall('mcp-1', 'mcp__debug__debug_echo', { message: 'hello from spark' }),
      text('MCP call completed.'),
    ])
    const managed = await createDefaultEnvWithMcp({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: model,
      allowedTools: ['mcp__debug__debug_echo'],
      mcpServers: {
        debug: {
          type: 'stdio',
          command: execPath,
          args: [debugServer],
        },
      },
    })
    try {
      const agent = Agent.open({ cwd: root, env: managed.env })
      const session = await agent.newSession({ permissionMode: 'manual' })
      const result = await session.turn('call the debug MCP tool')
      const requests = model.requests[0]
      const events = await collectEvents(session)

      expect(result.terminal.type).toBe('turn.completed')
      expect(requests?.tools.map((tool) => tool.name)).toContain('mcp__debug__debug_echo')
      expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
        ok: true,
        content: expect.stringContaining('hello from spark'),
      })
    } finally {
      await managed.close()
    }
  })

  it('discovers and calls a Streamable HTTP MCP tool', async () => {
    const root = makeWorkspace()
    const serverScript = resolve(process.cwd(), '../scripts/debug-mcp/http-echo-server.mjs')
    const port = 20_000 + Math.floor(Math.random() * 10_000)
    const server = spawn(execPath, [serverScript, String(port)], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    try {
      const url = await waitForHttpServer(server)
      const managed = await createDefaultEnvWithMcp({
        cwd: root,
        dataRoot: join(root, '.spark-data'),
        llm: new FakeModel([text('done')]),
        mcpServers: { debug: { type: 'http', url } },
      })
      try {
        const definition = managed.env.tools.registry.get('mcp__debug__debug_echo_http')
        expect(definition).toBeDefined()
        const outcome = await managed.env.tools.executor.execute(
          {
            callId: 'http-1',
            name: 'mcp__debug__debug_echo_http',
            args: { message: 'hello over http' },
            definition: definition!,
          },
          { signal: new AbortController().signal, timeoutMs: definition?.timeoutMs ?? 5_000 },
        )
        expect(outcome).toMatchObject({
          ok: true,
          content: expect.stringContaining('hello over http'),
        })
      } finally {
        await managed.close()
      }
    } finally {
      server.kill('SIGTERM')
    }
  })
})

function makeWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'spark-external-injection-'))
  mkdirSync(root, { recursive: true })
  roots.push(root)
  return root
}

async function waitForHttpServer(server: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    const onData = (chunk: Buffer): void => {
      const match = /listening on (http:\/\/127\.0\.0\.1:\d+\/mcp)/u.exec(chunk.toString())
      if (match?.[1] !== undefined) {
        server.stderr?.off('data', onData)
        resolveUrl(match[1])
      }
    }
    server.stderr?.on('data', onData)
    server.once('error', reject)
    server.once('exit', (code) => {
      reject(new Error(`HTTP MCP fixture exited before ready: ${String(code)}`))
    })
  })
}

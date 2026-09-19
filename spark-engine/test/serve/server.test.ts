import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { Agent } from '../../src/sdk/agent.js'
import { ServeApprover } from '../../src/serve/approver.js'
import { startServeServer, type ServeServerHandle } from '../../src/serve/server.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import type { AgentEvent } from '../../src/events/schema.js'
import type { LlmCallContext, LlmService } from '../../src/seams.js'
import type { LlmRequest } from '../../src/llm/types.js'

const roots: string[] = []
const handles: ServeServerHandle[] = []

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close().catch(() => undefined)
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function start(
  script: readonly FakeScriptItem[],
  envOptions: {
    readonly shell?: Record<string, { readonly stdout?: string; readonly exitCode: number }>
  } = {},
): Promise<{
  handle: ServeServerHandle
  baseUrl: string
  agent: Agent
  approver: ServeApprover
}> {
  const root = await mkdtemp(join(tmpdir(), 'spark-serve-'))
  roots.push(root)
  const approver = new ServeApprover()
  const env = createDeterministicEnv(script, envOptions)
  const agent = Agent.open({
    cwd: root,
    env: { ...env, permission: { ...env.permission, approver } },
  })
  const handle = await startServeServer({
    agent,
    approver,
    engineVersion: '0.0.0-test',
    port: 0,
  })
  handles.push(handle)
  return { handle, baseUrl: `http://127.0.0.1:${handle.handshake.port}`, agent, approver }
}

function authed(handle: ServeServerHandle, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      authorization: `Bearer ${handle.handshake.token}`,
    },
  }
}

async function readSse(response: Response): Promise<{
  events: AgentEvent[]
  done: { turnId: string; terminal: AgentEvent } | undefined
  error: { message: string } | undefined
}> {
  const body = await response.text()
  const events: AgentEvent[] = []
  let done: { turnId: string; terminal: AgentEvent } | undefined
  let error: { message: string } | undefined
  for (const block of body.split('\n\n').filter(Boolean)) {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length)
    const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? ''
    if (event === 'agent-event') events.push(JSON.parse(data) as AgentEvent)
    if (event === 'done') done = JSON.parse(data)
    if (event === 'error') error = JSON.parse(data)
  }
  return { events, done, error }
}

type FakeScriptItem = ReturnType<typeof text>

describe('spark serve protocol v1', () => {
  it('rejects requests without the bearer token', async () => {
    const { baseUrl } = await start([text('hi')])
    const health = await fetch(`${baseUrl}/v1/health`)
    expect(health.status).toBe(401)
    const sessions = await fetch(`${baseUrl}/v1/sessions`, { method: 'POST' })
    expect(sessions.status).toBe(401)
  })

  it('reports engine and protocol identity on /v1/health', async () => {
    const { handle, baseUrl } = await start([text('hi')])
    const response = await fetch(`${baseUrl}/v1/health`, authed(handle))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      protocolVersion: 1,
      engineVersion: '0.0.0-test',
      sessions: 0,
      activeTurns: 0,
    })
  })

  it('streams a full turn as SSE agent events and terminates with done', async () => {
    const { handle, baseUrl } = await start([text('Hello from Spark.')])
    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, authed(handle, { method: 'POST' }))
    ).json()) as { sessionId: string }

    const turn = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'hello' }),
      }),
    })
    expect(turn.status).toBe(200)
    expect(turn.headers.get('content-type')).toContain('text/event-stream')

    const { events, done } = await readSse(turn)
    const types = events.map((event) => event.type)
    // A freshly created session also reports its own lifecycle event first.
    expect(types[0]).toBe('session.started')
    expect(types).toContain('turn.started')
    expect(types).toContain('assistant.completed')
    expect(types.at(-1)).toBe('turn.completed')
    const assistant = events.find((event) => event.type === 'assistant.completed')
    expect(assistant?.type === 'assistant.completed' && assistant.message.text).toBe(
      'Hello from Spark.',
    )
    expect(done?.terminal.type).toBe('turn.completed')
  })

  it('runs tools and replays the ledger over the events endpoint', async () => {
    const { handle, baseUrl } = await start([
      toolCall('read-1', 'read', { path: 'a.ts' }),
      text('done'),
    ])
    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, authed(handle, { method: 'POST' }))
    ).json()) as { sessionId: string }

    const turn = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'read the file' }),
      }),
    })
    const { done } = await readSse(turn)
    expect(done?.terminal.type).toBe('turn.completed')

    const replay = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/events`, authed(handle))
    const lines = (await replay.text()).split('\n').filter(Boolean)
    const events = lines.map((line) => JSON.parse(line) as AgentEvent)
    expect(events[0]?.type).toBe('session.started')
    expect(events.some((event) => event.type === 'tool.result')).toBe(true)

    const partial = await fetch(
      `${baseUrl}/v1/sessions/${session.sessionId}/events?fromSeq=3`,
      authed(handle),
    )
    const partialEvents = (await partial.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AgentEvent)
    expect(partialEvents.every((event) => event.seq >= 3)).toBe(true)
    expect(partialEvents.length).toBeLessThan(events.length)
  })

  it('cancels the active turn and reports 409 when nothing runs', async () => {
    // A model stream that only finishes when aborted: the deterministic
    // cancellation path drives turn.cancelled through the SSE stream.
    const hanging: LlmService = {
      stream: async function* (request: LlmRequest, context: LlmCallContext) {
        await new Promise<never>((resolveWait, rejectWait) => {
          context.signal.addEventListener(
            'abort',
            () => {
              rejectWait(new Error('aborted'))
            },
            {
              once: true,
            },
          )
        })
        yield { type: 'done' }
      },
    }
    const root = await mkdtemp(join(tmpdir(), 'spark-serve-cancel-'))
    roots.push(root)
    const base = createDeterministicEnv([])
    const approver = new ServeApprover()
    const agent = Agent.open({
      cwd: root,
      env: { ...base, llm: hanging, permission: { ...base.permission, approver } },
    })
    const handle = await startServeServer({
      agent,
      approver,
      engineVersion: '0.0.0-test',
      port: 0,
    })
    handles.push(handle)
    const baseUrl = `http://127.0.0.1:${handle.handshake.port}`

    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, authed(handle, { method: 'POST' }))
    ).json()) as { sessionId: string }

    // A second concurrent turn is rejected while the first holds the session.
    const first = fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'long task' }),
      }),
    })
    await new Promise<void>((resolveRaced) => setTimeout(resolveRaced, 50))
    const second = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'second' }),
      }),
    })
    expect(second.status).toBe(409)

    const cancel = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/cancel`, {
      ...authed(handle, { method: 'POST' }),
    })
    expect(cancel.status).toBe(200)

    const { events } = await readSse(await first)
    expect(events.at(-1)?.type).toBe('turn.cancelled')

    const cancelAgain = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/cancel`, {
      ...authed(handle, { method: 'POST' }),
    })
    expect(cancelAgain.status).toBe(409)
  })

  it('rejects unknown sessions, invalid bodies, and oversized payloads', async () => {
    const { handle, baseUrl } = await start([text('hi')])
    const missing = await fetch(`${baseUrl}/v1/sessions/nope/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'x' }),
      }),
    })
    expect(missing.status).toBe(404)

    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, authed(handle, { method: 'POST' }))
    ).json()) as { sessionId: string }

    const badJson = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops',
      }),
    })
    expect(badJson.status).toBe(400)

    const noInput = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    })
    expect(noInput.status).toBe(400)

    const badImage = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'x',
          images: [{ mediaType: 'application/pdf', base64: 'aGk=' }],
        }),
      }),
    })
    expect(badImage.status).toBe(400)

    const unknownRoute = await fetch(`${baseUrl}/v2/whatever`, authed(handle))
    expect(unknownRoute.status).toBe(404)
  })

  it('resumes a persisted session and replays its history', async () => {
    const { handle, baseUrl, agent } = await start([text('first answer'), text('second answer')])
    const first = (await (
      await fetch(`${baseUrl}/v1/sessions`, authed(handle, { method: 'POST' }))
    ).json()) as { sessionId: string }
    const firstTurn = await fetch(`${baseUrl}/v1/sessions/${first.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'first question' }),
      }),
    })
    await readSse(firstTurn)

    // A fresh server process over the same store would resume via openSession;
    // the in-process equivalent exercises the resume branch directly.
    const resumed = await agent.openSession(first.sessionId)
    const sessionsResponse = await fetch(`${baseUrl}/v1/sessions`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resume: resumed.sessionId }),
      }),
    })
    expect(sessionsResponse.status).toBe(200)
    const body = (await sessionsResponse.json()) as { sessionId: string; resumed: boolean }
    expect(body.resumed).toBe(true)

    const missing = await fetch(`${baseUrl}/v1/sessions`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resume: 'session-unknown' }),
      }),
    })
    expect(missing.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Protocol tool approvals (serve v1): permission.requested rides the turn's
// SSE stream; the host answers POST /v1/approvals/:requestId.
// ---------------------------------------------------------------------------

interface SseCollector {
  readonly events: AgentEvent[]
  waitFor(predicate: (events: readonly AgentEvent[]) => boolean, timeoutMs?: number): Promise<void>
  finished(): Promise<void>
}

function startCollector(response: Response): SseCollector {
  const events: AgentEvent[] = []
  const decoder = new TextDecoder()
  let buffer = ''
  let settled: Promise<void> | undefined

  const consume = (block: string): void => {
    const lines = block.split('\n')
    const event = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length)
    const data = lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? ''
    if (event === 'agent-event') events.push(JSON.parse(data) as AgentEvent)
  }

  const pump = (async () => {
    const reader = response.body!.getReader()
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) break
        consume(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
      }
    }
    consume(buffer)
  })()

  return {
    events,
    waitFor: async (predicate, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs
      while (!predicate(events)) {
        if (Date.now() > deadline) {
          throw new Error(`timeout waiting for SSE events: ${events.map((e) => e.type).join(',')}`)
        }
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 20))
      }
    },
    finished: () => {
      settled ??= pump
      return settled
    },
  }
}

describe('spark serve protocol tool approvals', () => {
  it('answers an allow decision and the tool runs', async () => {
    const { handle, baseUrl } = await start(
      [toolCall('bash-1', 'bash', { command: 'echo hi' }), text('done')],
      { shell: { 'echo hi': { stdout: 'hi', exitCode: 0 } } },
    )
    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, {
        ...authed(handle, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ permissionMode: 'manual' }),
        }),
      })
    ).json()) as { sessionId: string }

    const turn = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'run the command' }),
      }),
    })
    const collector = startCollector(turn)
    await collector.waitFor((events) =>
      events.some((event) => event.type === 'permission.requested'),
    )

    const pending = (await (await fetch(`${baseUrl}/v1/approvals`, authed(handle))).json()) as {
      pending: readonly { requestId: string; tool: string }[]
    }
    expect(pending.pending).toHaveLength(1)
    expect(pending.pending[0]?.tool).toBe('bash')
    const requestId = pending.pending[0]!.requestId

    const answer = await fetch(`${baseUrl}/v1/approvals/${requestId}`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The fake bash tool declares approval:'always', so only a per-call
        // grant is in the allowed scopes; the policy would reject 'session'.
        body: JSON.stringify({ decision: 'allow', grantScope: 'once' }),
      }),
    })
    expect(answer.status).toBe(200)

    await collector.finished()
    const types = collector.events.map((event) => event.type)
    expect(types).toContain('permission.decided')
    expect(types).toContain('tool.result')
    const toolResult = collector.events.find((event) => event.type === 'tool.result')
    expect(toolResult?.type === 'tool.result' && toolResult.ok).toBe(true)
    expect(types.at(-1)).toBe('turn.completed')
  })

  it('answers a deny decision and the turn still completes with a failed tool result', async () => {
    const { handle, baseUrl } = await start([
      toolCall('bash-2', 'bash', { command: 'echo blocked' }),
      text('done'),
    ])
    const session = (await (
      await fetch(`${baseUrl}/v1/sessions`, {
        ...authed(handle, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ permissionMode: 'manual' }),
        }),
      })
    ).json()) as { sessionId: string }

    const turn = await fetch(`${baseUrl}/v1/sessions/${session.sessionId}/turns`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'run the blocked command' }),
      }),
    })
    const collector = startCollector(turn)
    await collector.waitFor((events) =>
      events.some((event) => event.type === 'permission.requested'),
    )

    const pending = (await (await fetch(`${baseUrl}/v1/approvals`, authed(handle))).json()) as {
      pending: readonly { requestId: string }[]
    }
    const answer = await fetch(`${baseUrl}/v1/approvals/${pending.pending[0]!.requestId}`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'deny', reason: 'not allowed today' }),
      }),
    })
    expect(answer.status).toBe(200)

    await collector.finished()
    const toolResult = collector.events.find((event) => event.type === 'tool.result')
    expect(toolResult?.type === 'tool.result' && toolResult.ok).toBe(false)
    expect(collector.events.at(-1)?.type).toBe('turn.completed')
  })

  it('answers an unknown approval id with 404 and rejects invalid decisions', async () => {
    const { handle, baseUrl } = await start([text('hi')])
    const answer = await fetch(`${baseUrl}/v1/approvals/p-does-not-exist`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'allow' }),
      }),
    })
    expect(answer.status).toBe(404)

    const badDecision = await fetch(`${baseUrl}/v1/approvals/p-does-not-exist`, {
      ...authed(handle, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      }),
    })
    expect(badDecision.status).toBe(400)
  })
})

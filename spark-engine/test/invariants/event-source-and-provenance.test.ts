import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import type { AgentEvent } from '../../src/events/schema.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { projectTranscript } from '../../src/tui/projection.js'
import { presentToolResult } from '../../src/tui/tool-presentation.js'
import { collectEvents } from '../helpers.js'

describe('invariants: event source and model provenance', () => {
  it('rebuilds model and TUI projections entirely from the event log', async () => {
    const env = createDeterministicEnv(
      [toolCall('read-1', 'read', { path: 'a.ts' }), text('The file contains x.')],
      { files: { 'a.ts': 'x' } },
    )
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await session.turn('Read a.ts')
    const events = await collectEvents(session)

    const first = env.projector.project(events, { cwd: '/workspace' })
    const second = env.projector.project(structuredClone(events), { cwd: '/workspace' })
    expect(second).toEqual(first)
    const knownSeqs = new Set(events.map((event) => event.seq))
    for (const message of first.messages) {
      expect(message.sourceSeqs.length).toBeGreaterThan(0)
      expect(message.sourceSeqs.every((seq) => knownSeqs.has(seq))).toBe(true)
    }
    expect(env.fixtures.model.requests[1]?.messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        toolCalls: [{ callId: 'read-1', name: 'read', args: { path: 'a.ts' } }],
      }),
    )

    const ui = projectTranscript(events, { color: 'mono', unicode: false, width: 80 })
    expect(ui.settled.length).toBeGreaterThan(0)
    expect(ui.activeTools).toEqual([])
  })

  it('renders unknown future events through a fallback row', () => {
    const projection = projectTranscript([{ type: 'future.event', seq: 42, schemaVersion: 99 }], {
      color: 'mono',
      unicode: false,
      width: 80,
    })
    expect(projection.settled[0]?.text).toBe('[event:future.event #42]')
  })

  it('projects readable tool headers and bounded result previews', async () => {
    const env = createDeterministicEnv(
      [toolCall('read-1', 'read', { path: 'src/index.ts' }), text('Done.')],
      { files: { 'src/index.ts': 'export const answer = 42;' } },
    )
    const session = await Agent.open({ cwd: '/workspace', env }).newSession({
      permissionMode: 'auto',
    })
    await session.turn('Read src/index.ts')

    const projection = projectTranscript(await collectEvents(session), {
      color: 'mono',
      unicode: false,
      width: 80,
    })
    const tool = projection.settled.find((row) => row.toolLine)?.toolLine
    expect(tool).toMatchObject({
      tool: 'read',
      title: 'Read · src/index.ts',
      ok: true,
      isTask: false,
    })
    expect(tool?.resultLines.join('\n')).toContain('answer = 42')

    const bounded = presentToolResult(
      'bash',
      Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n'),
      65_500,
      80,
    )
    expect(bounded.lines.at(-1)).toBe('…')
    expect(bounded.lines.length).toBeLessThanOrEqual(7)
    expect(bounded.duration).toBe('1m 5s')

    const safe = presentToolResult('bash', '\u001B[2Jsecret\u0007', 12, 80)
    expect(safe.lines).toEqual(['␛[2Jsecret�'])
    expect(safe.lines[0]).not.toContain('\u001B')
  })

  it('projects an invoked task as a running subagent before its result settles', () => {
    const events = [
      {
        type: 'tool.call',
        schemaVersion: 1,
        sessionId: 'session-1',
        seq: 1,
        ts: 1,
        callId: 'task-1',
        stepId: 'step-1',
        tool: 'task',
        args: { description: 'Trace the request flow', prompt: 'Inspect the code.' },
      },
      {
        type: 'tool.intent',
        schemaVersion: 1,
        sessionId: 'session-1',
        seq: 2,
        ts: 2,
        callId: 'task-1',
      },
    ] satisfies AgentEvent[]

    expect(
      projectTranscript(events, { color: 'mono', unicode: false, width: 80 }).activeTools,
    ).toEqual([
      {
        callId: 'task-1',
        tool: 'task',
        title: 'Task · Trace the request flow',
        detail: 'read-only',
        isTask: true,
        status: 'running',
      },
    ])
  })
})

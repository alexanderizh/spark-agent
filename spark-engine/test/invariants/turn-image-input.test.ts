import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { AgentEventSchema, type AgentEvent } from '../../src/events/schema.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { pngBytes } from '../fixtures/image-bytes.js'
import { collectEvents } from '../helpers.js'

const SHOT = pngBytes(1920, 1080)
const DIAGRAM = pngBytes(800, 600)

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('invariants: image input provenance', () => {
  it('records artifact references and sends the bytes to the model', async () => {
    const env = createDeterministicEnv([text('It is a screenshot.')])
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()

    await session.turn('what is in this screenshot?', {
      images: [
        { bytes: SHOT, mediaType: 'image/png', name: 'shot.png', width: 1920, height: 1080 },
        { bytes: DIAGRAM, mediaType: 'image/png', name: 'diagram.png' },
      ],
    })

    const events = await collectEvents(session)
    const started = events.find((event) => event.type === 'turn.started')
    expect(started?.type === 'turn.started' && started.input.images).toEqual([
      {
        ref: expect.objectContaining({
          sha256: sha256(SHOT),
          bytes: SHOT.byteLength,
          mediaType: 'image/png',
          summary: 'shot.png',
        }),
        name: 'shot.png',
        width: 1920,
        height: 1080,
      },
      {
        ref: expect.objectContaining({ sha256: sha256(DIAGRAM), mediaType: 'image/png' }),
        name: 'diagram.png',
      },
    ])

    // The projection carries references only; the turn machine resolves the
    // payloads, so the ledger never holds base64.
    const projected = env.projector.project(events, { cwd: '/workspace' })
    const user = projected.messages[0]
    const refs = user?.role === 'user' ? user.imageRefs : undefined
    expect(refs).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain(Buffer.from(SHOT).toString('base64').slice(0, 32))

    const request = env.fixtures.model.requests[0]
    const sent = request?.messages[0]
    const parts = sent?.role === 'user' ? sent.imageParts : undefined
    expect(parts).toEqual([
      { mediaType: 'image/png', base64: Buffer.from(SHOT).toString('base64') },
      { mediaType: 'image/png', base64: Buffer.from(DIAGRAM).toString('base64') },
    ])
    expect(env.fixtures.telemetry.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'image.persisted', attributes: { count: 2 } }),
        expect.objectContaining({ name: 'image.attached', attributes: { count: 2 } }),
      ]),
    )
  })

  it('reads each artifact once per turn even across several steps', async () => {
    const env = createDeterministicEnv([
      toolCall('read-1', 'read', { path: 'a.ts' }),
      text('done'),
    ])
    const reads: string[] = []
    const inner = env.artifacts
    const countingEnv = {
      ...env,
      artifacts: {
        put: (content: string | Uint8Array, mediaType: string) => inner.put(content, mediaType),
        get: (ref: Parameters<typeof inner.get>[0]) => {
          reads.push(ref.sha256)
          return inner.get(ref)
        },
      },
    }
    const session = await Agent.open({ cwd: '/workspace', env: countingEnv }).newSession()
    await session.turn('look and read', { images: [{ bytes: SHOT, mediaType: 'image/png' }] })

    expect(env.fixtures.model.requests).toHaveLength(2)
    for (const request of env.fixtures.model.requests) {
      expect(request.messages[0]?.role === 'user' && request.messages[0].imageParts).toHaveLength(1)
    }
    expect(reads).toEqual([sha256(SHOT)])
  })

  it('fails the turn with a clear code when the artifact is gone', async () => {
    const env = createDeterministicEnv([text('unreachable')])
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await session.turn('first', { images: [{ bytes: SHOT, mediaType: 'image/png' }] })

    // A follow-up turn replays the same reference from the ledger; the store
    // must report the loss instead of silently sending a text-only prompt.
    const brokenEnv = {
      ...env,
      artifacts: {
        put: () => Promise.reject(new Error('not used')),
        get: () => Promise.reject(new Error('gone')),
      },
    }
    const resumed = await Agent.open({ cwd: '/workspace', env: brokenEnv }).openSession(
      session.sessionId,
    )
    const result = await resumed.turn('and now?')

    expect(result.terminal.type).toBe('turn.failed')
    expect(result.terminal.type === 'turn.failed' && result.terminal.error.code).toBe(
      'image.artifact_missing',
    )
    expect(env.fixtures.telemetry.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'image.resolve_failed',
          attributes: expect.objectContaining({ reason: 'missing' }),
        }),
      ]),
    )
  })

  it('rejects an invalid batch before any event is written', async () => {
    const env = createDeterministicEnv([text('unreachable')])
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await expect(
      session.turn('too many', {
        images: Array.from({ length: 21 }, () => ({ bytes: SHOT, mediaType: 'image/png' as const })),
      }),
    ).rejects.toMatchObject({ code: 'image.invalid_attachment' })
    await expect(
      session.turn('too big', {
        images: [{ bytes: new Uint8Array(21 * 1024 * 1024), mediaType: 'image/png' }],
      }),
    ).rejects.toMatchObject({ code: 'image.invalid_attachment' })
    expect(await collectEvents(session)).toEqual([])

    // A valid turn still runs afterwards: the rejection is per call.
    await session.turn('fine')
    expect(env.fixtures.model.requests).toHaveLength(1)
  })

  it('keeps ledgers written before images existed readable', async () => {
    const legacy = AgentEventSchema.parse({
      schemaVersion: 1,
      sessionId: 'session-legacy',
      seq: 2,
      ts: 1_700_000_000_000,
      type: 'turn.started',
      turnId: 'turn-1',
      input: { kind: 'text', text: 'no images here' },
    })
    const env = createDeterministicEnv([text('ok')])
    const projected = env.projector.project([legacy], { cwd: '/workspace' })
    expect(projected.messages).toEqual([
      { role: 'user', content: 'no images here', sourceSeqs: [2] },
    ])

    // And a newer ledger still replays through a text-only session.
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await session.turn('plain')
    const events: AgentEvent[] = await collectEvents(session)
    const started = events.find((event) => event.type === 'turn.started')
    expect(started?.type).toBe('turn.started')
    expect(started?.type === 'turn.started' ? started.input.images : 'missing').toBeUndefined()
  })
})

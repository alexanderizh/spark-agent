import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'

describe('Agent.listSessions', () => {
  it('lists recorded sessions most recently updated first with input previews', async () => {
    const env = createDeterministicEnv([text('alpha reply.'), text('beta reply.')])
    const agent = Agent.open({ cwd: '/workspace', env })
    const alpha = await agent.newSession()
    await alpha.turn('alpha question')
    const beta = await agent.newSession()
    await beta.turn('beta question')

    const sessions = await agent.listSessions()
    expect(sessions.map((session) => session.sessionId)).toContain(alpha.sessionId)
    expect(sessions.map((session) => session.sessionId)).toContain(beta.sessionId)
    // Deterministic clock stamps both turns equally, but both rows carry previews.
    const previews = sessions.map((session) => session.preview).sort()
    expect(previews).toEqual(['alpha question', 'beta question'])
  })

  it('reopens a recorded session and replays its full ledger', async () => {
    const env = createDeterministicEnv([text('cached reply.')])
    const agent = Agent.open({ cwd: '/workspace', env })
    const first = await agent.newSession()
    await first.turn('original question')

    const reopened = await agent.openSession(first.sessionId)
    expect(reopened.sessionId).toBe(first.sessionId)
    const events = []
    for await (const event of reopened.events()) events.push(event)
    expect(events[0]?.type).toBe('session.started')
    expect(events.some((event) => event.type === 'turn.started')).toBe(true)
    expect(events.some((event) => event.type === 'assistant.completed')).toBe(true)
  })

  it('throws a clear error when opening an unknown session', async () => {
    const env = createDeterministicEnv([])
    const agent = Agent.open({ cwd: '/workspace', env })
    await expect(agent.openSession('session_nope')).rejects.toThrow('Session not found')
  })
})

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AgentEvent, BoundEventDraft } from '../../src/events/schema.js'
import { AgentEventSchema } from '../../src/events/schema.js'
import {
  extractAndSaveMemories,
  extractMemoriesFromTurn,
  parseExtraction,
} from '../../src/memory/extraction.js'
import { FileMemoryStore } from '../../src/memory/store.js'
import { createDeterministicEnv } from '../../src/env.js'
import { text } from '../../src/llm/fake/reply-dsl.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function event(input: BoundEventDraft, seq: number): AgentEvent {
  return AgentEventSchema.parse({ ...input, sessionId: 's1', seq, ts: seq })
}

function twoTurnHistory(): AgentEvent[] {
  return [
    event(
      {
        type: 'session.started',
        schemaVersion: 1,
        engineVersion: '0.0.0-test',
        cwd: '/ws',
        configSnapshot: '{}',
      },
      0,
    ),
    event(
      {
        type: 'turn.started',
        schemaVersion: 1,
        turnId: 't1',
        input: { kind: 'text', text: 'old turn' },
      },
      1,
    ),
    event(
      {
        type: 'assistant.completed',
        schemaVersion: 1,
        turnId: 't1',
        stepId: 's1',
        message: { text: 'old answer', toolCalls: [] },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        llmMs: 1,
        ttftMs: 1,
      },
      2,
    ),
    event(
      {
        type: 'turn.started',
        schemaVersion: 1,
        turnId: 't2',
        input: { kind: 'text', text: 'build with npm run verify' },
      },
      3,
    ),
    event(
      {
        type: 'assistant.completed',
        schemaVersion: 1,
        turnId: 't2',
        stepId: 's2',
        message: { text: 'The verification command is npm run verify.', toolCalls: [] },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        llmMs: 1,
        ttftMs: 1,
      },
      4,
    ),
  ]
}

describe('parseExtraction', () => {
  it('parses a JSON array, clamps to maxItems, and drops shape-invalid rows', () => {
    const text = JSON.stringify([
      {
        scope: 'project',
        type: 'project',
        name: 'verify command',
        description: 'Repo validation',
        body: 'npm run verify',
      },
      { scope: 'user', type: 'feedback', name: '', description: 'x', body: 'dropped: empty name' },
      {
        scope: 'user',
        type: 'user',
        name: 'tone',
        description: 'Style',
        body: 'Prefers concise answers',
      },
      'garbage',
    ])
    const extracted = parseExtraction(text, 1)
    expect(extracted).toHaveLength(1)
    expect(extracted[0]).toEqual({
      scope: 'project',
      type: 'project',
      name: 'verify command',
      description: 'Repo validation',
      body: 'npm run verify',
    })
  })

  it('strips code fences and prose around the array', () => {
    const text =
      'Here is what I found:\n```json\n[{"scope":"user","name":"n","description":"d","body":"b"}]\n```'
    expect(parseExtraction(text, 3)).toHaveLength(1)
  })

  it('returns nothing for non-array or unparseable output', () => {
    expect(parseExtraction('no json here', 3)).toEqual([])
    expect(parseExtraction('{"scope":"user"}', 3)).toEqual([])
  })

  it('normalizes types against the scope', () => {
    const extracted = parseExtraction(
      '[{"scope":"user","type":"project","name":"n","description":"d","body":"b"}]',
      3,
    )
    // 'project' is not a valid user-scope type; falls back to the scope itself.
    expect(extracted[0]?.type).toBe('user')
  })
})

describe('extractMemoriesFromTurn', () => {
  it('distills only the newest turn and feeds it to the extractor', async () => {
    const base = createDeterministicEnv([
      text(
        '[{"scope":"project","type":"reference","name":"verify","description":"Build check","body":"npm run verify"}]',
      ),
    ])
    const events = twoTurnHistory()
    const extracted = await extractMemoriesFromTurn({ env: base, events, maxItems: 3 })

    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.name).toBe('verify')
    // The extractor request must contain the newest turn's content inside
    // <turn>, with prior-turn dialogue available only as bounded
    // <recent_context> for reference resolution.
    const extractorRequest = base.fixtures.model.requests[0]
    const prompt =
      (extractorRequest?.messages
        .map((message) => (message.role === 'user' ? message.content : ''))
        .join('\n') ?? '')
    expect(prompt).toContain('npm run verify')
    expect(prompt).toContain('<recent_context>')
    expect(prompt).toContain('old answer')
    const turnBlock = prompt.slice(prompt.indexOf('<turn>'), prompt.indexOf('</turn>'))
    expect(turnBlock).not.toContain('old answer')
  })

  it('returns no candidates when the turn has nothing to distill', async () => {
    const base = createDeterministicEnv([text('[]')])
    const extracted = await extractMemoriesFromTurn({ env: base, events: twoTurnHistory() })
    expect(extracted).toEqual([])
  })

  it('omits the recent_context block when there is no prior turn', async () => {
    const base = createDeterministicEnv([text('[]')])
    const events = twoTurnHistory().slice(3)
    await extractMemoriesFromTurn({ env: base, events })

    const prompt = base.fixtures.model.requests[0]?.messages
      .map((message) => (message.role === 'user' ? message.content : ''))
      .join('\n')
    expect(prompt).not.toContain('<recent_context>')
    expect(prompt).toContain('<turn>')
  })

  it('bounds prior-turn context by trimming the oldest parts first', async () => {
    const base = createDeterministicEnv([text('[]')])
    const events: AgentEvent[] = [twoTurnHistory()[0]!]
    // Two bulky prior turns followed by the newest turn.
    for (let i = 0; i < 2; i += 1) {
      const bulky = ` bulky-prior-${i} `.repeat(600)
      events.push(
        event(
          { type: 'turn.started', schemaVersion: 1, turnId: `p${i}`, input: { kind: 'text', text: bulky } },
          events.length,
        ),
      )
      events.push(
        event(
          {
            type: 'assistant.completed',
            schemaVersion: 1,
            turnId: `p${i}`,
            stepId: `ps${i}`,
            message: { text: `answer-${i}`, toolCalls: [] },
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: 0,
            },
            llmMs: 1,
            ttftMs: 1,
          },
          events.length,
        ),
      )
    }
    events.push(
      event(
        {
          type: 'turn.started',
          schemaVersion: 1,
          turnId: 't9',
          input: { kind: 'text', text: 'final turn' },
        },
        events.length,
      ),
    )
    await extractMemoriesFromTurn({ env: base, events })

    const prompt =
      (base.fixtures.model.requests[0]?.messages
        .map((message) => (message.role === 'user' ? message.content : ''))
        .join('\n') ?? '')
    const recentBlock = prompt.slice(
      prompt.indexOf('<recent_context>'),
      prompt.indexOf('</recent_context>'),
    )
    // The oldest bulky turn is trimmed; the newest prior answer survives.
    expect(recentBlock).not.toContain('bulky-prior-0')
    expect(recentBlock).toContain('answer-1')
  })
})

describe('extractAndSaveMemories', () => {
  it('persists extracted memories into the store', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spark-extract-'))
    roots.push(home)
    const base = createDeterministicEnv([
      text(
        '[{"scope":"project","type":"reference","name":"verify cmd","description":"Build check","body":"npm run verify"}]',
      ),
    ])
    const store = new FileMemoryStore({
      cwd: home,
      homeDir: join(home, 'user-home'),
      enabled: true,
    })

    const outcome = await extractAndSaveMemories({
      env: base,
      store,
      events: twoTurnHistory(),
      sessionId: 's1',
    })

    expect(outcome.saved).toBe(1)
    const entries = await store.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('verify cmd')
    expect(entries[0]?.sourceSessionId).toBe('s1')
    expect(entries[0]?.scope).toBe('project')
  })

  it('swallows extraction failures after the turn already succeeded', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spark-extract-'))
    roots.push(home)
    const base = createDeterministicEnv([text('not json at all')])
    const store = new FileMemoryStore({
      cwd: home,
      homeDir: join(home, 'user-home'),
      enabled: true,
    })

    const outcome = await extractAndSaveMemories({
      env: base,
      store,
      events: twoTurnHistory(),
      sessionId: 's1',
    })

    expect(outcome.saved).toBe(0)
    expect(await store.list()).toHaveLength(0)
  })

  it('updates in place when the same memory name is extracted twice', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spark-extract-'))
    roots.push(home)
    const base = createDeterministicEnv([
      text(
        '[{"scope":"project","name":"verify cmd","description":"Build check v1","body":"npm run verify"}]',
      ),
      text(
        '[{"scope":"project","name":"verify cmd","description":"Build check v2","body":"npm run verify --strict"}]',
      ),
    ])
    const store = new FileMemoryStore({
      cwd: home,
      homeDir: join(home, 'user-home'),
      enabled: true,
    })

    await extractAndSaveMemories({ env: base, store, events: twoTurnHistory(), sessionId: 's1' })
    // Second pass simulates a later turn; the store merges by name.
    await extractAndSaveMemories({
      env: base,
      store,
      events: twoTurnHistory().slice(0, 5),
      sessionId: 's1',
    })

    const entries = await store.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.description).toBe('Build check v2')
  })
})

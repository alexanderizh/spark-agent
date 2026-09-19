import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AgentEnv } from '../../src/seams.js'
import { runDueSchedules, runSchedule } from '../../src/schedule/runner.js'
import { isDue, ScheduleStore } from '../../src/schedule/store.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const PNG_PROMPT = 'check the build'

async function newStore(): Promise<ScheduleStore> {
  const home = await mkdtemp(join(tmpdir(), 'spark-schedule-'))
  roots.push(home)
  return new ScheduleStore({ sparkHome: home })
}

const WORKSPACE = '/ws'

function envFor(llm?: { requests: unknown[] }): (cwd: string) => Promise<AgentEnv> {
  return async (cwd) => {
    const base = createEnvForTest(cwd, llm)
    return base
  }
}

// Local import indirection keeps the fake-model helpers out of the store tests.
import { createDeterministicEnv } from '../../src/env.js'

function createEnvForTest(cwd: string, llm?: { requests: unknown[] }): AgentEnv {
  const base = createDeterministicEnv([text('scheduled run finished')])
  if (llm !== undefined) {
    llm.requests = base.fixtures.model.requests
  }
  // The deterministic env's workspace executor is bound to its own cwd; the
  // schedule runner passes the schedule cwd to Agent.open, which is what the
  // workspace guard uses per call.
  void cwd
  return base
}

import { text } from '../../src/llm/fake/reply-dsl.js'

describe('isDue', () => {
  it('is due when never run, when the interval elapsed, and not when disabled or fresh', () => {
    const now = Date.parse('2026-09-20T12:00:00.000Z')
    const base = {
      id: 'sch_x',
      prompt: 'p',
      intervalMinutes: 30,
      enabled: true,
      cwd: WORKSPACE,
      createdAt: '2026-09-20T10:00:00.000Z',
      lastRunAt: null,
      lastStatus: null,
      lastResult: null,
    }
    expect(isDue(base, now)).toBe(true)
    expect(isDue({ ...base, enabled: false }, now)).toBe(false)
    const justRan = { ...base, lastRunAt: new Date(now - 5 * 60_000).toISOString() }
    expect(isDue(justRan, now)).toBe(false)
    const longAgo = { ...base, lastRunAt: new Date(now - 31 * 60_000).toISOString() }
    expect(isDue(longAgo, now)).toBe(true)
  })
})

describe('ScheduleStore', () => {
  it('round-trips schedules and records run outcomes', async () => {
    const store = await newStore()
    const added = await store.add({
      prompt: PNG_PROMPT,
      intervalMinutes: 15,
      cwd: WORKSPACE,
    })
    expect(added.id).toMatch(/^sch_/)
    expect(added.enabled).toBe(true)

    await store.markRun(added.id, 'ok', 'build green')
    const stored = await store.get(added.id)
    expect(stored?.lastStatus).toBe('ok')
    expect(stored?.lastResult).toBe('build green')
    expect(stored?.lastRunAt).toBeTruthy()
  })

  it('persists across instances and removes entries', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spark-schedule-persist-'))
    roots.push(home)
    const store = new ScheduleStore({ sparkHome: home })
    const added = await store.add({ prompt: 'p', intervalMinutes: 10, cwd: WORKSPACE })
    const reopened = new ScheduleStore({ sparkHome: home })
    expect((await reopened.load()).schedules.map((s) => s.id)).toEqual([added.id])
    expect(await reopened.remove(added.id)).toBe(true)
    expect((await reopened.load()).schedules).toHaveLength(0)
    expect(await store.remove(added.id)).toBe(false)
  })

  it('degrades a corrupt store to empty instead of failing every command', async () => {
    const home = await mkdtemp(join(tmpdir(), 'spark-schedule-bad-'))
    roots.push(home)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(home, 'schedules.json'), '{oops', 'utf8')
    const store = new ScheduleStore({ sparkHome: home })
    expect((await store.load()).schedules).toHaveLength(0)
  })
})

describe('runDueSchedules', () => {
  it('runs only due enabled schedules in their recorded cwd and marks outcomes', async () => {
    const store = await newStore()
    const dueSchedule = await store.add({ prompt: PNG_PROMPT, intervalMinutes: 10, cwd: WORKSPACE })
    const freshSchedule = await store.add({ prompt: 'fresh', intervalMinutes: 10, cwd: WORKSPACE })
    await store.markRun(freshSchedule.id, 'ok', 'recent')
    const now = Date.now()
    await store.markRun(freshSchedule.id, 'ok', 'recent')
    // Force the fresh one to look recently-run and the due one to look old.
    await store.markRun(dueSchedule.id, 'ok', 'old')
    const { writeFile: writeFileFs } = await import('node:fs/promises')
    const raw = JSON.parse(await readFile(store.path, 'utf8')) as {
      schedules: { id: string; lastRunAt: string }[]
    }
    for (const entry of raw.schedules) {
      entry.lastRunAt = new Date(
        now - (entry.id === dueSchedule.id ? 20 * 60_000 : 2 * 60_000),
      ).toISOString()
    }
    await writeFileFs(store.path, JSON.stringify(raw, null, 2))

    const outcomes = await runDueSchedules({
      store,
      envFor: envFor(),
      now: () => now + 60_000,
    })

    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]?.schedule.id).toBe(dueSchedule.id)
    expect(outcomes[0]?.ok).toBe(true)
    const updated = await store.get(dueSchedule.id)
    expect(updated?.lastStatus).toBe('ok')
    expect(updated?.lastResult).toContain('scheduled run finished')
  })

  it('records failures without throwing', async () => {
    const store = await newStore()
    const schedule = await store.add({ prompt: PNG_PROMPT, intervalMinutes: 10, cwd: WORKSPACE })
    const failing: AgentEnv = {
      ...createEnvForTest(WORKSPACE),
      llm: {
        // A stream that always fails: schedule runs must degrade to a
        // recorded failure, never throw past the runner.
        stream: () =>
          (async function* generate() {
            yield { type: 'heartbeat' }
            throw new Error('provider down')
          })(),
      } as never,
    }
    const outcome = await runSchedule(schedule, {
      store,
      envFor: async () => failing,
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.toLowerCase()).toContain('provider down')
    const stored = await store.get(schedule.id)
    expect(stored?.lastStatus).toBe('failed')
  })
})

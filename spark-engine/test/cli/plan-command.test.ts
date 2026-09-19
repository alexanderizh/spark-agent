import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { JsonlSessionStore } from '../../src/events/ledger.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('spark plan contract', () => {
  it('sets, shows, appends, and clears an explicit session plan', { timeout: 30_000 }, async () => {
    const root = await workspace()
    const home = resolve(root, 'home')
    const session = 'session-cli'

    const set = await runCli(
      ['plan', 'set', session, '--body', '# Plan\n\n1. Verify the change.'],
      root,
      home,
    )
    expect(set.code).toBe(0)
    expect(set.stdout).toContain('Set plan for session session-cli')

    const append = await runCli(['plan', 'append', session, '--body', '2. Ship it.'], root, home)
    expect(append.code).toBe(0)

    const shown = await runCli(['plan', 'show', session, '--json'], root, home)
    expect(shown.code).toBe(0)
    expect(JSON.parse(shown.stdout)).toMatchObject({
      sessionId: session,
      plan: '# Plan\n\n1. Verify the change.\n\n2. Ship it.',
    })

    const cleared = await runCli(['plan', 'clear', session], root, home)
    expect(cleared.code).toBe(0)
    expect(cleared.stdout).toContain('Cleared plan for session session-cli')
  })

  it('requires content for plan writes', { timeout: 30_000 }, async () => {
    const root = await workspace()
    const result = await runCli(['plan', 'set', 'session-cli'], root, resolve(root, 'home'))

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--body <markdown>')
  })

  it(
    'uses the latest user session when no session id is supplied',
    { timeout: 30_000 },
    async () => {
      const root = await workspace()
      const home = resolve(root, 'home')
      const sessionStore = new JsonlSessionStore({
        dataRoot: home,
        projectDir: await realpath(root),
      })
      await sessionStore.append('session-latest', {
        schemaVersion: 1,
        sessionId: 'session-latest',
        seq: 0,
        ts: Date.now(),
        type: 'session.started',
        engineVersion: 'test',
        cwd: root,
        configSnapshot: '{}',
      })

      const set = await runCli(['plan', 'set', '--body', '# Latest'], root, home)
      expect(set.code).toBe(0)
      expect(set.stdout).toContain('session-latest')

      const shown = await runCli(['plan', 'show', '--json'], root, home)
      expect(JSON.parse(shown.stdout)).toMatchObject({
        sessionId: 'session-latest',
        plan: '# Latest',
      })
    },
  )
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'spark-plan-cli-'))
  roots.push(root)
  return root
}

async function runCli(
  args: readonly string[],
  cwd: string,
  sparkHome: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const binary = resolve('dist/cli/main.js')
  const child = spawn(process.execPath, [binary, ...args], {
    cwd,
    env: { ...process.env, SPARK_HOME: sparkHome, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  })
  return { code, stdout, stderr }
}

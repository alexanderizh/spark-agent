import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) {
    // Windows keeps the temp dir locked while a spawned CLI child is dying.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('spark todo contract', () => {
  // Four sequential CLI spawns; the 5s default cannot survive a loaded machine.
  it('adds, lists, updates, and clears project tasks', { timeout: 30_000 }, async () => {
    const root = await sandbox()
    const home = resolve(root, 'home')

    const added = await runCli(
      ['todo', 'add', 'Ship the CLI slice', '--priority', 'high', '--notes', 'Run smoke tests'],
      root,
      home,
    )
    expect(added.code).toBe(0)
    const id = /todo_[A-Za-z0-9-]+/u.exec(added.stdout)?.[0]
    expect(id).toBeDefined()
    const todoId = id!

    const listed = await runCli(['todo', 'list', '--json'], root, home)
    expect(listed.code).toBe(0)
    expect(JSON.parse(listed.stdout)).toMatchObject({
      todos: [
        {
          id: todoId,
          title: 'Ship the CLI slice',
          status: 'pending',
          priority: 'high',
          notes: 'Run smoke tests',
        },
      ],
    })

    const limited = await runCli(['todo', 'list', '--limit', '1', '--json'], root, home)
    expect(limited.code).toBe(0)
    const limitedPayload = JSON.parse(limited.stdout) as { readonly todos: readonly unknown[] }
    expect(limitedPayload.todos).toHaveLength(1)

    const updated = await runCli(['todo', 'update', todoId, '--status', 'completed'], root, home)
    expect(updated.code).toBe(0)
    expect(updated.stdout).toContain('Updated todo')

    const cleared = await runCli(['todo', 'clear'], root, home)
    expect(cleared.code).toBe(0)
    expect(cleared.stdout).toContain('Cleared 1 completed/cancelled todos')
    expect((await runCli(['todo', 'list', '--json'], root, home)).stdout).toContain('"todos": []')
  })

  it(
    'keeps validation errors from mutating the project task file',
    { timeout: 30_000 },
    async () => {
      const root = await sandbox()
      const home = resolve(root, 'home')
      const invalid = await runCli(['todo', 'add', 'Bad', '--priority', 'urgent'], root, home)

      expect(invalid.code).toBe(2)
      expect(invalid.stderr).toContain('Invalid todo priority')
      const list = await runCli(['todo', 'list', '--json'], root, home)
      expect(JSON.parse(list.stdout)).toMatchObject({ todos: [] })
    },
  )
})

async function sandbox(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-todo-cli-'))
  roots.push(root)
  await mkdir(resolve(root, '.spark'), { recursive: true })
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

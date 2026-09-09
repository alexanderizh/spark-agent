import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ManagedProcesses } from '../../src/tools/workspace/managed-processes.js'
import type { ToolCallContext, ToolOwner } from '../../src/seams.js'
import type { ToolOutcome } from '../../src/tools/contract.js'

interface Snapshot {
  process_id: string
  status: string
  output: string
  next_cursor: number
  has_more: boolean
  exit_code?: number
}
const parse = (result: ToolOutcome): Snapshot => JSON.parse(result.content) as Snapshot
const fixtures: { manager: ManagedProcesses; owner: ToolOwner; root: string }[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) {
    await fixture.manager.closeTurn(fixture.owner)
    await rm(fixture.root, { recursive: true, force: true })
  }
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'spark-managed-'))
  const manager = new ManagedProcesses()
  const owner = { sessionId: 'session', turnId: 'turn' }
  const controller = new AbortController()
  const context: ToolCallContext = {
    owner,
    turnSignal: controller.signal,
    signal: controller.signal,
    timeoutMs: 5000,
  }
  fixtures.push({ manager, owner, root })
  const start = (script: string, callId = 'start') =>
    manager.start(
      callId,
      process.execPath,
      ['-e', script],
      { cwd: root, env: process.env, yieldMs: 0 },
      context,
    )
  return { root, manager, owner, controller, context, start }
}
async function drain(manager: ManagedProcesses, initial: Snapshot, context: ToolCallContext) {
  let current = initial
  let output = current.output
  for (let i = 0; i < 100 && (current.status === 'running' || current.has_more); i += 1) {
    current = parse(await manager.wait(current.process_id, current.next_cursor, 100, context))
    output += current.output
  }
  expect(current.status).not.toBe('running')
  expect(current.has_more).toBe(false)
  return { ...current, output }
}

describe.skipIf(process.platform === 'win32')('turn-owned managed commands', () => {
  it('starts once, incrementally reads UTF-8 output and preserves the exit status', async () => {
    const f = await setup()
    const script = `require('fs').appendFileSync('starts', 'x'); const b = Buffer.from('中文'); process.stdout.write(b.subarray(0,1)); setTimeout(() => { process.stdout.write(b.subarray(1)); process.exitCode = 7 }, 50)`
    const first = parse(await f.start(script))
    expect(first.status).toBe('running')
    expect(parse(await f.start(script)).process_id).toBe(first.process_id)
    const result = await drain(f.manager, first, f.context)
    expect(result.output).toBe('中文')
    expect(result.exit_code).toBe(7)
    expect(result.status).toBe('failed')
    expect(await readFile(join(f.root, 'starts'), 'utf8')).toBe('x')
    expect(() => {
      f.manager.assertTurnSettled(f.owner)
    }).not.toThrow()
  })

  it('cancelling a wait does not cancel or restart its process', async () => {
    const f = await setup()
    const first = parse(await f.start('setInterval(() => {}, 1000)'))
    const local = new AbortController()
    const waiting = f.manager.wait(first.process_id, 0, 30_000, {
      ...f.context,
      signal: local.signal,
    })
    local.abort(new Error('wait interrupted'))
    await expect(waiting).rejects.toThrow('wait interrupted')
    expect(parse(await f.manager.wait(first.process_id, 0, 0, f.context)).status).toBe('running')
    expect(parse(await f.manager.cancel(first.process_id, 0, f.context)).status).toBe('cancelled')
    expect(parse(await f.manager.cancel(first.process_id, 0, f.context)).status).toBe('cancelled')
  })

  it('rejects other owners and invalid cursors; ending the turn removes handles', async () => {
    const f = await setup()
    const first = parse(await f.start('setInterval(() => {}, 1000)'))
    for (const owner of [
      { sessionId: 'other', turnId: 'turn' },
      { sessionId: 'session', turnId: 'other' },
    ]) {
      const context = { ...f.context, owner }
      await expect(f.manager.wait(first.process_id, 0, 0, context)).rejects.toMatchObject({
        code: 'tool.process_not_found',
      })
      await expect(f.manager.cancel(first.process_id, 0, context)).rejects.toMatchObject({
        code: 'tool.process_not_found',
      })
    }
    await expect(f.manager.wait(first.process_id, 100, 0, f.context)).rejects.toMatchObject({
      code: 'tool.invalid_cursor',
    })
    expect(() => {
      f.manager.assertTurnSettled(f.owner)
    }).toThrow('Cannot finish')
    await f.manager.closeTurn(f.owner)
    await expect(f.manager.wait(first.process_id, 0, 0, f.context)).rejects.toMatchObject({
      code: 'tool.process_not_found',
    })
  })

  it('requires consuming all pages and never silently completes on unread output', async () => {
    const f = await setup()
    const first = parse(await f.start('process.stdout.write("x".repeat(10000))'))
    const result = await drain(f.manager, first, f.context)
    expect(result.output).toHaveLength(10000)
    expect(() => {
      f.manager.assertTurnSettled(f.owner)
    }).not.toThrow()
    const replay = parse(await f.manager.wait(first.process_id, 0, 0, f.context))
    expect(replay.output).toHaveLength(2000)
    expect(replay.has_more).toBe(true)
  })

  it('keeps surrogate pairs intact at page boundaries', async () => {
    const f = await setup()
    const first = parse(await f.start('process.stdout.write("x".repeat(1999) + "😀")'))
    const result = await drain(f.manager, first, f.context)
    expect(result.output).toBe('x'.repeat(1999) + '😀')
    const firstPage = parse(await f.manager.wait(first.process_id, 0, 0, f.context))
    expect(firstPage.output).toBe('x'.repeat(1999))
    expect(
      parse(await f.manager.wait(first.process_id, firstPage.next_cursor, 0, f.context)).output,
    ).toBe('😀')
  })

  it('caps retained commands and rejects invalid start options before launching', async () => {
    const f = await setup()
    await expect(
      f.manager.start(
        'invalid',
        process.execPath,
        ['-e', ''],
        {
          cwd: f.root,
          env: {},
          yieldMs: -1,
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: 'tool.invalid_wait' })
    expect(() => {
      f.manager.assertTurnSettled(f.owner)
    }).not.toThrow()
    for (let i = 0; i < 8; i += 1) await f.start('setInterval(() => {}, 1000)', `call-${i}`)
    await expect(f.start('setInterval(() => {}, 1000)', 'overflow')).rejects.toMatchObject({
      code: 'tool.process_limit',
    })
  })

  it('owner cancellation terminates the command and missing lifetime context cannot launch', async () => {
    const f = await setup()
    const first = parse(await f.start('setInterval(() => {}, 1000)'))
    f.controller.abort()
    // Read with a non-aborted local wait signal, retaining the same owner identity.
    const result = await drain(f.manager, first, {
      ...f.context,
      signal: new AbortController().signal,
    })
    expect(result.status).toBe('cancelled')
    await expect(
      f.manager.start(
        'bad',
        process.execPath,
        ['-e', ''],
        { cwd: f.root, env: {}, yieldMs: 0 },
        {
          signal: new AbortController().signal,
          timeoutMs: 100,
        },
      ),
    ).rejects.toMatchObject({ code: 'tool.process_owner_required' })
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

import { DebugLogServer } from '../services/debug-log-server.service.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, 'debug-mode-mcp-server.mjs')
const SID = 'integration-sid'

/** Minimal stdio JSON-RPC client for driving the bridge subprocess. */
class RpcClient {
  private nextId = 1
  private readonly pending = new Map<number, (v: unknown) => void>()
  private readonly rl: readline.Interface

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.rl = readline.createInterface({ input: child.stdout })
    this.rl.on('line', (line) => {
      if (!line.trim()) return
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
      if (msg.id != null && this.pending.has(msg.id)) {
        const resolve = this.pending.get(msg.id)!
        this.pending.delete(msg.id)
        if (msg.error) throw new Error(msg.error.message)
        resolve(msg.result)
      }
    })
  }

  call(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  dispose() {
    this.rl.close()
  }
}

describe('debug-mode-mcp-server.mjs ↔ DebugLogServer (integration)', () => {
  let server: DebugLogServer
  let port: number
  let child: ChildProcessWithoutNullStreams
  let rpc: RpcClient

  beforeAll(async () => {
    server = new DebugLogServer()
    port = await server.start()
    child = spawn(process.execPath, [SERVER], {
      env: { ...process.env, SPARK_DEBUG_LOG_PORT: String(port), SPARK_DEBUG_SID: SID },
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams
    rpc = new RpcClient(child)
    await rpc.call('initialize', {})
  })

  afterAll(async () => {
    rpc?.dispose()
    child?.kill()
    await server?.stop()
  })

  it('lists the five debug tools', async () => {
    const res = await rpc.call('tools/list')
    expect(res.tools.map((t: { name: string }) => t.name).sort()).toEqual(
      ['begin', 'finish', 'next_round', 'read', 'status'].sort(),
    )
  })

  it('runs the full begin → ingest → read → next_round → finish loop', async () => {
    // begin: should use the env SID and return snippets with port/sid filled.
    const begin = await rpc.call('tools/call', { name: 'begin', arguments: {} })
    const b = begin.structuredContent
    expect(b.sid).toBe(SID)
    expect(b.port).toBe(port)
    expect(b.round).toBe(1)
    expect(b.snippets.js).toContain(`http://127.0.0.1:${port}/ingest`)
    expect(b.snippets.js).toContain('__SPARK_DEBUG_START__')

    // simulate the app-under-test posting a log to the server
    await fetch(`http://127.0.0.1:${port}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: SID, round: 1, tag: 'h-A', message: 'state dump', data: { x: 1 }, source: 'browser' }),
    })

    // read: agent pulls this round's logs
    const read = await rpc.call('tools/call', { name: 'read', arguments: {} })
    expect(read.structuredContent.total).toBe(1)
    expect(read.structuredContent.entries[0].message).toBe('state dump')

    // status: thisRound reflects the reproduction
    const status = await rpc.call('tools/call', { name: 'status', arguments: {} })
    expect(status.structuredContent.thisRound).toBe(1)

    // next_round: advance + record hypothesis
    const next = await rpc.call('tools/call', { name: 'next_round', arguments: { hypothesis: 'race on mount' } })
    expect(next.structuredContent.round).toBe(2)
    expect(next.structuredContent.snippets.js).toContain('round=2')

    // finish: clears logs and returns cleanup markers
    const finish = await rpc.call('tools/call', { name: 'finish', arguments: {} })
    expect(finish.structuredContent.markers).toContain('__SPARK_DEBUG_START__')
    expect(server.getLogs(SID, 1).total).toBe(0)
  })
})

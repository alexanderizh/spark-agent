import { afterEach, describe, expect, it } from 'vitest'

import { DebugLogServer } from './debug-log-server.service.js'

describe('DebugLogServer — in-memory state', () => {
  it('ingests and reads back by round', () => {
    const s = new DebugLogServer()
    s.ingest({ sid: 'a', round: 1, tag: 'h-A', message: 'first', source: 'browser', ts: 1 })
    s.ingest({ sid: 'a', round: 1, tag: 'h-A', message: 'second', source: 'browser', ts: 2 })
    const r1 = s.getLogs('a', 1)
    expect(r1.total).toBe(2)
    expect(r1.entries.map((e) => e.message)).toEqual(['first', 'second'])
  })

  it('defaults round to the session current round when omitted', () => {
    const s = new DebugLogServer()
    s.ensureSession('a')
    s.nextRound('a', 'hypothesis B') // round -> 2
    s.ingest({ sid: 'a', message: 'on round 2', source: 'node' })
    const cur = s.getLogs('a')
    expect(cur.round).toBe(2)
    expect(cur.total).toBe(1)
    expect(s.getLogs('a', 1).total).toBe(0)
  })

  it('tracks hypotheses ledger across rounds', () => {
    const s = new DebugLogServer()
    s.ensureSession('a')
    s.nextRound('a', 'cache not invalidated')
    s.nextRound('a', 'race on mount')
    const st = s.status('a')
    expect(st.round).toBe(3)
    expect(st.hypotheses.map((h) => h.text)).toEqual(['cache not invalidated', 'race on mount'])
  })

  it('status.thisRound reflects only the current round', () => {
    const s = new DebugLogServer()
    s.ingest({ sid: 'a', round: 1, message: 'r1', source: 'browser' })
    s.nextRound('a', 'next')
    s.ingest({ sid: 'a', round: 2, message: 'r2a', source: 'browser' })
    s.ingest({ sid: 'a', round: 2, message: 'r2b', source: 'browser' })
    const st = s.status('a')
    expect(st.total).toBe(3)
    expect(st.thisRound).toBe(2)
  })

  it('ring-buffer drops oldest beyond the cap', () => {
    const s = new DebugLogServer()
    for (let i = 0; i < 5050; i++) {
      s.ingest({ sid: 'a', round: 1, message: String(i), source: 'node' })
    }
    const r = s.getLogs('a', 1)
    expect(r.total).toBe(5000)
    expect(r.entries[0]!.message).toBe('50') // first 50 dropped
  })

  it('clear wipes entries but keeps the session', () => {
    const s = new DebugLogServer()
    s.ingest({ sid: 'a', round: 1, message: 'x', source: 'node' })
    expect(s.clear('a').cleared).toBe(1)
    expect(s.getLogs('a', 1).total).toBe(0)
    expect(s.status('a').round).toBe(1)
  })

  it('rejects ingest without sid', () => {
    const s = new DebugLogServer()
    expect(s.ingest({ round: 1, message: 'x', source: 'node' })).toBeNull()
  })
})

describe('DebugLogServer — HTTP + CORS', () => {
  let server: DebugLogServer | null = null

  afterEach(async () => {
    await server?.stop()
    server = null
  })

  async function startServer(): Promise<{ base: string }> {
    server = new DebugLogServer()
    const port = await server.start()
    return { base: `http://127.0.0.1:${port}` }
  }

  it('answers OPTIONS preflight with CORS + Private Network Access', async () => {
    const { base } = await startServer()
    const res = await fetch(`${base}/ingest`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Private-Network': 'true',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-private-network')).toBe('true')
  })

  it('ingests a browser log and reads it back via the bridge routes', async () => {
    const { base } = await startServer()
    await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: 'sess-1' }),
    })
    const post = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({ sid: 'sess-1', round: 1, tag: 'h-A', message: 'hi', source: 'browser', ts: 1 }),
    })
    expect(post.headers.get('access-control-allow-origin')).toBe('*')
    const postBody = (await post.json()) as { accepted: number }
    expect(postBody.accepted).toBe(1)

    const read = await fetch(`${base}/logs?sid=sess-1&round=1`)
    const body = (await read.json()) as { total: number; entries: { message: string }[] }
    expect(body.total).toBe(1)
    expect(body.entries[0]!.message).toBe('hi')
  })

  it('accepts a batch of entries in one ingest', async () => {
    const { base } = await startServer()
    const res = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { sid: 'b', round: 1, message: '1', source: 'node' },
        { sid: 'b', round: 1, message: '2', source: 'node' },
      ]),
    })
    const body = (await res.json()) as { accepted: number }
    expect(body.accepted).toBe(2)
  })
})

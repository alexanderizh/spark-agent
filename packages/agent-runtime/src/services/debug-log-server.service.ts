/**
 * @module debug-log-server.service
 *
 * Debug Log Server
 *
 * A long-lived, lightweight HTTP server that runs inside the Electron main
 * process for Spark's "调试模式 (debug mode)". It does two jobs:
 *
 *   1. **Receives runtime debug logs** from the app under test — including
 *      browser / webview / frontend code, which post from a *different*
 *      origin. CORS (incl. Private Network Access) is therefore fully
 *      handled; see `applyCors`.
 *   2. **Holds per-debug-session state** (round counter, hypothesis ledger,
 *      ring-buffered log entries) so it survives across conversation turns —
 *      the user reproduces a bug *between* turns, and the per-session MCP
 *      child process may restart, so this buffer cannot live in either.
 *
 * The `debug-mode-mcp-server.mjs` child process is a thin bridge that proxies
 * the agent's tool calls (`begin/read/next_round/status/finish`) to this
 * server over `http://127.0.0.1:<port>`. The port + spark session id are
 * injected into that child via `SPARK_DEBUG_LOG_PORT` / `SPARK_DEBUG_SID`.
 *
 * Security: binds 127.0.0.1 only; `sid` is an unguessable token (the spark
 * session id) that isolates sessions. `Access-Control-Allow-Origin: *` is
 * acceptable *only* because the server is loopback-bound and sid-gated — do
 * not reuse this server on a public interface.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createLogger } from '@spark/shared'

const log = createLogger('debug-log-server')

/** Ring-buffer cap per debug session — oldest entries are dropped past this. */
const MAX_ENTRIES_PER_SESSION = 5000
/** Hard cap on a single ingest body to protect the main process. */
const MAX_BODY_BYTES = 256 * 1024

export type DebugLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface DebugEntry {
  sid: string
  round: number
  tag: string
  level: DebugLogLevel
  message: string
  data?: unknown
  /** 'browser' | 'node' | ... — where the log was emitted from. */
  source: string
  /** Client-side timestamp (ms). */
  ts: number
  /** Server-side landing timestamp (ms). */
  receivedAt: number
}

export interface DebugHypothesis {
  round: number
  text: string
}

interface DebugSessionState {
  sid: string
  round: number
  hypotheses: DebugHypothesis[]
  entries: DebugEntry[]
  createdAt: number
}

const LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error'])

// ─── Service ──────────────────────────────────────────────────────────

export class DebugLogServer {
  private server: Server | null = null
  private port = 0
  private readonly sessions = new Map<string, DebugSessionState>()

  getPort(): number {
    return this.port
  }

  isRunning(): boolean {
    return this.server != null && this.port > 0
  }

  /** Idempotent — repeated calls return the already-bound port. */
  async start(): Promise<number> {
    if (this.server != null) return this.port

    return new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.applyCors(req, res)
          this.sendJson(res, 500, { ok: false, error: String(err) })
        })
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr != null) {
          this.server = server
          this.port = addr.port
          log.info(`Debug log server listening on 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to get debug log server port'))
        }
      })

      server.on('error', (err) => {
        log.error(`Debug log server error: ${err}`)
        reject(err)
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server == null) return
    await new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.port = 0
        resolve()
      })
    })
  }

  // ── Session state (also used directly by unit tests) ──

  /** Create-or-return the state for a debug session keyed by `sid`. */
  ensureSession(sid: string): DebugSessionState {
    let state = this.sessions.get(sid)
    if (state == null) {
      state = { sid, round: 1, hypotheses: [], entries: [], createdAt: Date.now() }
      this.sessions.set(sid, state)
    }
    return state
  }

  ingest(raw: Partial<DebugEntry> & { sid?: string }): DebugEntry | null {
    const sid = typeof raw.sid === 'string' ? raw.sid : ''
    if (!sid) return null
    const state = this.ensureSession(sid)
    const entry: DebugEntry = {
      sid,
      round: Number.isFinite(raw.round) ? Number(raw.round) : state.round,
      tag: typeof raw.tag === 'string' ? raw.tag : 'untagged',
      level: LEVELS.has(raw.level as string) ? (raw.level as DebugLogLevel) : 'debug',
      message: typeof raw.message === 'string' ? raw.message : '',
      data: raw.data,
      source: typeof raw.source === 'string' ? raw.source : 'unknown',
      ts: Number.isFinite(raw.ts) ? Number(raw.ts) : Date.now(),
      receivedAt: Date.now(),
    }
    state.entries.push(entry)
    // Ring-buffer: drop oldest beyond the cap.
    if (state.entries.length > MAX_ENTRIES_PER_SESSION) {
      state.entries.splice(0, state.entries.length - MAX_ENTRIES_PER_SESSION)
    }
    return entry
  }

  getLogs(sid: string, round?: number): { entries: DebugEntry[]; total: number; round: number } {
    const state = this.ensureSession(sid)
    const target = round ?? state.round
    const entries = state.entries.filter((e) => e.round === target)
    return { entries, total: entries.length, round: target }
  }

  nextRound(sid: string, hypothesis: string): { round: number } {
    const state = this.ensureSession(sid)
    state.round += 1
    if (hypothesis.trim()) {
      state.hypotheses.push({ round: state.round, text: hypothesis.trim() })
    }
    return { round: state.round }
  }

  status(sid: string): {
    round: number
    total: number
    thisRound: number
    hypotheses: DebugHypothesis[]
  } {
    const state = this.ensureSession(sid)
    const thisRound = state.entries.filter((e) => e.round === state.round).length
    return {
      round: state.round,
      total: state.entries.length,
      thisRound,
      hypotheses: state.hypotheses,
    }
  }

  /** Wipe a debug session's buffered logs (called at delivery / `finish`). */
  clear(sid: string): { cleared: number } {
    const state = this.sessions.get(sid)
    if (state == null) return { cleared: 0 }
    const cleared = state.entries.length
    state.entries = []
    return { cleared }
  }

  /** Remove a debug session bucket entirely (called when the Spark session is deleted). */
  deleteSession(sid: string): { cleared: number } {
    const state = this.sessions.get(sid)
    if (state == null) return { cleared: 0 }
    const cleared = state.entries.length
    this.sessions.delete(sid)
    return { cleared }
  }

  // ── HTTP handling ──

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.applyCors(req, res)

    if (req.method === 'OPTIONS') {
      // CORS preflight (incl. Private Network Access) — headers already set.
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    try {
      // ── ingest (the hot path: app-under-test posts logs here) ──
      if (req.method === 'POST' && path === '/ingest') {
        const body = await this.readBody(req)
        const payload = this.parseJson(body)
        // Accept a single entry or a batch.
        const items = Array.isArray(payload) ? payload : [payload]
        let accepted = 0
        for (const item of items) {
          if (this.ingest(item as Partial<DebugEntry>) != null) accepted += 1
        }
        this.sendJson(res, 200, { ok: true, accepted })
        return
      }

      // ── session lifecycle / reads (called by the MCP bridge) ──
      if (req.method === 'POST' && path === '/session') {
        const body = await this.readBody(req)
        const payload = this.parseJson(body) as { sid?: string }
        const sid = typeof payload?.sid === 'string' && payload.sid ? payload.sid : randomSid()
        const state = this.ensureSession(sid)
        this.sendJson(res, 200, { ok: true, sid, port: this.port, round: state.round })
        return
      }

      if (req.method === 'GET' && path === '/logs') {
        const sid = url.searchParams.get('sid') ?? ''
        if (!sid) return void this.sendJson(res, 400, { ok: false, error: 'Missing sid' })
        const roundParam = url.searchParams.get('round')
        const round = roundParam != null ? Number(roundParam) : undefined
        this.sendJson(res, 200, { ok: true, ...this.getLogs(sid, round) })
        return
      }

      if (req.method === 'POST' && path === '/round') {
        const body = await this.readBody(req)
        const payload = this.parseJson(body) as { sid?: string; hypothesis?: string }
        const sid = typeof payload?.sid === 'string' ? payload.sid : ''
        if (!sid) return void this.sendJson(res, 400, { ok: false, error: 'Missing sid' })
        const { round } = this.nextRound(sid, String(payload?.hypothesis ?? ''))
        this.sendJson(res, 200, { ok: true, round })
        return
      }

      if (req.method === 'GET' && path === '/status') {
        const sid = url.searchParams.get('sid') ?? ''
        if (!sid) return void this.sendJson(res, 400, { ok: false, error: 'Missing sid' })
        this.sendJson(res, 200, { ok: true, ...this.status(sid) })
        return
      }

      if (req.method === 'DELETE' && path === '/logs') {
        const sid = url.searchParams.get('sid') ?? ''
        if (!sid) return void this.sendJson(res, 400, { ok: false, error: 'Missing sid' })
        this.sendJson(res, 200, { ok: true, ...this.clear(sid) })
        return
      }

      this.sendJson(res, 404, { ok: false, error: 'Not found' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Debug log request error [${req.method} ${path}]: ${message}`)
      // Never 500 on the ingest path — instrumentation must not break the app.
      this.sendJson(res, 200, { ok: false, error: message })
    }
  }

  /**
   * CORS — applied to *every* response (incl. errors and OPTIONS preflight).
   * Browser-context logs post from a different origin; https pages hitting
   * http://127.0.0.1 additionally trigger a Private Network Access preflight
   * that must be answered with `Access-Control-Allow-Private-Network: true`,
   * or Chrome silently drops every browser-side log.
   */
  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Max-Age', '86400')
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true')
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          // Stop accumulating; truncate to the cap.
          reject(new Error('Body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private parseJson(body: string): unknown {
    if (!body.trim()) return {}
    return JSON.parse(body)
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}

function randomSid(): string {
  return `dbg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ─── Singleton ────────────────────────────────────────────────────────

let singleton: DebugLogServer | null = null

/** Process-wide singleton — the buffer must outlive individual turns. */
export function getDebugLogServer(): DebugLogServer {
  if (singleton == null) singleton = new DebugLogServer()
  return singleton
}

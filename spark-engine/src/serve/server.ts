import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

import { errorMessage } from '../config/config-file.js'
import type { AgentEvent } from '../events/schema.js'
import type { Agent, AgentSession } from '../sdk/agent.js'
import { isImageMediaType, type TurnImageAttachment } from '../images/attachments.js'
import type { ServeApprover } from './approver.js'
import type { PermissionDecision } from '../permission/types.js'

/**
 * `spark serve` — the versioned App Server protocol (v1).
 *
 * A loopback-only HTTP + SSE surface that lets an embedding host (the desktop
 * app) drive the CLI as an execution kernel:
 *
 *   GET  /v1/health                    → engine/protocol identity
 *   POST /v1/sessions                  → new (or resumed) session id
 *   POST /v1/sessions/:id/turns        → SSE stream of AgentEvent JSON
 *   GET  /v1/sessions/:id/events       → JSONL replay from the ledger
 *   POST /v1/sessions/:id/cancel       → abort the active turn
 *   GET  /v1/approvals                 → pending tool approvals
 *   POST /v1/approvals/:requestId      → answer one tool approval
 *
 * Every request needs the bearer token that was printed in the startup
 * handshake. The server binds the loopback interface by default; it is a local
 * automation surface, not a network service.
 */

export const SERVE_PROTOCOL_VERSION = 1

const MAX_BODY_BYTES = 10 * 1024 * 1024

export interface ServeServerOptions {
  readonly agent: Agent
  readonly engineVersion: string
  /** Protocol-side approver; tool approvals wait for host decisions on it. */
  readonly approver: ServeApprover
  /**
   * Post-turn hook (e.g. memory auto-extraction). Receives the full session
   * event history after a terminal event; errors are logged, never raised.
   */
  readonly onTurnFinished?: (sessionId: string, events: readonly AgentEvent[]) => Promise<void>
  readonly model?: string
  readonly host?: string
  readonly port?: number
  readonly log?: (line: string) => void
}

export interface ServeHandshake {
  readonly protocolVersion: number
  readonly pid: number
  readonly port: number
  readonly token: string
}

export interface ServeServerHandle {
  readonly server: Server
  readonly handshake: ServeHandshake
  close(): Promise<void>
}

interface ActiveTurn {
  readonly controller: AbortController
  readonly turnId: string
}

export function startServeServer(options: ServeServerOptions): Promise<ServeServerHandle> {
  const token = randomUUID()
  const sessions = new Map<string, AgentSession>()
  const activeTurns = new Map<string, ActiveTurn>()

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      writeJson(response, 500, { error: { code: 'internal', message: errorMessage(error) } })
    })
  })

  function log(line: string): void {
    options.log?.(line)
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (!isAuthorized(request, token)) {
      writeJson(response, 401, {
        error: { code: 'unauthorized', message: 'Bearer token required' },
      })
      return
    }

    if (request.method === 'GET' && path === '/v1/health') {
      writeJson(response, 200, {
        protocolVersion: SERVE_PROTOCOL_VERSION,
        engineVersion: options.engineVersion,
        model: options.model ?? null,
        sessions: sessions.size,
        activeTurns: activeTurns.size,
      })
      return
    }

    if (request.method === 'POST' && path === '/v1/sessions') {
      const body = await readJsonBody(response, request)
      if (body === undefined) return
      const permissionMode = stringField(body, 'permissionMode')
      const resume = stringField(body, 'resume')
      try {
        if (resume !== '') {
          const session = await options.agent.openSession(resume)
          sessions.set(session.sessionId, session)
          writeJson(response, 200, { sessionId: session.sessionId, resumed: true })
          return
        }
        const session = await options.agent.newSession(
          permissionMode === '' ? {} : { permissionMode },
        )
        sessions.set(session.sessionId, session)
        writeJson(response, 200, { sessionId: session.sessionId, resumed: false })
      } catch (error) {
        writeJson(response, 404, {
          error: { code: 'session_not_found', message: errorMessage(error) },
        })
      }
      return
    }

    const turnMatch = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(path)
    if (request.method === 'POST' && turnMatch?.[1] !== undefined) {
      const session = sessions.get(turnMatch[1])
      if (session === undefined) {
        writeJson(response, 404, {
          error: { code: 'session_not_found', message: 'Unknown session' },
        })
        return
      }
      if (activeTurns.has(session.sessionId)) {
        writeJson(response, 409, {
          error: { code: 'turn_in_progress', message: 'A turn is already running in this session' },
        })
        return
      }
      const body = await readJsonBody(response, request)
      if (body === undefined) return
      const input = stringField(body, 'input')
      if (input === '') {
        writeJson(response, 400, { error: { code: 'invalid_input', message: 'input is required' } })
        return
      }
      let images: TurnImageAttachment[] | undefined
      if (Array.isArray(body.images)) {
        const parsed = parseImages(body.images)
        if (parsed.error !== undefined) {
          writeJson(response, 400, { error: { code: 'invalid_input', message: parsed.error } })
          return
        }
        images = parsed.images
      }

      const controller = new AbortController()
      const turnId = `pending-${randomUUID()}`
      activeTurns.set(session.sessionId, { controller, turnId })
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      log(`turn started session=${session.sessionId}`)

      // A dropped SSE connection aborts the turn: the host owns the turn's
      // lifecycle for as long as it keeps the stream open.
      request.on('close', () => {
        if (
          activeTurns.get(session.sessionId)?.controller === controller &&
          !controller.signal.aborted
        ) {
          controller.abort('client disconnected')
        }
      })

      try {
        const result = await session.turn(input, {
          signal: controller.signal,
          ...(images === undefined ? {} : { images }),
          onEvent: (event: AgentEvent) => {
            writeSse(response, 'agent-event', JSON.stringify(event))
          },
        })
        activeTurns.delete(session.sessionId)
        writeSse(
          response,
          'done',
          JSON.stringify({ turnId: result.turnId, terminal: result.terminal }),
        )
        response.end()
        log(`turn finished session=${session.sessionId} terminal=${result.terminal.type}`)
        if (options.onTurnFinished !== undefined && result.terminal.type === 'turn.completed') {
          try {
            const events: AgentEvent[] = []
            for await (const event of session.events()) events.push(event)
            await options.onTurnFinished(session.sessionId, events)
          } catch (error) {
            log(`post-turn hook failed session=${session.sessionId}: ${errorMessage(error)}`)
          }
        }
      } catch (error) {
        activeTurns.delete(session.sessionId)
        // The ledger already recorded the terminal event for engine-level
        // failures; a transport crash mid-stream is reported as a server error.
        writeSse(response, 'error', JSON.stringify({ message: errorMessage(error) }))
        response.end()
        log(`turn failed session=${session.sessionId}: ${errorMessage(error)}`)
      }
      return
    }

    const eventsMatch = /^\/v1\/sessions\/([^/]+)\/events$/.exec(path)
    if (request.method === 'GET' && eventsMatch?.[1] !== undefined) {
      const session = sessions.get(eventsMatch[1])
      if (session === undefined) {
        writeJson(response, 404, {
          error: { code: 'session_not_found', message: 'Unknown session' },
        })
        return
      }
      const fromSeq = Number(url.searchParams.get('fromSeq') ?? '0')
      response.writeHead(200, {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-cache',
      })
      for await (const event of session.events(
        Number.isFinite(fromSeq) && fromSeq > 0 ? fromSeq : 0,
      )) {
        response.write(`${JSON.stringify(event)}\n`)
      }
      response.end()
      return
    }

    if (request.method === 'GET' && path === '/v1/approvals') {
      writeJson(response, 200, { pending: options.approver.listPending() })
      return
    }

    const approvalMatch = /^\/v1\/approvals\/([^/]+)$/.exec(path)
    if (request.method === 'POST' && approvalMatch?.[1] !== undefined) {
      const body = await readJsonBody(response, request)
      if (body === undefined) return
      const verdict = stringField(body, 'decision')
      if (verdict !== 'allow' && verdict !== 'deny') {
        writeJson(response, 400, {
          error: { code: 'invalid_decision', message: "decision must be 'allow' or 'deny'" },
        })
        return
      }
      const grantScope = stringField(body, 'grantScope')
      if (grantScope !== '' && grantScope !== 'once' && grantScope !== 'session') {
        writeJson(response, 400, {
          error: { code: 'invalid_grant_scope', message: "grantScope must be 'once' or 'session'" },
        })
        return
      }
      const reason = stringField(body, 'reason')
      const decision: PermissionDecision = {
        decision: verdict,
        ...(grantScope === '' ? {} : { grantScope: grantScope }),
        ...(reason === '' ? {} : { reason }),
      }
      if (!options.approver.answer(approvalMatch[1], decision)) {
        writeJson(response, 404, {
          error: { code: 'approval_not_found', message: 'No pending approval with that id' },
        })
        return
      }
      writeJson(response, 200, { answered: true, requestId: approvalMatch[1] })
      return
    }

    const cancelMatch = /^\/v1\/sessions\/([^/]+)\/cancel$/.exec(path)
    if (request.method === 'POST' && cancelMatch?.[1] !== undefined) {
      const active = activeTurns.get(cancelMatch[1])
      if (active === undefined) {
        writeJson(response, 409, {
          error: { code: 'no_active_turn', message: 'No turn is running' },
        })
        return
      }
      active.controller.abort('cancelled via API')
      writeJson(response, 200, { cancelled: true, turnId: active.turnId })
      return
    }

    writeJson(response, 404, {
      error: { code: 'not_found', message: `No route: ${request.method} ${path}` },
    })
  }

  return new Promise((resolveHandle) => {
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolveHandle({
        server,
        handshake: { protocolVersion: SERVE_PROTOCOL_VERSION, pid: process.pid, port, token },
        close: async () => {
          for (const active of activeTurns.values()) active.controller.abort('server shutting down')
          options.approver.rejectAll('server shutting down')
          await new Promise<void>((resolveClose) =>
            server.close(() => {
              resolveClose()
            }),
          )
        },
      })
    })
  })
}

function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  if (presented === '') return false
  const expected = Buffer.from(token, 'utf8')
  const actual = Buffer.from(presented, 'utf8')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

async function readJsonBody(
  response: ServerResponse,
  request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) {
      writeJson(response, 413, {
        error: { code: 'payload_too_large', message: 'Body exceeds 10MB' },
      })
      return undefined
    }
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      writeJson(response, 400, {
        error: { code: 'invalid_json', message: 'Body must be a JSON object' },
      })
      return undefined
    }
    return parsed as Record<string, unknown>
  } catch {
    writeJson(response, 400, { error: { code: 'invalid_json', message: 'Body is not valid JSON' } })
    return undefined
  }
}

function parseImages(images: readonly unknown[]): {
  readonly images?: TurnImageAttachment[]
  readonly error?: string
} {
  const parsed: TurnImageAttachment[] = []
  for (const item of images) {
    if (typeof item !== 'object' || item === null) return { error: 'each image must be an object' }
    const record = item as Record<string, unknown>
    const mediaType = stringField(record, 'mediaType')
    const base64 = stringField(record, 'base64')
    if (mediaType === '' || base64 === '') {
      return { error: 'each image requires mediaType and base64' }
    }
    if (!isImageMediaType(mediaType)) {
      return { error: `unsupported image mediaType: ${mediaType}` }
    }
    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) return { error: 'image base64 payload is empty' }
    const name = stringField(record, 'name')
    const width = numberField(record, 'width')
    const height = numberField(record, 'height')
    parsed.push({
      bytes,
      mediaType,
      ...(name === '' ? {} : { name }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    })
  }
  return parsed.length === 0 ? { error: 'images must not be empty' } : { images: parsed }
}

function writeJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(`${JSON.stringify(payload)}\n`)
}

function writeSse(response: ServerResponse, event: string, data: string): void {
  response.write(`event: ${event}\ndata: ${data}\n\n`)
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

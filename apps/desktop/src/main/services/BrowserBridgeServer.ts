import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createLogger } from '@spark/shared'
import {
  getInternalBrowserService,
  InternalBrowserError,
} from './InternalBrowserService.js'

const log = createLogger('browser-bridge')
const MAX_BODY_BYTES = 256 * 1024

export class BrowserBridgeServer {
  private server: Server | null = null
  private port = 0
  private readonly allowedSids = new Set<string>()

  getPort(): number {
    return this.port
  }

  allowSid(sid: string): void {
    if (sid.trim()) this.allowedSids.add(sid)
  }

  async start(): Promise<number> {
    if (this.server != null) return this.port
    return new Promise<number>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.applyCors(req, res)
          this.sendError(res, 500, 'BROWSER_BRIDGE_ERROR', err instanceof Error ? err.message : String(err))
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (typeof addr === 'object' && addr != null) {
          this.server = server
          this.port = addr.port
          log.info(`Browser bridge listening on 127.0.0.1:${this.port}`)
          resolve(this.port)
        } else {
          reject(new Error('Failed to get browser bridge port'))
        }
      })
      server.on('error', reject)
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.applyCors(req, res)
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname
    try {
      const body = req.method === 'GET' ? {} : this.parseJson(await this.readBody(req))
      const sid = this.readSid(url, body)
      if (!sid) return this.sendError(res, 400, 'MISSING_SID', 'Missing sid')
      if (!this.allowedSids.has(sid)) return this.sendError(res, 403, 'INVALID_SID', 'Invalid sid')
      const service = getInternalBrowserService()

      if (req.method === 'POST' && path === '/open') {
        const payload = body as { url?: string; show?: boolean; profileId?: string; reuse?: boolean }
        return this.sendJson(res, 200, { ok: true, ...(await service.openWindow(payload)) })
      }
      if (req.method === 'POST' && path === '/navigate') {
        const payload = body as { windowId?: string; url?: string }
        return this.sendJson(res, 200, { ok: true, ...(await service.navigate(payload.windowId, String(payload.url ?? ''))) })
      }
      if (req.method === 'POST' && path === '/eval') {
        const payload = body as { windowId?: string; code?: string }
        return this.sendJson(res, 200, { ok: true, result: await service.evalJs(payload.windowId, String(payload.code ?? '')) })
      }
      if (req.method === 'POST' && path === '/inject') {
        const payload = body as { windowId?: string; code?: string; scriptId?: string }
        return this.sendJson(res, 200, { ok: true, ...(await service.injectScript(payload.windowId, String(payload.code ?? ''), payload.scriptId)) })
      }
      if (req.method === 'POST' && path === '/remove_script') {
        const payload = body as { windowId?: string; scriptId?: string }
        return this.sendJson(res, 200, { ...service.removeScript(payload.windowId, String(payload.scriptId ?? '')), ok: true })
      }
      if (req.method === 'GET' && path === '/screenshot') {
        return this.sendJson(res, 200, { ok: true, ...(await service.screenshot(url.searchParams.get('windowId') ?? undefined)) })
      }
      if (req.method === 'GET' && path === '/url') {
        return this.sendJson(res, 200, { ok: true, ...service.getUrl(url.searchParams.get('windowId') ?? undefined) })
      }
      if (req.method === 'GET' && path === '/title') {
        return this.sendJson(res, 200, { ok: true, ...service.getTitle(url.searchParams.get('windowId') ?? undefined) })
      }
      if (req.method === 'GET' && path === '/windows') {
        return this.sendJson(res, 200, { ok: true, windows: service.listWindows() })
      }
      if (req.method === 'POST' && path === '/close') {
        const payload = body as { windowId?: string }
        return this.sendJson(res, 200, { ...service.closeWindow(payload.windowId), ok: true })
      }
      if (req.method === 'POST' && path === '/console/start') {
        const payload = body as { windowId?: string }
        return this.sendJson(res, 200, { ...service.startConsoleCapture(payload.windowId), ok: true })
      }
      if (req.method === 'GET' && path === '/console/events') {
        return this.sendJson(res, 200, {
          ok: true,
          ...service.getConsoleEvents(
            url.searchParams.get('windowId') ?? undefined,
            Number(url.searchParams.get('sinceSeq') ?? '0'),
          ),
        })
      }
      if (req.method === 'POST' && path === '/console/clear') {
        const payload = body as { windowId?: string }
        return this.sendJson(res, 200, { ...service.clearConsoleEvents(payload.windowId), ok: true })
      }
      if (req.method === 'POST' && path === '/network/rules') {
        const payload = body as { windowId?: string; rules?: Array<Record<string, unknown>> }
        return this.sendJson(res, 200, { ok: true, ...service.setNetworkRules(payload.windowId, payload.rules ?? []) })
      }
      if (req.method === 'GET' && path === '/network/events') {
        return this.sendJson(res, 200, {
          ok: true,
          ...service.getNetworkEvents(
            url.searchParams.get('windowId') ?? undefined,
            Number(url.searchParams.get('sinceSeq') ?? '0'),
          ),
        })
      }
      if (req.method === 'POST' && path === '/network/clear') {
        const payload = body as { windowId?: string; ruleIds?: string[] }
        return this.sendJson(res, 200, { ...service.clearNetwork(payload.windowId, payload.ruleIds), ok: true })
      }
      if (req.method === 'POST' && path === '/profile/clear') {
        const payload = body as { profileId?: string; scope?: string[] }
        return this.sendJson(res, 200, { ...(await service.clearProfile(String(payload.profileId ?? ''), payload.scope)), ok: true })
      }

      return this.sendError(res, 404, 'NOT_FOUND', 'Not found')
    } catch (err) {
      if (err instanceof InternalBrowserError) {
        return this.sendJson(res, 200, { ok: false, error: { code: err.code, message: err.message, ...err.context } })
      }
      return this.sendJson(res, 200, {
        ok: false,
        error: { code: 'BROWSER_BRIDGE_ERROR', message: err instanceof Error ? err.message : String(err) },
      })
    }
  }

  private readSid(url: URL, body: unknown): string {
    const querySid = url.searchParams.get('sid')
    if (querySid != null) return querySid
    if (body != null && typeof body === 'object' && 'sid' in body) {
      const sid = (body as { sid?: unknown }).sid
      return typeof sid === 'string' ? sid : ''
    }
    return ''
  }

  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
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

  private sendError(res: ServerResponse, status: number, code: string, message: string): void {
    this.sendJson(res, status, { ok: false, error: { code, message } })
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) return
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}

let singleton: BrowserBridgeServer | null = null

export function getBrowserBridgeServer(): BrowserBridgeServer {
  if (singleton == null) singleton = new BrowserBridgeServer()
  return singleton
}

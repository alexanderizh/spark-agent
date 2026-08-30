import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { CustomToolRecord } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import type { CustomToolService } from './custom-tool.service.js'

const log = createLogger('custom-tools:bridge')
const MAX_REQUEST_BYTES = 1_048_576

interface RpcRequest {
  method?: unknown
  params?: unknown
}

export interface CustomToolsBridgeInfo {
  port: number
  token: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isAgentExposed(record: CustomToolRecord): boolean {
  // Provider vision consumes local attachments and is routed by the trusted
  // session host. Never give an arbitrary model a local-path reading primitive.
  return record.type === 'http'
}

export class CustomToolsBridgeService {
  private server: Server | null = null
  private info: CustomToolsBridgeInfo | null = null

  constructor(private readonly service: CustomToolService) {}

  async start(): Promise<CustomToolsBridgeInfo> {
    if (this.info != null) return this.info
    const token = randomBytes(32).toString('hex')
    const server = createServer((request, response) => {
      void this.handle(request, response, token)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    if (address == null || typeof address === 'string') {
      server.close()
      throw new Error('Custom tools bridge failed to bind a local port')
    }
    this.server = server
    this.info = { port: address.port, token }
    log.info('custom tools bridge started', { port: address.port })
    return this.info
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.info = null
    if (server == null) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    token: string,
  ): Promise<void> {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (request.method !== 'POST' || request.url !== '/rpc') {
      response.statusCode = 404
      response.end(JSON.stringify({ ok: false, error: 'Not found' }))
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401
      response.end(JSON.stringify({ ok: false, error: 'Unauthorized' }))
      return
    }
    try {
      const payload = (await this.readJson(request)) as RpcRequest
      const method = typeof payload.method === 'string' ? payload.method : ''
      const params = asRecord(payload.params)
      const data =
        method === 'customTools.list'
          ? this.listTools()
          : method === 'customTools.call'
            ? await this.callTool(params)
            : (() => {
                throw new Error(`Unknown custom tools RPC method: ${method}`)
              })()
      response.statusCode = 200
      response.end(JSON.stringify({ ok: true, data }))
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    }
  }

  private listTools(): { tools: Array<Record<string, unknown>> } {
    return {
      tools: this.service
        .listEnabledRecords()
        .filter(isAgentExposed)
        .map((record) => ({
          name: record.id,
          title: record.title,
          description: record.description,
          inputSchema: record.inputSchema,
          risk: record.risk,
          effect: record.effect,
          idempotency: record.idempotency,
        })),
    }
  }

  private async callTool(params: Record<string, unknown>) {
    const toolId = typeof params.toolId === 'string' ? params.toolId : ''
    if (!toolId) throw new Error('toolId is required')
    const record = this.service.listEnabledRecords().find((item) => item.id === toolId)
    if (record == null || !isAgentExposed(record)) throw new Error(`Tool is unavailable: ${toolId}`)
    const input = asRecord(params.input)
    return this.service.executeEnabled({
      toolId,
      input,
      ...(typeof params.sessionId === 'string' && params.sessionId
        ? { sessionId: params.sessionId }
        : {}),
    })
  }

  private async readJson(request: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > MAX_REQUEST_BYTES) throw new Error('Custom tools RPC request is too large')
      chunks.push(buffer)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
}

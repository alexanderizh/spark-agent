import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createLogger } from '@spark/shared'

const log = createLogger('computer-use-agent-bridge')
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const SESSION_TOKEN_TTL_MS = 15 * 60 * 1_000

const ALLOWED_TOOLS = new Set([
  'get_capabilities',
  'capture_app_snapshot',
  'start_task',
  'get_status',
  'pause',
  'resume',
  'stop',
  'takeover',
])

const VERIFICATION_SPEC_INPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'accessibility' },
        selector: {
          type: 'object',
          properties: {
            elementId: { type: 'string', minLength: 1, maxLength: 200 },
            role: { type: 'string', minLength: 1, maxLength: 120 },
            name: { type: 'string', maxLength: 1_000 },
          },
          minProperties: 1,
          additionalProperties: false,
        },
        assertion: {
          oneOf: [
            ...['exists', 'visible', 'enabled', 'focused'].map((operator) => ({
              type: 'object',
              properties: { operator: { const: operator }, expected: { type: 'boolean' } },
              required: ['operator', 'expected'],
              additionalProperties: false,
            })),
            ...['value_equals', 'text_contains'].map((operator) => ({
              type: 'object',
              properties: {
                operator: { const: operator },
                expected: { type: 'string', maxLength: 100_000 },
              },
              required: ['operator', 'expected'],
              additionalProperties: false,
            })),
          ],
        },
      },
      required: ['kind', 'selector', 'assertion'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'visual' },
        assertion: {
          oneOf: ['text_present', 'text_absent'].map((operator) => ({
            type: 'object',
            properties: {
              operator: { const: operator },
              expected: { type: 'string', minLength: 1, maxLength: 20_000 },
            },
            required: ['operator', 'expected'],
            additionalProperties: false,
          })),
        },
      },
      required: ['kind', 'assertion'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        kind: { const: 'application_state' },
        appId: { type: 'string', minLength: 1, maxLength: 200 },
        assertion: {
          oneOf: [
            ...['running', 'frontmost', 'window_exists'].map((operator) => ({
              type: 'object',
              properties: { operator: { const: operator }, expected: { type: 'boolean' } },
              required: ['operator', 'expected'],
              additionalProperties: false,
            })),
            {
              type: 'object',
              properties: {
                operator: { const: 'window_title_contains' },
                expected: { type: 'string', maxLength: 2_000 },
              },
              required: ['operator', 'expected'],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ['kind', 'appId', 'assertion'],
      additionalProperties: false,
    },
  ],
} as const

const MCP_TOOLS = [
  {
    name: 'get_capabilities',
    description:
      'Read trusted Computer Use permissions, feature flags, and governed task availability. Call this before claiming computer-control ability.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'capture_app_snapshot',
    description: 'Capture the focused application through the governed snapshot service.',
    inputSchema: {
      type: 'object',
      properties: {
        accessibleTextMode: { type: 'string', enum: ['visible_only', 'app_exposed'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'start_task',
    description:
      'Start a governed Computer Use task. The Broker owns observation, actions, approval, stop, and verification.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', minLength: 1, maxLength: 4_000 },
        environment: { type: 'string', enum: ['safe_browser', 'safe_desktop', 'my_desktop'] },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string', maxLength: 1_000 },
          maxItems: 50,
        },
        successCriteria: {
          type: 'array',
          description:
            'Deterministic VerificationSpec objects. Supported kinds are accessibility, visual with text_present/text_absent, and application_state.',
          items: VERIFICATION_SPEC_INPUT_SCHEMA,
          minItems: 1,
          maxItems: 100,
        },
      },
      required: ['goal', 'environment'],
      additionalProperties: false,
    },
  },
  ...['get_status', 'pause', 'resume', 'stop', 'takeover'].map((name) => ({
    name,
    description: `${name.replace('_', ' ')} a governed Computer Use task by computerSessionId.`,
    inputSchema: {
      type: 'object',
      properties: { computerSessionId: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['computerSessionId'],
      additionalProperties: false,
    },
  })),
] as const

interface SessionGrant {
  sessionId: string
  expiresAt: number
}

export interface ComputerUseAgentBridgeController {
  invoke(sessionId: string, toolName: string, args: unknown): Promise<unknown>
}

export class ComputerUseAgentBridge {
  private readonly controller: ComputerUseAgentBridgeController
  private readonly maxBodyBytes: number
  private readonly grants = new Map<string, SessionGrant>()
  private server: Server | null = null
  private port = 0

  constructor(options: ComputerUseAgentBridgeController & { maxBodyBytes?: number }) {
    this.controller = options
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  }

  async issueSession(sessionId: string): Promise<{ port: number; token: string }> {
    if (sessionId.trim() === '') throw new Error('Computer Use Agent session id is required')
    const port = await this.start()
    this.removeExpiredGrants()
    this.revokeSession(sessionId)
    const token = randomBytes(32).toString('base64url')
    this.grants.set(token, { sessionId, expiresAt: Date.now() + SESSION_TOKEN_TTL_MS })
    return { port, token }
  }

  revokeSession(sessionId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.sessionId === sessionId) this.grants.delete(token)
    }
  }

  async stop(): Promise<void> {
    this.grants.clear()
    if (this.server == null) return
    const server = this.server
    this.server = null
    this.port = 0
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private start(): Promise<number> {
    if (this.server != null) return Promise.resolve(this.port)
    return new Promise((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response)
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (typeof address !== 'object' || address == null) {
          server.close()
          reject(new Error('Computer Use Agent bridge did not receive a TCP address'))
          return
        }
        server.removeListener('error', reject)
        server.on('error', (error) => log.error('Computer Use Agent bridge error', error))
        this.server = server
        this.port = address.port
        resolve(address.port)
      })
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || (request.url !== '/invoke' && request.url !== '/mcp')) {
      return this.send(response, 404, { ok: false, error: { code: 'NOT_FOUND' } })
    }
    const grant = this.authorize(request)
    if (grant == null) {
      return this.send(response, 401, {
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired Computer Use capability' },
      })
    }

    try {
      const body = await this.readBody(request)
      if (body.tooLarge) {
        return this.send(response, 413, {
          ok: false,
          error: { code: 'BODY_TOO_LARGE', message: 'Computer Use request body is too large' },
        })
      }
      if (request.url === '/mcp') return this.handleMcpRequest(response, grant, body.text)
      const payload = parseInvocation(body.text)
      if (!ALLOWED_TOOLS.has(payload.toolName)) {
        return this.send(response, 400, {
          ok: false,
          error: { code: 'UNKNOWN_TOOL', message: 'Unknown Computer Use task tool' },
        })
      }
      const data = await this.controller.invoke(grant.sessionId, payload.toolName, payload.args)
      return this.send(response, 200, { ok: true, data })
    } catch (error) {
      const safe = toSafeError(error)
      return this.send(response, safe.status, {
        ok: false,
        error: { code: safe.code, message: safe.message },
      })
    }
  }

  private async handleMcpRequest(
    response: ServerResponse,
    grant: SessionGrant,
    text: string,
  ): Promise<void> {
    const request = parseMcpRequest(text)
    if (request.id === undefined) {
      response.writeHead(202, { 'cache-control': 'no-store' })
      response.end()
      return
    }
    if (request.method === 'initialize') {
      return this.send(response, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'spark-computer', version: '0.1.0' },
        },
      })
    }
    if (request.method === 'ping') {
      return this.send(response, 200, { jsonrpc: '2.0', id: request.id, result: {} })
    }
    if (request.method === 'tools/list') {
      return this.send(response, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: { tools: MCP_TOOLS },
      })
    }
    if (request.method !== 'tools/call') {
      return this.send(response, 200, {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: 'Method not found' },
      })
    }
    const invocation = parseMcpToolCall(request.params)
    try {
      const data = await this.controller.invoke(
        grant.sessionId,
        invocation.toolName,
        invocation.args,
      )
      return this.send(response, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        },
      })
    } catch (error) {
      const safe = toSafeError(error)
      return this.send(response, 200, {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          content: [{ type: 'text', text: `${safe.code}: ${safe.message}` }],
          isError: true,
        },
      })
    }
  }

  private authorize(request: IncomingMessage): SessionGrant | null {
    const header = request.headers.authorization
    if (header == null || !header.startsWith('Bearer ')) return null
    const token = header.slice('Bearer '.length)
    const grant = this.grants.get(token)
    if (grant == null) return null
    if (grant.expiresAt <= Date.now()) {
      this.grants.delete(token)
      return null
    }
    return grant
  }

  private readBody(request: IncomingMessage): Promise<{ text: string; tooLarge: boolean }> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let bytes = 0
      let tooLarge = false
      request.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > this.maxBodyBytes) {
          tooLarge = true
          chunks.length = 0
          return
        }
        if (!tooLarge) chunks.push(chunk)
      })
      request.on('end', () =>
        resolve({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge }),
      )
      request.on('error', reject)
    })
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    if (response.headersSent) return
    response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify(body))
  }

  private removeExpiredGrants(): void {
    const now = Date.now()
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token)
    }
  }
}

function parseInvocation(text: string): { toolName: string; args: unknown } {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw invalidRequest()
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest()
  const record = value as Record<string, unknown>
  if (typeof record.toolName !== 'string' || record.toolName.length > 100) throw invalidRequest()
  const args = record.args ?? {}
  if (args == null || typeof args !== 'object' || Array.isArray(args)) throw invalidRequest()
  return { toolName: record.toolName, args }
}

function parseMcpRequest(text: string): {
  id?: string | number | null
  method: string
  params: unknown
} {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw invalidRequest()
  }
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest()
  const record = value as Record<string, unknown>
  if (record.jsonrpc !== '2.0' || typeof record.method !== 'string') throw invalidRequest()
  if (
    record.id !== undefined &&
    record.id !== null &&
    typeof record.id !== 'string' &&
    typeof record.id !== 'number'
  ) {
    throw invalidRequest()
  }
  return {
    ...(record.id === undefined ? {} : { id: record.id as string | number | null }),
    method: record.method,
    params: record.params ?? {},
  }
}

function parseMcpToolCall(params: unknown): { toolName: string; args: unknown } {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    throw invalidRequest()
  }
  const record = params as Record<string, unknown>
  if (typeof record.name !== 'string' || !ALLOWED_TOOLS.has(record.name)) {
    throw invalidRequest()
  }
  const args = record.arguments ?? {}
  if (args == null || typeof args !== 'object' || Array.isArray(args)) throw invalidRequest()
  return { toolName: record.name, args }
}

function invalidRequest(): Error & { status: number; code: string } {
  return Object.assign(new Error('Invalid Computer Use request'), {
    status: 400,
    code: 'INVALID_REQUEST',
  })
}

function toSafeError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return {
      status:
        'status' in error && typeof error.status === 'number' && error.status >= 400
          ? error.status
          : 409,
      code: error.code,
      message: error.message.slice(0, 300),
    }
  }
  return { status: 500, code: 'COMPUTER_USE_FAILED', message: 'Computer Use request failed' }
}

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createLogger } from '@spark/shared'

const log = createLogger('computer-use-agent-bridge')
const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const SESSION_TOKEN_TTL_MS = 15 * 60 * 1_000

const ALLOWED_TOOLS = new Set([
  'get_capabilities',
  'diagnose_native_host',
  'list_apps',
  'list_windows',
  'get_screen_state',
  'get_app_state',
  'open_app',
  'capture_app_snapshot',
  'start_task',
  'get_status',
  'wait_for_completion',
  'pause',
  'resume',
  'stop',
  'takeover',
  'bind_target',
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
      'Read trusted Computer Use Beta permissions, feature flags, and governed task availability. Call this before claiming computer-control ability; use diagnose_native_host when unavailable.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'diagnose_native_host',
    description:
      'Return a copyable, content-free Native Host diagnostic report with diagnosticCode, stage, repair action, runtime versions, permissions, and latency baselines.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_apps',
    description:
      'List running, installed, or all applications. Running state comes from the trusted native window inventory; the macOS installed catalog is cached and degrades safely if operating-system discovery is unavailable. Use this only when the target app is unknown.',
    inputSchema: {
      type: 'object',
      properties: {
        includeWindows: { type: 'boolean', default: true },
        scope: { type: 'string', enum: ['running', 'installed', 'all'], default: 'all' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_windows',
    description:
      'List desktop windows, optionally filtered by an exact app display name, bundle id, or stable app id. Minimized windows are excluded by default.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', minLength: 1, maxLength: 300 },
        includeMinimized: { type: 'boolean', default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_screen_state',
    description:
      'Read the current desktop state in one call: frontmost app/window, displays, running apps, and window counts. This is metadata-only and does not start a task.',
    inputSchema: {
      type: 'object',
      properties: {
        includeWindows: { type: 'boolean', default: true },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_app_state',
    description:
      'Get one application state directly by exact display name, bundle id, stable app id, or window id. App selectors launch or raise the app by default. Returns native window metadata plus an accessibility/visual observation when available. A chat snapshot is optional and its failure does not discard state.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', minLength: 1, maxLength: 300 },
        windowId: { type: 'string', minLength: 1, maxLength: 256 },
        launchIfNeeded: { type: 'boolean', default: true },
        includeSnapshot: { type: 'boolean', default: false },
      },
      oneOf: [{ required: ['app'] }, { required: ['windowId'] }],
      additionalProperties: false,
    },
  },
  {
    name: 'open_app',
    description:
      'Open or raise an application directly by exact display name, bundle id, or stable app id and return its resolved native window state. Prefer this over operating-system launcher keystrokes.',
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', minLength: 1, maxLength: 300 },
      },
      required: ['app'],
      additionalProperties: false,
    },
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
      'Start a resilient task on the real desktop. Without targetWindowId the task follows the foreground window across applications; provide targetWindowId only when the user explicitly wants a single-window task. Minimal valid input example: {"goal":"Open the app and search for the requested topic","environment":"my_desktop"}. successCriteria is optional; Spark derives visible search/input text when possible and can continue with screenshot coordinates when accessibility data is incomplete. Do not retry safe_browser or safe_desktop: this build supports my_desktop execution.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description:
            'Concrete end-to-end objective. Put expected visible result text in quotes when possible so Spark can derive verification, for example: Search for "ComfyUI latest tutorial".',
          minLength: 1,
          maxLength: 4_000,
        },
        environment: {
          type: 'string',
          description: "Use exactly my_desktop for the user's local Mac or Windows desktop.",
          enum: ['my_desktop'],
        },
        targetWindowId: {
          type: 'string',
          description:
            'Optional exact window id returned by list_windows. When supplied, Spark binds the task to that window and will not follow another foreground window.',
          minLength: 1,
          maxLength: 256,
        },
        targetApp: {
          type: 'string',
          description:
            'Optional exact application display name or bundle identifier. Prefer this whenever the user names an app; Spark launches or raises it directly before visual planning. Do not combine with targetWindowId.',
          minLength: 1,
          maxLength: 200,
        },
        acceptanceCriteria: {
          type: 'array',
          description:
            'Optional shorthand list of visible text that must appear, for example ["ComfyUI latest tutorial"]. Do not send this together with successCriteria.',
          items: { type: 'string', maxLength: 1_000 },
          maxItems: 50,
        },
        successCriteria: {
          type: 'array',
          description:
            'Optional deterministic VerificationSpec objects. Supported kinds are accessibility, visual with text_present/text_absent, and application_state. Omit this field if unsure; Spark will derive a criterion.',
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
    description: `${name.replace('_', ' ')} a governed Computer Use task. Pass exactly {"computerSessionId":"<id returned by start_task>"}.`,
    inputSchema: {
      type: 'object',
      properties: { computerSessionId: { type: 'string', minLength: 1, maxLength: 200 } },
      required: ['computerSessionId'],
      additionalProperties: false,
    },
  })),
  {
    name: 'wait_for_completion',
    description:
      'Wait on the Computer Use session event stream until it completes, fails, pauses, needs user takeover, or the bounded timeout expires. Prefer this over polling get_status.',
    inputSchema: {
      type: 'object',
      properties: {
        computerSessionId: { type: 'string', minLength: 1, maxLength: 200 },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 300_000, default: 120_000 },
      },
      required: ['computerSessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'bind_target',
    description:
      'Explicitly bind an owned Computer Use task to a new window whose strong application identity is already allowed by the task contract.',
    inputSchema: {
      type: 'object',
      properties: {
        computerSessionId: { type: 'string', minLength: 1, maxLength: 200 },
        targetWindowId: { type: 'string', minLength: 1, maxLength: 256 },
      },
      required: ['computerSessionId', 'targetWindowId'],
      additionalProperties: false,
    },
  },
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

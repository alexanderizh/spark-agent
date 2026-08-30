import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z, type ZodTypeAny } from 'zod'
import type { CodexRuntimeResource, SDKMcpServerConfig } from '../../sdk/types.js'
import { createLogger } from '@spark/shared'
import type { RuntimeBroker } from './runtime-broker.js'
import type { RuntimeToolDefinition } from '@spark/protocol'

const log = createLogger('plugin-runtime:mcp-bridge')
const MAX_RESULT_BYTES = 2 * 1024 * 1024

interface ServedRuntimeSession {
  token: string
  mcp: McpServer
  transport: StreamableHTTPServerTransport
  leaseKey: string | null
  catalogFingerprint: string
  definitions: Map<string, CollectedRuntimeDefinition>
  activeGeneration: string | null
  runtimeAttached: boolean
  runtimeResource: CodexRuntimeResource | null
}

type CollectedRuntimeDefinition = {
  runtimeId: string
  tool: RuntimeToolDefinition
  qualifiedName: string
}

export interface PluginRuntimeMcpHandle {
  config: SDKMcpServerConfig
  toolNames: string[]
  close: () => Promise<void>
  runtimeResource?: CodexRuntimeResource | undefined
}

export class PluginRuntimeMcpBridge {
  private server: Server | null = null
  private port = 0
  private readonly sessions = new Map<string, ServedRuntimeSession>()
  private readonly sessionsByLeaseKey = new Map<string, ServedRuntimeSession>()

  constructor(private readonly broker: RuntimeBroker) {}

  async serve(
    options: { runtimeLeaseKey?: string | undefined } = {},
  ): Promise<PluginRuntimeMcpHandle | null> {
    const definitions = await this.collectDefinitions()
    if (definitions.length === 0) return null
    await this.ensureServer()
    const leaseKey = options.runtimeLeaseKey?.trim() || null
    const catalogFingerprint = createPluginToolCatalogFingerprint(definitions)
    if (leaseKey != null) {
      const existing = this.sessionsByLeaseKey.get(leaseKey)
      if (existing != null) {
        if (existing.activeGeneration != null) {
          throw new Error(
            `Plugin MCP runtime lease is already active: ${createOpaqueLeaseId(leaseKey)}`,
          )
        }
        if (existing.catalogFingerprint === catalogFingerprint) {
          return this.activateSession(existing, definitions)
        }
        await this.closeSession(existing)
      }
    }
    const session = await this.createSession(definitions, leaseKey, catalogFingerprint)
    return this.activateSession(session, definitions)
  }

  private async createSession(
    definitions: CollectedRuntimeDefinition[],
    leaseKey: string | null,
    catalogFingerprint: string,
  ): Promise<ServedRuntimeSession> {
    const token = randomUUID()
    const mcp = new McpServer({ name: 'spark_plugins', version: '2.0.0' })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
    const session: ServedRuntimeSession = {
      token,
      mcp,
      transport,
      leaseKey,
      catalogFingerprint,
      definitions: new Map(),
      activeGeneration: null,
      runtimeAttached: false,
      runtimeResource: null,
    }
    for (const definition of definitions) {
      mcp.registerTool(
        definition.qualifiedName,
        {
          description: definition.tool.description,
          inputSchema: z
            .object({
              accountId: z.string().optional(),
              confirmationToken: z.string().optional(),
              ...shapeFromSchema(definition.tool.inputSchema),
            })
            .passthrough(),
        },
        async (args: Record<string, unknown>) => {
          const activeDefinition = session.definitions.get(definition.qualifiedName)
          if (session.activeGeneration == null || activeDefinition == null) {
            return {
              content: [{ type: 'text' as const, text: 'Plugin MCP turn is no longer active' }],
              isError: true,
            }
          }
          const { accountId, confirmationToken, ...input } = args ?? {}
          try {
            const result = await this.broker.invoke({
              runtimeId: activeDefinition.runtimeId,
              ...(typeof accountId === 'string' ? { accountId } : {}),
              toolName: activeDefinition.tool.name,
              input,
              ...(typeof confirmationToken === 'string' ? { confirmationToken } : {}),
            })
            return toMcpResult(result)
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Plugin runtime tool failed'
            return { content: [{ type: 'text' as const, text: message }], isError: true }
          }
        },
      )
    }
    await mcp.connect(transport as unknown as Transport)
    if (leaseKey != null) {
      session.runtimeResource = {
        id: `plugin-mcp:${createOpaqueLeaseId(leaseKey)}`,
        onAttached: () => {
          session.runtimeAttached = true
        },
        dispose: () => this.closeSession(session),
      }
      this.sessionsByLeaseKey.set(leaseKey, session)
    }
    this.sessions.set(token, session)
    return session
  }

  private activateSession(
    session: ServedRuntimeSession,
    definitions: CollectedRuntimeDefinition[],
  ): PluginRuntimeMcpHandle {
    const generation = randomUUID()
    session.activeGeneration = generation
    session.definitions = new Map(
      definitions.map((definition) => [definition.qualifiedName, definition]),
    )
    let closed = false
    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      if (session.activeGeneration === generation) {
        session.activeGeneration = null
        session.definitions.clear()
      }
      if (session.leaseKey == null || !session.runtimeAttached) await this.closeSession(session)
    }
    return {
      config: {
        type: 'http',
        url: `http://127.0.0.1:${this.port}/mcp`,
        headers: { Authorization: `Bearer ${session.token}` },
      },
      toolNames: definitions.map((definition) => `mcp__spark_plugins__${definition.qualifiedName}`),
      close,
      ...(session.runtimeResource != null ? { runtimeResource: session.runtimeResource } : {}),
    }
  }

  private async closeSession(session: ServedRuntimeSession): Promise<void> {
    if (!this.sessions.delete(session.token)) return
    if (session.leaseKey != null && this.sessionsByLeaseKey.get(session.leaseKey) === session) {
      this.sessionsByLeaseKey.delete(session.leaseKey)
    }
    session.activeGeneration = null
    session.definitions.clear()
    try {
      await session.mcp.close()
    } catch (error) {
      log.warn(`plugin runtime MCP close failed: ${String(error)}`)
    }
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.closeSession(session)))
    this.sessionsByLeaseKey.clear()
    if (this.server != null) {
      const server = this.server
      this.server = null
      this.port = 0
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }

  private async collectDefinitions(): Promise<CollectedRuntimeDefinition[]> {
    const definitions: CollectedRuntimeDefinition[] = []
    const enabled = new Set(
      this.broker
        .listRuntimeStatus()
        .filter((item) => item.enabled)
        .map((item) => item.runtime.id),
    )
    for (const runtime of this.broker.listRuntimeDescriptors()) {
      if (!enabled.has(runtime.id)) continue
      const accounts = this.broker.listAccounts(runtime.id)
      if (accounts.length === 0) continue
      const tools = await this.broker.listAvailableTools(runtime.id)
      for (const tool of tools)
        definitions.push({
          runtimeId: runtime.id,
          tool,
          qualifiedName: `${runtime.toolNamespace}_${tool.name}`,
        })
    }
    return definitions
  }

  private async ensureServer(): Promise<void> {
    if (this.server != null) return
    await new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        void this.handleRequest(request, response)
      })
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        const address = server.address()
        if (address == null || typeof address === 'string') {
          reject(new Error('Failed to bind plugin runtime MCP bridge'))
          return
        }
        this.server = server
        this.port = address.port
        resolve()
      })
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = extractBearer(request)
    const session = token == null ? undefined : this.sessions.get(token)
    if (session == null) {
      response.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized')
      return
    }
    try {
      await session.transport.handleRequest(request, response)
    } catch (error) {
      log.warn(`plugin runtime MCP request failed: ${String(error)}`)
      if (!response.headersSent) response.writeHead(500).end('Plugin runtime MCP bridge error')
    }
  }
}

function createPluginToolCatalogFingerprint(definitions: CollectedRuntimeDefinition[]): string {
  const catalog = definitions
    .map((definition) => ({
      runtimeId: definition.runtimeId,
      qualifiedName: definition.qualifiedName,
      description: definition.tool.description,
      inputSchema: definition.tool.inputSchema,
    }))
    .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName))
  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
}

function createOpaqueLeaseId(leaseKey: string): string {
  return createHash('sha256').update(leaseKey).digest('hex').slice(0, 16)
}

function extractBearer(request: IncomingMessage): string | null {
  const value = request.headers.authorization
  const match = typeof value === 'string' ? /^Bearer\s+(.+)$/i.exec(value.trim()) : null
  return match?.[1] ?? null
}

function shapeFromSchema(schema: Record<string, unknown>): Record<string, ZodTypeAny> {
  const properties = schema.properties
  if (properties == null || typeof properties !== 'object' || Array.isArray(properties)) return {}
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [],
  )
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    const value = raw != null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    let field: ZodTypeAny =
      value.type === 'boolean'
        ? z.boolean()
        : value.type === 'number' || value.type === 'integer'
          ? z.number()
          : value.type === 'array'
            ? z.array(z.unknown())
            : z.string()
    if (!required.has(key)) field = field.optional()
    shape[key] = field
  }
  return shape
}

function toMcpResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: Record<string, unknown>
} {
  let text = JSON.stringify(value)
  if (text === undefined) text = 'null'
  if (text.length > MAX_RESULT_BYTES)
    text = `${text.slice(0, MAX_RESULT_BYTES)}\n[truncated by Spark runtime]`
  if (value != null && typeof value === 'object' && !Array.isArray(value))
    return {
      content: [{ type: 'text', text }],
      structuredContent: value as Record<string, unknown>,
    }
  return { content: [{ type: 'text', text }] }
}

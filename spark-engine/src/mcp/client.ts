import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import type { ToolExecutor, ToolCallContext, ToolOwner, TurnBoundaryReport } from '../seams.js'
import type { ResolvedToolCall, ToolDefinition, ToolOutcome } from '../tools/contract.js'
import { withCustomEnvironment } from '../tools/workspace/process.js'
import { SPARK_ENGINE_VERSION } from '../version.js'
import type { MemoryToolExecutor } from '../memory/tools.js'
import type { SkillToolExecutor } from '../skills/tools.js'
import type { TodoToolExecutor } from '../tools/todo/tools.js'
import type { PlanToolExecutor } from '../tools/plan/tools.js'
import type { WebFetchToolExecutor } from '../tools/web-fetch.js'
import type { WebSearchToolExecutor } from '../tools/web-search.js'
import type { SparkMcpServerConfig, SparkMcpServerMap, SparkMcpServerStatus } from './types.js'

const DEFAULT_MCP_TIMEOUT_MS = 120_000
const MAX_MCP_TOOL_NAME_LENGTH = 128
const MAX_MCP_SERVER_NAME_LENGTH = 96
const MAX_MCP_DESCRIPTION_LENGTH = 16_000
const MAX_MCP_SCHEMA_BYTES = 256 * 1024

interface McpBinding {
  readonly remoteName: string
  readonly client: Client
  readonly tool: ToolDefinition
}

export interface McpToolManagerOptions {
  readonly cwd: string
  readonly servers: SparkMcpServerMap
  readonly startupTimeoutMs?: number
}

/**
 * Owns the lifetime of the MCP transports used by one Spark environment.
 *
 * A manager is created per managed environment, so a session/turn never shares
 * a remote process with another executor accidentally. MCP descriptions are
 * converted to normal Spark ToolDefinitions before the first model request;
 * calls then flow through the same ToolRunner as built-in tools.
 */
export class McpToolManager implements ToolExecutor {
  readonly #bindings: Map<string, McpBinding>
  readonly #clients: Set<Client>
  readonly #statuses: Map<
    string,
    { runtimeStatus: 'connected' | 'failed'; toolsError: string | null; toolCount: number }
  >

  private constructor() {
    this.#bindings = new Map()
    this.#clients = new Set()
    this.#statuses = new Map()
  }

  static async connect(options: McpToolManagerOptions): Promise<McpToolManager> {
    const manager = new McpToolManager()
    try {
      await Promise.all(
        Object.entries(options.servers).map(([serverName, config]) =>
          manager.#connectServer(serverName, config, options),
        ),
      )
      return manager
    } catch (error) {
      await manager.close()
      throw error
    }
  }

  listDefinitions(): readonly ToolDefinition[] {
    return [...this.#bindings.values()].map((binding) => binding.tool)
  }

  /**
   * Per-server runtime status. `toolsError` is non-null when the transport
   * connected but tool discovery (tools/list) failed — the session keeps
   * running with that server's tools unavailable, mirroring the Codex
   * app-server `McpServerStatus.toolsError` contract.
   */
  serverStatuses(): readonly SparkMcpServerStatus[] {
    return [...this.#statuses.entries()].map(([name, status]) => ({ name, ...status }))
  }

  hasTool(name: string): boolean {
    return this.#bindings.has(name)
  }

  async execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome> {
    const binding = this.#bindings.get(call.name)
    if (!binding) return { ok: false, content: `Unknown MCP tool: ${call.name}` }

    const args = asRecord(call.args)
    if (!args) return { ok: false, content: 'MCP tool arguments must be an object' }

    const result = await binding.client.callTool(
      { name: binding.remoteName, arguments: args },
      undefined,
      {
        signal: context.signal,
        timeout: context.timeoutMs,
        maxTotalTimeout: context.timeoutMs,
      },
    )
    return {
      ok: result.isError !== true,
      content: renderToolResult(result),
    }
  }

  async close(): Promise<void> {
    const clients = [...this.#clients]
    this.#clients.clear()
    this.#bindings.clear()
    await Promise.allSettled(clients.map((client) => client.close()))
  }

  async #connectServer(
    serverName: string,
    config: SparkMcpServerConfig,
    options: McpToolManagerOptions,
  ): Promise<void> {
    assertMcpComponent(serverName, 'server', MAX_MCP_SERVER_NAME_LENGTH)
    const transport = createTransport(config, options)
    const client = new Client(
      { name: 'spark-agent', version: SPARK_ENGINE_VERSION },
      { enforceStrictCapabilities: true },
    )
    this.#clients.add(client)
    // The SDK's HTTP transport exposes `sessionId?: string` while its
    // Transport interface uses exact-optional `sessionId?: string`; the
    // runtime contract is identical, but TypeScript 5.9 rejects the package's
    // declaration pair under our exactOptionalPropertyTypes setting.
    const clientTransport = transport as unknown as Parameters<Client['connect']>[0]
    try {
      await client.connect(clientTransport, {
        timeout: options.startupTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
      })
    } catch (error) {
      this.#statuses.set(serverName, {
        runtimeStatus: 'failed',
        toolsError: null,
        toolCount: 0,
      })
      throw error
    }
    let toolCount = 0
    try {
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      do {
        if (cursor !== undefined) {
          if (seenCursors.has(cursor))
            throw new Error(`MCP server ${serverName} repeated a tools/list cursor`)
          seenCursors.add(cursor)
        }
        const page = await client.listTools(cursor === undefined ? undefined : { cursor }, {
          timeout: options.startupTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
        })
        for (const tool of page.tools) this.#registerTool(serverName, client, tool)
        toolCount += page.tools.length
        cursor = page.nextCursor
      } while (cursor !== undefined && cursor.length > 0)
      this.#statuses.set(serverName, {
        runtimeStatus: 'connected',
        toolsError: null,
        toolCount,
      })
    } catch (error) {
      // Discovery failed after a successful connect: the server stays wired
      // (its status is queryable) but contributes no tools. Repeated-cursor
      // guard failures land here too — partial pages already registered.
      this.#statuses.set(serverName, {
        runtimeStatus: 'connected',
        toolsError: error instanceof Error ? error.message : String(error),
        toolCount,
      })
    }
  }

  #registerTool(serverName: string, client: Client, tool: Tool): void {
    assertMcpComponent(tool.name, 'tool', MAX_MCP_TOOL_NAME_LENGTH)
    const qualifiedName = `mcp__${serverName}__${tool.name}`
    if (this.#bindings.has(qualifiedName)) {
      throw new Error(`MCP tool name collision: ${qualifiedName}`)
    }
    const readonly = tool.annotations?.readOnlyHint === true
    const inputSchema = structuredClone(tool.inputSchema)
    if (JSON.stringify(inputSchema).length > MAX_MCP_SCHEMA_BYTES) {
      throw new Error(`MCP tool schema is too large: ${qualifiedName}`)
    }
    const description = tool.description ?? tool.title ?? tool.name
    const definition: ToolDefinition = {
      name: qualifiedName,
      description: `[MCP ${serverName}] ${description.slice(0, MAX_MCP_DESCRIPTION_LENGTH)}`,
      inputSchema,
      readonly,
      ...(tool.annotations?.destructiveHint === true ? { destructive: true } : {}),
      permissionClass: readonly ? 'read' : 'external',
      approval: 'always',
      concurrency: readonly && tool.annotations?.idempotentHint === true ? 'parallel' : 'serial',
      timeoutMs: DEFAULT_MCP_TIMEOUT_MS,
      interruptible: true,
      costClass: 'network',
    }
    this.#bindings.set(qualifiedName, {
      remoteName: tool.name,
      client,
      tool: definition,
    })
  }
}

function createTransport(
  config: SparkMcpServerConfig,
  options: McpToolManagerOptions,
): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.type === 'http') {
    let url: URL
    try {
      url = new URL(config.url)
    } catch {
      throw new Error(`MCP HTTP server URL is invalid: ${config.url}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`MCP HTTP server URL must use http or https: ${config.url}`)
    }
    return new StreamableHTTPClientTransport(url, {
      ...(config.headers === undefined ? {} : { requestInit: { headers: { ...config.headers } } }),
    })
  }

  const command = config.command.trim()
  if (!command) throw new Error('MCP stdio server requires a command')
  return new StdioClientTransport({
    command,
    ...(config.args === undefined ? {} : { args: [...config.args] }),
    env: mergeProcessEnvironment(config.env),
    cwd: config.cwd ?? options.cwd,
    stderr: 'pipe',
  } satisfies StdioServerParameters)
}

/** Routes MCP calls to the remote manager and all other calls to built-ins. */
export class CompositeToolExecutor implements ToolExecutor {
  constructor(
    private readonly builtIn: ToolExecutor,
    private readonly mcp?: McpToolManager,
    private readonly memory?: MemoryToolExecutor,
    private readonly todo?: TodoToolExecutor,
    private readonly plan?: PlanToolExecutor,
    private readonly webFetch?: WebFetchToolExecutor,
    /** Appended to preserve the positional constructor contract for SDK hosts. */
    private readonly skills?: SkillToolExecutor,
    private readonly webSearch?: WebSearchToolExecutor,
  ) {}

  async settleTurnBoundary(owner: ToolOwner): Promise<TurnBoundaryReport | undefined> {
    return this.builtIn.settleTurnBoundary?.(owner)
  }

  async closeTurn(owner: ToolOwner): Promise<void> {
    await this.builtIn.closeTurn?.(owner)
  }

  execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome> {
    if (this.memory?.hasTool(call.name)) return this.memory.execute(call, context)
    if (this.skills?.hasTool(call.name)) return this.skills.execute(call, context)
    if (this.todo?.hasTool(call.name)) return this.todo.execute(call, context)
    if (this.plan?.hasTool(call.name)) return this.plan.execute(call, context)
    if (this.webFetch?.hasTool(call.name)) return this.webFetch.execute(call, context)
    if (this.webSearch?.hasTool(call.name)) return this.webSearch.execute(call, context)
    if (this.mcp?.hasTool(call.name)) return this.mcp.execute(call, context)
    return this.builtIn.execute(call, context)
  }
}

function mergeProcessEnvironment(
  serverEnv: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const inherited = getDefaultEnvironment()
  const serverConfigured = withCustomEnvironment(serverEnv, {})
  return {
    ...toStringRecord(inherited),
    ...toStringRecord(serverConfigured),
  }
}

function toStringRecord(value: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

function renderToolResult(result: unknown): string {
  const record = asRecord(result)
  const content = record?.content
  const parts = (Array.isArray(content) ? content : [])
    .map(renderContentBlock)
    .filter((value) => value.length > 0)
  if (parts.length > 0) return parts.join('\n')
  if (record?.structuredContent !== undefined) return JSON.stringify(record.structuredContent)
  return 'MCP tool returned no content.'
}

function renderContentBlock(value: unknown): string {
  const record = asRecord(value)
  if (!record || typeof record.type !== 'string') return ''
  if (record.type === 'text' && typeof record.text === 'string') return record.text
  if (record.type === 'image') {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : 'unknown'
    return `[MCP image omitted from text channel: ${mimeType}]`
  }
  if (record.type === 'audio') {
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : 'unknown'
    return `[MCP audio omitted from text channel: ${mimeType}]`
  }
  if (record.type === 'resource') {
    const resource = asRecord(record.resource)
    if (!resource) return ''
    if (typeof resource.text === 'string') return resource.text
    if (typeof resource.uri === 'string') return `[MCP resource: ${resource.uri}]`
  }
  return ''
}

function assertMcpComponent(value: string, kind: string, maximum: number): void {
  if (
    value.length === 0 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:-]+$/u.test(value) ||
    value.includes('\0')
  ) {
    throw new Error(`Invalid MCP ${kind} name: ${JSON.stringify(value)}`)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

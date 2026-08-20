/**
 * @module team-mcp-http-bridge
 *
 * Team MCP HTTP Bridge（FR-0b）
 *
 * 把 spark_team 的 in-process 工具（agent_dispatch / agent_dispatch_batch /
 * workflow_run 及后续 agent_message 等）以 MCP Streamable HTTP 形态暴露，供 codex
 * adapter 的 Agent（CodexSdk / CodexCli）消费——codex 是独立子进程，无法直接回调
 * 主进程的 in-process SDK MCP server（type:'sdk'），故需经 HTTP 桥接。
 *
 * 设计要点（参照 spark_debug 的 DebugLogServer 先例）：
 *   - 进程内单例 http server，绑定 127.0.0.1 + 随机端口，跨 turn 存活。
 *   - 普通执行每次 serve() 创建隔离会话；持久 Codex Runtime 按 lease 复用 MCP 连接和
 *     Bearer，并在 turn 边界原子切换 handler generation。
 *   - 不重写工具逻辑：tool 定义来自 createTeamMcpServer 的 buildTeamToolDefinitions，
 *     与 in-process 形态同源，避免两份实现漂移。
 *
 * 安全：
 *   - 仅监听 127.0.0.1（loopback）；token 错误/缺失 → 401。
 *   - 跨会话隔离：token A 的请求物理上无法触达 token B 的 dispatcher（Map 路由）。
 *
 * Codex SDK-backed chat-wire providers also consume this HTTP bridge.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z, type ZodTypeAny } from 'zod'
import { createLogger } from '@spark/shared'
import type { CodexRuntimeResource } from '../sdk/types.js'

const log = createLogger('team-mcp-http-bridge')

/** 单个工具的回调返回结构（与 MCP tool result 对齐）。 */
export interface TeamToolHandlerResult {
  /** MCP ToolResult 兼容：允许 _meta / isError 等扩展字段（桥接到 McpServer 时被识别）。 */
  [x: string]: unknown
  content: Array<{ type: 'text'; text: string }>
  structuredContent?: { [x: string]: unknown }
}

/**
 * in-process 与 HTTP 桥接共享的工具定义。handler 闭包捕获各自会话上下文（dispatcher、
 * workflow 图等），由 createTeamMcpServer 的 buildTeamToolDefinitions 构造，两种消费
 * 形态（Claude Agent SDK 的 in-process tool 工厂 / MCP McpServer）共用同一份定义。
 */
export interface TeamToolDefinition {
  name: string
  description: string
  /** zod raw shape（z.object 的入参定义）。 */
  schema: Record<string, ZodTypeAny>
  handler: (args: Record<string, unknown>) => Promise<TeamToolHandlerResult>
}

interface ServedSession {
  token: string
  mcp: McpServer
  transport: StreamableHTTPServerTransport
  leaseKey: string | null
  catalogFingerprint: string
  handlers: Map<string, TeamToolDefinition['handler']>
  activeGeneration: string | null
  runtimeAttached: boolean
  runtimeResource: CodexRuntimeResource | null
}

/** 一次 serve() 返回的句柄，供调用方塞进 SDKMcpServerConfig + 结束时 close。 */
export interface TeamMcpBridgeHandle {
  url: string
  token: string
  close: () => Promise<void>
  /** Present only for a persistent Codex runtime lease. */
  runtimeResource?: CodexRuntimeResource | undefined
}

export interface TeamMcpBridgeServeOptions {
  /** 可选：绑定的 AbortSignal；abort 时停用当前 handler，非持久会话同时吊销 token。 */
  signal?: AbortSignal | undefined
  /** Reuse one bearer/MCP connection while the matching Codex runtime lease is alive. */
  runtimeLeaseKey?: string | undefined
}

export class TeamMcpHttpBridge {
  private server: Server | null = null
  private port = 0
  private readonly sessions = new Map<string, ServedSession>()
  private readonly sessionsByLeaseKey = new Map<string, ServedSession>()

  /** 惰性起 http server（单例），重复调用幂等。 */
  private ensureServer(): Promise<void> {
    if (this.server != null) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        if (addr == null || typeof addr === 'string') {
          reject(new Error('Failed to bind team MCP HTTP bridge'))
          return
        }
        this.port = addr.port
        this.server = server
        log.info(`Team MCP HTTP bridge listening on 127.0.0.1:${this.port}`)
        resolve()
      })
    })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // 第一道闸：Bearer token 校验 + 会话路由。token 不匹配 → 401，物理上无法触达任何会话。
    const token = extractBearer(req)
    if (token == null) {
      this.writeError(res, 401, 'Unauthorized: missing or malformed Bearer token')
      return
    }
    const session = this.sessions.get(token)
    if (session == null) {
      this.writeError(res, 401, 'Unauthorized: invalid or expired session token')
      return
    }
    try {
      // 第二道：交由 MCP Streamable HTTP transport 处理 JSON-RPC（含 Mcp-Session-Id 管理）。
      await session.transport.handleRequest(req, res)
    } catch (err) {
      log.warn('team MCP bridge handleRequest failed', err)
      if (!res.headersSent) this.writeError(res, 500, 'Internal bridge error')
    }
  }

  /**
   * 为一组 tool 定义启动一个隔离会话，返回 url + Bearer token。
   * 调用方把 `{ type:'http', url, headers:{ Authorization:\`Bearer ${token}\` } }`
   * 塞进 SDKMcpServerConfig，codex 执行器会原样透传给 codex CLI/SDK。
   */
  async serve(
    defs: TeamToolDefinition[],
    opts?: TeamMcpBridgeServeOptions,
  ): Promise<TeamMcpBridgeHandle> {
    if (defs.length === 0) {
      throw new Error('Team MCP HTTP bridge requires at least one tool definition')
    }
    await this.ensureServer()
    const leaseKey = opts?.runtimeLeaseKey?.trim() || null
    const catalogFingerprint = createTeamToolCatalogFingerprint(defs)
    if (leaseKey != null) {
      const existing = this.sessionsByLeaseKey.get(leaseKey)
      if (existing != null) {
        if (existing.activeGeneration != null) {
          throw new Error(
            `Team MCP runtime lease is already active: ${createOpaqueLeaseId(leaseKey)}`,
          )
        }
        if (existing.catalogFingerprint === catalogFingerprint) {
          return this.activateSession(existing, defs, opts)
        }
        // Tool/schema changes must rotate the bearer so App Server's runtime fingerprint rotates
        // with the MCP catalog. The old runtime resource disposer remains safely idempotent.
        await this.closeSession(existing)
      }
    }
    const session = await this.createSession(defs, leaseKey, catalogFingerprint)
    return this.activateSession(session, defs, opts)
  }

  private async createSession(
    defs: TeamToolDefinition[],
    leaseKey: string | null,
    catalogFingerprint: string,
  ): Promise<ServedSession> {
    const token = randomUUID()
    const mcp = new McpServer({ name: 'spark_team', version: '0.2.0' })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })
    const session: ServedSession = {
      token,
      mcp,
      transport,
      leaseKey,
      catalogFingerprint,
      handlers: new Map(),
      activeGeneration: null,
      runtimeAttached: false,
      runtimeResource: null,
    }
    for (const def of defs) {
      mcp.tool(def.name, def.description, def.schema, async (args: Record<string, unknown>) => {
        const handler = session.handlers.get(def.name)
        if (session.activeGeneration == null || handler == null) {
          return {
            content: [{ type: 'text' as const, text: 'Team MCP turn is no longer active' }],
            isError: true,
          }
        }
        return handler(args ?? {})
      })
    }
    // MCP SDK 1.29 类型摩擦：StreamableHTTPServerTransport.onclose 声明为 (() => void) | undefined，
    // 而 Transport 接口要求 () => void，在 exactOptionalPropertyTypes 下不兼容（上游类型不一致）。断言绕过。
    await mcp.connect(transport as unknown as Transport)
    if (leaseKey != null) {
      session.runtimeResource = {
        id: `team-mcp:${createOpaqueLeaseId(leaseKey)}`,
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
    session: ServedSession,
    defs: TeamToolDefinition[],
    opts?: TeamMcpBridgeServeOptions,
  ): TeamMcpBridgeHandle {
    const generation = randomUUID()
    session.activeGeneration = generation
    session.handlers = new Map(defs.map((def) => [def.name, def.handler]))
    let closed = false
    const close = async (): Promise<void> => {
      if (closed) return
      closed = true
      if (session.activeGeneration === generation) {
        session.activeGeneration = null
        session.handlers.clear()
      }
      // A resource not accepted by the supervisor (startup/fallback failure) must not leak.
      if (session.leaseKey == null || !session.runtimeAttached) await this.closeSession(session)
    }
    // turn 取消信号：立即停用当前 handler generation；runtime-bound bearer 由 lease 回收。
    if (opts?.signal != null) {
      if (opts.signal.aborted) {
        void close()
      } else {
        opts.signal.addEventListener('abort', () => void close(), { once: true })
      }
    }

    return {
      url: `http://127.0.0.1:${this.port}/mcp`,
      token: session.token,
      close,
      ...(session.runtimeResource != null ? { runtimeResource: session.runtimeResource } : {}),
    }
  }

  private async closeSession(session: ServedSession): Promise<void> {
    if (!this.sessions.delete(session.token)) return
    if (session.leaseKey != null && this.sessionsByLeaseKey.get(session.leaseKey) === session) {
      this.sessionsByLeaseKey.delete(session.leaseKey)
    }
    session.activeGeneration = null
    session.handlers.clear()
    try {
      await session.mcp.close()
    } catch (err) {
      log.warn('team MCP bridge session close failed', err)
    }
  }

  /** 进程退出/服务销毁时关停所有会话与 http server。 */
  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.closeSession(session)))
    this.sessionsByLeaseKey.clear()
    if (this.server != null) {
      const server = this.server
      this.server = null
      this.port = 0
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    }
  }

  private writeError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'text/plain' })
    res.end(message)
  }
}

function createTeamToolCatalogFingerprint(defs: TeamToolDefinition[]): string {
  const catalog = defs
    .map((def) => ({
      name: def.name,
      description: def.description,
      // Team tools may use z.custom() for runtime-only validation. MCP represents those fields
      // as unconstrained JSON, so the lifecycle fingerprint must use the same best-effort shape.
      schema: z.toJSONSchema(z.object(def.schema), { unrepresentable: 'any' }),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return createHash('sha256').update(JSON.stringify(catalog)).digest('hex')
}

function createOpaqueLeaseId(leaseKey: string): string {
  return createHash('sha256').update(leaseKey).digest('hex').slice(0, 16)
}

function extractBearer(req: IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (typeof auth !== 'string' || auth.trim().length === 0) return null
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
  return match != null ? (match[1] ?? null) : null
}

let _instance: TeamMcpHttpBridge | null = null
export function getTeamMcpHttpBridge(): TeamMcpHttpBridge {
  if (_instance == null) _instance = new TeamMcpHttpBridge()
  return _instance
}

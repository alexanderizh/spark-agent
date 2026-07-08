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
 *   - 每次 serve() 创建独立 McpServer + StreamableHTTPServerTransport，绑定一组 tool
 *     定义 + 一个不可猜的 Bearer token；按 token 路由请求到对应 transport。
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
import { randomUUID } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ZodTypeAny } from 'zod'
import { createLogger } from '@spark/shared'

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
}

/** 一次 serve() 返回的句柄，供调用方塞进 SDKMcpServerConfig + 结束时 close。 */
export interface TeamMcpBridgeHandle {
  url: string
  token: string
  close: () => Promise<void>
}

export interface TeamMcpBridgeServeOptions {
  /** 可选：绑定的 AbortSignal（通常是 turn 的取消信号），abort 时自动吊销 token + 关闭会话。 */
  signal?: AbortSignal | undefined
}

export class TeamMcpHttpBridge {
  private server: Server | null = null
  private port = 0
  private readonly sessions = new Map<string, ServedSession>()

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
    const token = randomUUID()
    const mcp = new McpServer({ name: 'spark_team', version: '0.2.0' })
    for (const def of defs) {
      mcp.tool(def.name, def.description, def.schema, async (args: Record<string, unknown>) =>
        def.handler(args ?? {}),
      )
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })
    // MCP SDK 1.29 类型摩擦：StreamableHTTPServerTransport.onclose 声明为 (() => void) | undefined，
    // 而 Transport 接口要求 () => void，在 exactOptionalPropertyTypes 下不兼容（上游类型不一致）。断言绕过。
    await mcp.connect(transport as unknown as Transport)
    const session: ServedSession = { token, mcp, transport }
    this.sessions.set(token, session)

    const close = async (): Promise<void> => {
      if (this.sessions.delete(token)) {
        try {
          await mcp.close()
        } catch (err) {
          log.warn('team MCP bridge session close failed', err)
        }
      }
    }
    // turn 取消信号：abort 时自动吊销 token，防止已取消 turn 的 dispatcher 仍可达。
    if (opts?.signal != null) {
      if (opts.signal.aborted) {
        await close()
      } else {
        opts.signal.addEventListener('abort', () => void close(), { once: true })
      }
    }

    return {
      url: `http://127.0.0.1:${this.port}/mcp`,
      token,
      close,
    }
  }

  /** 进程退出/服务销毁时关停所有会话与 http server。 */
  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      try {
        await session.mcp.close()
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear()
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

/**
 * MCP Transport 接口定义
 *
 * Model Context Protocol 使用 JSON-RPC 2.0 进行通信。
 * Transport 层负责底层传输机制（stdio / SSE / 等）。
 */

// ─── JSON-RPC 2.0 Types ──────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

// ─── Transport Interface ─────────────────────────────────────────────────────

/**
 * MCP Transport 抽象接口
 *
 * 不同的 MCP 服务器可以采用不同的传输方式：
 * - stdio：通过子进程 stdin/stdout 通信（最常见）
 * - sse：通过 HTTP SSE 通信（远程服务器）
 */
export interface McpTransport {
  /** 建立连接 */
  connect(): Promise<void>

  /** 断开连接 */
  disconnect(): Promise<void>

  /** 发送 JSON-RPC 请求并等待响应 */
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>

  /** 注册通知处理器 */
  onNotification(handler: (notification: JsonRpcNotification) => void): void

  /** 当前是否已连接 */
  isConnected(): boolean
}

// ─── Transport Config ────────────────────────────────────────────────────────

export interface StdioTransportConfig {
  type: 'stdio'
  /** 可执行命令（如 'npx', 'node', 'python'） */
  command: string
  /** 命令参数（如 ['-y', '@modelcontextprotocol/server-github']） */
  args: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 工作目录 */
  cwd?: string
}

export interface SseTransportConfig {
  type: 'sse'
  /** MCP 服务器 URL（如 'http://localhost:3000/mcp'） */
  url: string
  /** 自定义 HTTP 头 */
  headers?: Record<string, string>
}

export interface HttpTransportConfig {
  type: 'http'
  /** MCP 服务器 URL（Streamable HTTP 单端点，如 'https://docs.apimart.ai/mcp'） */
  url: string
  /** 自定义 HTTP 头 */
  headers?: Record<string, string>
}

export type McpTransportConfig = StdioTransportConfig | SseTransportConfig | HttpTransportConfig

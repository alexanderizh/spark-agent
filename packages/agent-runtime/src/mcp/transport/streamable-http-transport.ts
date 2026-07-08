/**
 * MCP Streamable HTTP Transport
 *
 * 当前 MCP 远程传输标准（取代旧的 HTTP+SSE 双端点方案）。
 * 单端点：所有 JSON-RPC 请求都 POST 到同一个 url，服务端可返回：
 *   - `application/json`：一次性 JSON-RPC 响应
 *   - `text/event-stream`：SSE 流，逐条推送响应/通知
 *
 * 会话：服务端可能在响应头返回 `Mcp-Session-Id`，后续请求需带回。
 *
 * 参考：MCP spec 2025-03-26 “Streamable HTTP”。这里实现请求-响应所需的最小子集，
 * 满足 initialize / tools/list / tools/call 及通知；不主动开长连接监听端到端通知，
 * 而是解析每次 POST 响应里的 SSE 流。
 */

import type { McpTransport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, HttpTransportConfig } from './types.js'

const REQUEST_TIMEOUT_MS = 30_000

export class StreamableHttpTransport implements McpTransport {
  private connected = false
  private sessionId: string | null = null
  private notificationHandlers: Array<(notification: JsonRpcNotification) => void> = []

  constructor(private readonly config: HttpTransportConfig) {}

  async connect(): Promise<void> {
    // Streamable HTTP 无独立握手：initialize 由 McpClient 通过 send() 发出。
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    this.sessionId = null
  }

  isConnected(): boolean {
    return this.connected
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler)
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.connected) {
      throw new Error('MCP Streamable HTTP transport is not connected')
    }

    const isNotification = typeof request.id === 'string' && request.id.startsWith('notification-')

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.config.headers ?? {}),
      ...(this.sessionId != null ? { 'Mcp-Session-Id': this.sessionId } : {}),
    }

    const res = await fetch(this.config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    // 捕获会话 id（通常随 initialize 响应返回），供后续请求带回。
    const sid = res.headers.get('mcp-session-id')
    if (sid != null && sid.length > 0) this.sessionId = sid

    if (!res.ok) {
      throw new Error(`MCP HTTP request failed: ${res.status} ${res.statusText}`)
    }

    // 通知：服务端一般回 202 且无 JSON-RPC 主体。
    if (res.status === 202 || isNotification) {
      return { jsonrpc: '2.0', id: request.id, result: null }
    }

    const contentType = res.headers.get('content-type') ?? ''

    if (contentType.includes('text/event-stream')) {
      return await this.readEventStream(res, request.id)
    }

    // 默认按 application/json 处理
    const text = await res.text()
    if (text.trim().length === 0) {
      return { jsonrpc: '2.0', id: request.id, result: null }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(`Failed to parse MCP response: ${text.slice(0, 200)}`)
    }
    return this.pickResponse(parsed, request.id)
  }

  /** 从 SSE 流中读取，直到拿到与 request.id 匹配的响应；其余按通知分发。 */
  private async readEventStream(res: Response, requestId: string | number): Promise<JsonRpcResponse> {
    const body = res.body
    if (body == null) {
      throw new Error('MCP HTTP SSE response has no body')
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // 以空行分隔的 SSE 事件；逐个提取 data: 行
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const evt of events) {
          const dataLines = evt
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
          if (dataLines.length === 0) continue
          const data = dataLines.join('\n')
          if (data.length === 0) continue

          let message: unknown
          try {
            message = JSON.parse(data)
          } catch {
            continue
          }

          const msg = message as { id?: string | number; method?: string; result?: unknown; error?: unknown }
          if (msg.id === requestId && (msg.result !== undefined || msg.error !== undefined)) {
            return message as JsonRpcResponse
          }
          if (typeof msg.method === 'string' && msg.id === undefined) {
            for (const handler of this.notificationHandlers) {
              handler(message as JsonRpcNotification)
            }
          }
        }
      }
    } finally {
      reader.cancel().catch(() => undefined)
    }

    throw new Error(`MCP SSE stream closed before response (id=${requestId})`)
  }

  private pickResponse(parsed: unknown, requestId: string | number): JsonRpcResponse {
    // 服务端可能返回单个响应对象或批量数组
    if (Array.isArray(parsed)) {
      const match = parsed.find(
        (m) => (m as { id?: unknown }).id === requestId,
      )
      if (match != null) return match as JsonRpcResponse
      throw new Error(`MCP batch response missing id=${requestId}`)
    }
    return parsed as JsonRpcResponse
  }
}

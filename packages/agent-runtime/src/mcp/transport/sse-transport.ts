/**
 * MCP SSE Transport
 *
 * 通过 HTTP Server-Sent Events 进行 JSON-RPC 2.0 通信。
 * 适用于远程 MCP 服务器。
 *
 * 协议：
 * - 使用 HTTP POST 发送 JSON-RPC 请求
 * - 使用 SSE 接收 JSON-RPC 响应和通知
 * - 支持超时处理
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { McpTransport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, SseTransportConfig } from './types.js'

const REQUEST_TIMEOUT_MS = 30_000
const SSE_CONNECT_TIMEOUT_MS = 10_000

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class SseTransport implements McpTransport {
  private connected = false
  private sseResponse: Awaited<ReturnType<typeof fetch>> | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private pendingRequests = new Map<string | number, PendingRequest>()
  private notificationHandlers: Array<(notification: JsonRpcNotification) => void> = []
  private abortController: AbortController | null = null
  private messageEndpoint: string | null = null

  constructor(private readonly config: SseTransportConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return

    this.abortController = new AbortController()

    // First, connect to SSE endpoint to discover message endpoint
    const url = new URL(this.config.url)
    const sseUrl = url.toString()

    try {
      this.sseResponse = await fetch(sseUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          ...(this.config.headers ?? {}),
        },
        signal: AbortSignal.any([
          this.abortController.signal,
          AbortSignal.timeout(SSE_CONNECT_TIMEOUT_MS),
        ]),
      })

      if (!this.sseResponse.ok) {
        throw new Error(`MCP SSE connection failed: ${this.sseResponse.status} ${this.sseResponse.statusText}`)
      }

      // Read SSE events to discover the message endpoint
      const body = this.sseResponse.body
      if (body == null) {
        throw new Error('MCP SSE response has no body')
      }

      this.reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // Read initial SSE events to find the message endpoint
      const endpointPromise = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timed out waiting for SSE message endpoint'))
        }, SSE_CONNECT_TIMEOUT_MS)

        const processChunk = async (): Promise<void> => {
          while (true) {
            const { done, value } = await this.reader!.read()
            if (done) {
              clearTimeout(timer)
              reject(new Error('SSE stream closed before receiving message endpoint'))
              return
            }

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim()
                if (data.startsWith('/') || data.startsWith('http')) {
                  // This is the message endpoint path
                  clearTimeout(timer)
                  const endpoint = data.startsWith('http')
                    ? data
                    : `${url.origin}${data}`
                  resolve(endpoint)
                  return
                }
                // Try parsing as JSON (might contain endpoint info)
                try {
                  const parsed = JSON.parse(data) as { endpoint?: string }
                  if (parsed.endpoint != null) {
                    clearTimeout(timer)
                    resolve(parsed.endpoint)
                    return
                  }
                } catch {
                  // Not JSON, ignore
                }
              }

              // Also check for 'event: endpoint' style
              if (line.startsWith('event: endpoint')) {
                // Next data line will be the endpoint
              }
            }
          }
        }

        processChunk().catch(reject)
      })

      this.messageEndpoint = await endpointPromise
      this.connected = true

      // Continue reading SSE for server-initiated notifications (in background)
      this.readNotificationsContinuously()
    } catch (err) {
      this.cleanup()
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.cleanup()
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.connected || this.messageEndpoint == null) {
      throw new Error('MCP SSE transport is not connected')
    }

    const body = JSON.stringify(request)

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`MCP request timeout: ${request.method} (id=${request.id})`))
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(request.id, { resolve, reject, timer })

      // Send HTTP POST to message endpoint
      const url = new URL(this.messageEndpoint!)
      const isHttps = url.protocol === 'https:'
      const requestFn = isHttps ? httpsRequest : httpRequest

      const req = requestFn(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...(this.config.headers ?? {}),
          },
        },
        (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString()
          })
          res.on('end', () => {
            try {
              const response = JSON.parse(data) as JsonRpcResponse
              clearTimeout(timer)
              this.pendingRequests.delete(request.id)
              resolve(response)
            } catch {
              clearTimeout(timer)
              this.pendingRequests.delete(request.id)
              reject(new Error(`Failed to parse MCP response: ${data.slice(0, 200)}`))
            }
          })
        },
      )

      req.on('error', (err) => {
        clearTimeout(timer)
        this.pendingRequests.delete(request.id)
        reject(new Error(`MCP HTTP request failed: ${err.message}`))
      })

      req.write(body)
      req.end()
    })
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler)
  }

  isConnected(): boolean {
    return this.connected
  }

  private async readNotificationsContinuously(): Promise<void> {
    if (this.reader == null) return

    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (this.connected) {
        const { done, value } = await this.reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data.length === 0) continue

            try {
              const message = JSON.parse(data) as JsonRpcResponse | JsonRpcNotification

              if ('id' in message && ('result' in message || 'error' in message)) {
                // Response to a request
                const pending = this.pendingRequests.get(message.id)
                if (pending != null) {
                  clearTimeout(pending.timer)
                  this.pendingRequests.delete(message.id)
                  pending.resolve(message as JsonRpcResponse)
                }
              } else if ('method' in message) {
                // Notification
                for (const handler of this.notificationHandlers) {
                  handler(message as JsonRpcNotification)
                }
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch {
      // Stream closed or aborted
    }
  }

  private cleanup(): void {
    this.connected = false
    this.abortController?.abort()
    this.abortController = null

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Transport disconnected'))
    }
    this.pendingRequests.clear()

    // Close reader
    this.reader?.cancel().catch(() => undefined)
    this.reader = null
    this.sseResponse = null
    this.messageEndpoint = null
  }
}

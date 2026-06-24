/**
 * MCP stdio Transport
 *
 * 通过子进程 stdin/stdout 进行 JSON-RPC 2.0 通信。
 * 这是最常见的 MCP 服务器连接方式。
 *
 * 协议：
 * - 每条 JSON-RPC 消息以换行符 \n 分隔
 * - 请求/响应通过 id 字段匹配
 * - 支持超时处理
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'
import { createLogger } from '@spark/shared'
import type { McpTransport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, StdioTransportConfig } from './types.js'

const log = createLogger('mcp:stdio')

const REQUEST_TIMEOUT_MS = 30_000

/** Cap on retained stderr so a chatty server can't grow the buffer unbounded. */
const MAX_STDERR_BUFFER = 8_192

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class StdioTransport implements McpTransport {
  private process: ChildProcess | null = null
  private readline: Interface | null = null
  private connected = false
  private pendingRequests = new Map<string | number, PendingRequest>()
  private notificationHandlers: Array<(notification: JsonRpcNotification) => void> = []
  private messageBuffer = ''
  /** Tail of the subprocess's stderr — surfaced when it exits non-zero so the
   *  real startup error (module-resolution crashes, missing binaries, etc.) is
   *  visible instead of a bare "process exited (code=1)". */
  private stderrTail = ''

  constructor(private readonly config: StdioTransportConfig) {}

  async connect(): Promise<void> {
    if (this.connected && this.process != null) {
      return
    }

    const env = {
      ...process.env,
      ...(this.config.env ?? {}),
    }

    this.process = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Detach stdio so we can manage lifecycle
      detached: false,
    })

    // Handle process errors
    this.process.on('error', (err) => {
      this.cleanup()
      throw new Error(`MCP stdio process error: ${err.message}`)
    })

    this.process.on('exit', (code, signal) => {
      if (this.connected) {
        const detail = this.stderrTail.trim()
        const suffix = detail.length > 0 ? `: ${detail}` : ''
        if (code != null && code !== 0) {
          log.error(`MCP stdio process exited (code=${code}, signal=${signal})${suffix}`)
        }
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timer)
          pending.reject(new Error(`MCP server process exited (code=${code}, signal=${signal})${suffix}`))
          this.pendingRequests.delete(id)
        }
        this.connected = false
      }
    })

    // Parse stdout line by line for JSON-RPC messages
    this.readline = createInterface({ input: this.process.stdout! })

    this.readline.on('line', (line: string) => {
      this.handleMessage(line)
    })

    // Capture + log stderr for debugging. Most servers use stderr for
    // diagnostics (and the MCP spec reserves stdout for JSON-RPC), so this is
    // non-fatal noise during normal operation — but it's exactly where startup
    // crashes print their stack trace, so we retain the tail for the exit error.
    this.process.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      if (text.trim().length === 0) return
      this.stderrTail = (this.stderrTail + text).slice(-MAX_STDERR_BUFFER)
      log.debug(`[stderr] ${text.trim()}`)
    })

    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.cleanup()
  }

  send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.connected || this.process?.stdin == null) {
      return Promise.reject(new Error('MCP stdio transport is not connected'))
    }

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`MCP request timeout: ${request.method} (id=${request.id})`))
      }, REQUEST_TIMEOUT_MS)

      this.pendingRequests.set(request.id, { resolve, reject, timer })

      const message = JSON.stringify(request) + '\n'
      this.process!.stdin!.write(message, (err) => {
        if (err != null) {
          clearTimeout(timer)
          this.pendingRequests.delete(request.id)
          reject(new Error(`Failed to write to MCP server stdin: ${err.message}`))
        }
      })
    })
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandlers.push(handler)
  }

  isConnected(): boolean {
    return this.connected && this.process != null && !this.process.killed
  }

  private handleMessage(line: string): void {
    if (line.trim().length === 0) return

    // Accumulate message buffer for multi-line messages
    this.messageBuffer += line

    try {
      const message = JSON.parse(this.messageBuffer) as JsonRpcResponse | JsonRpcNotification
      this.messageBuffer = ''

      if ('id' in message && ('result' in message || 'error' in message)) {
        // This is a response
        const response = message as JsonRpcResponse
        const pending = this.pendingRequests.get(response.id)
        if (pending != null) {
          clearTimeout(pending.timer)
          this.pendingRequests.delete(response.id)
          pending.resolve(response)
        }
      } else if ('method' in message && !('id' in message && ('result' in message || 'error' in message))) {
        // This is a notification (has method, might have id but no result/error)
        const notification = message as JsonRpcNotification
        for (const handler of this.notificationHandlers) {
          handler(notification)
        }
      }
    } catch {
      // Not a complete JSON message yet, keep buffering
      // If the buffer gets too large, reset it
      if (this.messageBuffer.length > 1_000_000) {
        this.messageBuffer = ''
      }
    }
  }

  private cleanup(): void {
    this.connected = false

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Transport disconnected'))
    }
    this.pendingRequests.clear()

    // Close readline
    this.readline?.close()
    this.readline = null

    // Kill process
    if (this.process != null && !this.process.killed) {
      try {
        this.process.stdin?.end()
        this.process.kill('SIGTERM')

        // Force kill after 3 seconds
        setTimeout(() => {
          if (!this.process!.killed) {
            this.process!.kill('SIGKILL')
          }
        }, 3000)
      } catch {
        // Ignore cleanup errors
      }
    }
    this.process = null
    this.messageBuffer = ''
  }
}

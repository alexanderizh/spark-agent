import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type {
  AppServerClientInfo,
  AppServerInitializeParams,
  JsonRpcClientRequest,
  JsonRpcErrorShape,
  JsonRpcNotificationFrame,
  JsonRpcResponseFrame,
  JsonRpcServerRequestFrame,
} from './app-server-protocol.js'

/**
 * codex app-server 的最小 JSON-RPC/NDJSON 客户端。
 *
 * 只做三件事：spawn 子进程、把 stdout 按行解成 JSON-RPC 帧并路由
 * （响应 → pending 请求 / server 请求 → 审批回调 / 通知 → 分发）、
 * 把请求串行写到 stdin。协议语义（turn 生命周期、事件映射）全部留在 executor。
 *
 * 跨平台注意：
 * - spawn 不经 shell，路径由调用方给绝对路径（受管运行时解析已在 executor 侧完成）。
 * - 行分割按 `\n` 并剥离 `\r`：Rust 侧 writeln! 只写 `\n`，这里防御 Windows 管道
 *   可能出现的 CRLF；首行额外剥离 BOM。
 * - 终止统一走 kill()：POSIX 是 SIGTERM，Windows 映射 TerminateProcess，
 *   与 CodexCliExecutor 的 cancel 行为一致。
 */

export interface CodexAppServerClientOptions {
  executablePath: string
  /** 默认 `['app-server']`；测试用 node 脚本替身时覆盖。 */
  args?: string[] | undefined
  cwd?: string | undefined
  env?: Record<string, string> | undefined
  onNotification: (method: string, params: unknown) => void
  /**
   * server → client 请求（审批等）。回调必须在同步路径里或尽快调用 respond/reject，
   * 否则上游 turn 挂起——这是 app-server 传输的核心约束（见方案文档风险项 2）。
   */
  onServerRequest: (
    method: string,
    params: unknown,
    respond: (result: unknown) => void,
    reject: (error: JsonRpcErrorShape) => void,
  ) => void
  onExit?:
    | ((code: number | null, signal: NodeJS.Signals | null, stderrTail: string) => void)
    | undefined
  /** stdout/stderr 解析等内部异常的兜底出口（不致命，但不应静默）。 */
  onProtocolError?: ((error: Error) => void) | undefined
}

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

type JsonRpcResultFrame = { jsonrpc: '2.0'; id: number; result?: unknown }
type JsonRpcErrorFrame = { jsonrpc: '2.0'; id: number; error: JsonRpcErrorShape }

export class CodexAppServerProcessExitedError extends Error {
  constructor(
    public readonly exitCode: number | null,
    public readonly signal: NodeJS.Signals | null,
    public readonly stderrTail: string,
  ) {
    super(
      `codex app-server process exited before responding (code=${exitCode ?? 'null'} signal=${signal ?? 'null'})${stderrTail.length > 0 ? `: ${stderrTail}` : ''}`,
    )
    this.name = 'CodexAppServerProcessExitedError'
  }
}

export class CodexAppServerRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly rpcError: JsonRpcErrorShape,
  ) {
    super(`codex app-server request ${method} failed: ${rpcError.code} ${rpcError.message}`)
    this.name = 'CodexAppServerRequestError'
  }
}

export class CodexAppServerTimeoutError extends Error {
  constructor(
    public readonly method: string,
    timeoutMs: number,
  ) {
    super(`codex app-server request ${method} timed out after ${timeoutMs}ms`)
    this.name = 'CodexAppServerTimeoutError'
  }
}

const STDERR_TAIL_LIMIT = 4096

export class CodexAppServerClient {
  private readonly child: ChildProcess
  private readonly options: CodexAppServerClientOptions
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly stderrChunks: Buffer[] = []
  private stderrBytes = 0
  private exited = false
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null
  private stdinClosed = false

  private constructor(child: ChildProcess, options: CodexAppServerClientOptions) {
    this.child = child
    this.options = options

    child.on('error', (err) => {
      this.failPending(new Error(`codex app-server process error: ${err.message}`))
    })
    child.on('exit', (code, signal) => {
      this.exited = true
      this.exitInfo = { code, signal }
      this.failPending(new CodexAppServerProcessExitedError(code, signal, this.stderrTail()))
      this.options.onExit?.(code, signal, this.stderrTail())
    })

    const stdout = child.stdout
    const stderr = child.stderr
    if (stdout != null) {
      const reader = createInterface({ input: stdout, crlfDelay: Infinity })
      let firstLine = true
      reader.on('line', (line) => {
        let text = line
        if (firstLine) {
          text = text.replace(/^\uFEFF/, '')
          firstLine = false
        }
        if (text.trim().length === 0) return
        this.dispatchFrame(text)
      })
    }
    if (stderr != null) {
      stderr.on('data', (chunk: Buffer) => {
        this.stderrChunks.push(chunk)
        this.stderrBytes += chunk.length
        while (this.stderrBytes > STDERR_TAIL_LIMIT && this.stderrChunks.length > 1) {
          this.stderrBytes -= this.stderrChunks[0]?.length ?? 0
          this.stderrChunks.shift()
        }
      })
    }
  }

  /** spawn 并等待进程就绪（不发送任何请求）。spawn 失败（ENOENT 等）抛错。 */
  static spawn(options: CodexAppServerClientOptions): CodexAppServerClient {
    const args = options.args ?? ['app-server']
    const child = spawn(options.executablePath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    // spawn ENOENT 异步派发 'error' 事件；这里提前挂钩，把错误送到 pending，
    // initialize 的调用方会立即收到失败（prepare 阶段由此触发回退）。
    return new CodexAppServerClient(child, options)
  }

  get hasExited(): boolean {
    return this.exited
  }

  exitedCode(): { code: number | null; signal: NodeJS.Signals | null } | null {
    return this.exitInfo
  }

  stderrTail(): string {
    return Buffer.concat(this.stderrChunks).toString('utf8').slice(-STDERR_TAIL_LIMIT)
  }

  async initialize(clientInfo: AppServerClientInfo, timeoutMs = 15_000): Promise<void> {
    const params: AppServerInitializeParams = { clientInfo }
    await this.request('initialize', params, timeoutMs)
  }

  async request<T>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    if (this.exited) {
      throw new CodexAppServerProcessExitedError(
        this.exitInfo?.code ?? null,
        this.exitInfo?.signal ?? null,
        this.stderrTail(),
      )
    }
    const id = this.nextRequestId
    this.nextRequestId += 1
    const frame: JsonRpcClientRequest =
      params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params }
    const promise = new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.pending.delete(id)
                reject(new CodexAppServerTimeoutError(method, timeoutMs))
              }, timeoutMs)
            : null,
      }
      this.pending.set(id, pending)
    })
    // timer 不应让测试进程滞留（vitest 环境 unref 不可用时忽略）。
    const entry = this.pending.get(id)
    if (entry?.timer != null && typeof entry.timer.unref === 'function') entry.timer.unref()
    this.writeFrame(frame)
    return promise
  }

  notification(method: string, params?: unknown): void {
    const frame: JsonRpcNotificationFrame =
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params }
    this.writeFrame(frame)
  }

  /** 主动终止（幂等）。优雅关闭依赖进程侧对 stdin 关闭的处理，不强求。 */
  kill(): void {
    if (this.exited) return
    try {
      this.child.kill('SIGTERM')
    } catch {
      // 已退出/不可杀时忽略；exit 事件负责收尾。
    }
  }

  async dispose(): Promise<void> {
    this.kill()
    if (this.exited) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve()
      }, 2_000)
      if (typeof timer.unref === 'function') timer.unref()
      this.child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private writeFrame(
    frame: JsonRpcClientRequest | JsonRpcNotificationFrame | JsonRpcResultFrame | JsonRpcErrorFrame,
  ): void {
    const stdin = this.child.stdin
    if (stdin == null || this.stdinClosed || this.exited) return
    try {
      stdin.write(`${JSON.stringify(frame)}\n`)
    } catch {
      // EPIPE 等：进程正在退出，exit 事件会 reject pending。
    }
  }

  private dispatchFrame(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      this.options.onProtocolError?.(
        new Error(`codex app-server sent a non-JSON line: ${(err as Error).message}`),
      )
      return
    }
    if (parsed == null || typeof parsed !== 'object') return
    const frame = parsed as Partial<JsonRpcResponseFrame> &
      Partial<JsonRpcServerRequestFrame> &
      Partial<JsonRpcNotificationFrame>

    if (typeof frame.id === 'number') {
      if (frame.method != null && typeof frame.method === 'string') {
        this.handleServerRequest(frame as JsonRpcServerRequestFrame)
        return
      }
      this.handleResponse(frame as JsonRpcResponseFrame)
      return
    }
    if (typeof frame.method === 'string') {
      this.options.onNotification(frame.method, frame.params)
    }
  }

  private handleResponse(frame: JsonRpcResponseFrame): void {
    const pending = this.pending.get(frame.id)
    if (pending == null) return
    this.pending.delete(frame.id)
    if (pending.timer != null) clearTimeout(pending.timer)
    if (frame.error != null) {
      pending.reject(new CodexAppServerRequestError(pending.method, frame.error))
      return
    }
    pending.resolve(frame.result)
  }

  private handleServerRequest(frame: JsonRpcServerRequestFrame): void {
    const id = frame.id
    const respond = (result: unknown): void => {
      this.writeFrame({ jsonrpc: '2.0', id, result })
    }
    const reject = (error: JsonRpcErrorShape): void => {
      this.writeFrame({ jsonrpc: '2.0', id, error })
    }
    try {
      this.options.onServerRequest(frame.method ?? '', frame.params, respond, reject)
    } catch (err) {
      // 回调自身异常不能让帧解析崩掉；以内部错误回拒，保证上游不挂起。
      reject({ code: -32603, message: `internal error: ${(err as Error).message}` })
    }
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      if (pending.timer != null) clearTimeout(pending.timer)
      pending.reject(error)
    }
  }
}

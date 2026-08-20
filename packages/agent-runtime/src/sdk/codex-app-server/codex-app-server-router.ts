import type { JsonRpcErrorShape } from './app-server-protocol.js'

export type AppServerRespond = (result: unknown) => void
export type AppServerReject = (error: JsonRpcErrorShape) => void

export interface CodexAppServerRouteHandlers {
  onNotification: (method: string, params: unknown) => void
  onServerRequest: (
    method: string,
    params: unknown,
    respond: AppServerRespond,
    reject: AppServerReject,
  ) => void
  onTransportFailure: (error: Error) => void
}

export interface CodexAppServerRoute {
  readonly threadId: string
  readonly serverTurnId: string | null
  bindTurn(serverTurnId: string): void
  close(): void
}

export interface CodexAppServerRouterOptions {
  onHandlerError?: ((error: Error) => void) | undefined
  onUnroutedNotification?: ((method: string, params: unknown) => void) | undefined
  onUnroutedServerRequest?:
    | ((
        method: string,
        params: unknown,
        respond: AppServerRespond,
        reject: AppServerReject,
      ) => void)
    | undefined
}

type RoutingIds = {
  threadId: string | null
  turnId: string | null
}

type BufferedRouteFrame =
  | { kind: 'notification'; method: string; params: unknown; turnId: string }
  | {
      kind: 'server-request'
      method: string
      params: unknown
      turnId: string
      respond: AppServerRespond
      reject: AppServerReject
    }

const ROUTE_UNAVAILABLE_ERROR: JsonRpcErrorShape = {
  code: -32001,
  message: 'no active Spark turn route for codex app-server request',
}

/**
 * App Server 帧到 Spark turn 的动态路由层。
 *
 * transport 只负责 JSON-RPC request id；本类负责 thread / turn 归属。executor 在
 * `turn/start` 前先注册 thread route，待 response 返回真实 turn id 后调用 bindTurn。
 * 这段窗口内带 turnId 的通知或 server request 会按到达顺序缓存，绑定后只回放属于
 * 当前 turn 的帧，避免上一轮迟到事件串入新 turn。
 */
export class CodexAppServerRouter {
  private readonly threadRoutes = new Map<string, RouteEntry>()
  private readonly turnRoutes = new Map<string, RouteEntry>()
  private readonly routes = new Set<RouteEntry>()
  private readonly options: CodexAppServerRouterOptions
  private transportFailure: Error | null = null

  constructor(options: CodexAppServerRouterOptions = {}) {
    this.options = options
  }

  registerThread(threadId: string, handlers: CodexAppServerRouteHandlers): CodexAppServerRoute {
    if (this.transportFailure != null) throw this.transportFailure
    if (threadId.length === 0) throw new Error('codex app-server route requires a thread id')
    if (this.threadRoutes.has(threadId)) {
      throw new Error(`codex app-server thread already has an active route: ${threadId}`)
    }
    const route = new RouteEntry(this, threadId, handlers)
    this.threadRoutes.set(threadId, route)
    this.routes.add(route)
    return route
  }

  handleNotification(method: string, params: unknown): void {
    const { threadId, turnId } = readRoutingIds(params)
    const route = this.resolveRoute(threadId, turnId)
    if (route == null) {
      this.options.onUnroutedNotification?.(method, params)
      return
    }
    route.acceptNotification(method, params, turnId)
  }

  handleServerRequest(
    method: string,
    params: unknown,
    respond: AppServerRespond,
    reject: AppServerReject,
  ): void {
    const { threadId, turnId } = readRoutingIds(params)
    const route = this.resolveRoute(threadId, turnId)
    if (route == null) {
      const fallback = this.options.onUnroutedServerRequest
      if (fallback == null) {
        reject(ROUTE_UNAVAILABLE_ERROR)
        return
      }
      try {
        fallback(method, params, respond, reject)
      } catch (error) {
        reject({ code: -32603, message: `internal error: ${toError(error).message}` })
      }
      return
    }
    route.acceptServerRequest(method, params, turnId, respond, reject)
  }

  handleTransportFailure(error: Error): void {
    if (this.transportFailure != null) return
    this.transportFailure = error
    for (const route of [...this.routes]) route.fail(error)
    this.threadRoutes.clear()
    this.turnRoutes.clear()
    this.routes.clear()
  }

  bindTurn(route: RouteEntry, serverTurnId: string): void {
    if (!this.routes.has(route)) throw new Error('cannot bind a closed codex app-server route')
    const existing = this.turnRoutes.get(serverTurnId)
    if (existing != null && existing !== route) {
      throw new Error(`codex app-server turn already has an active route: ${serverTurnId}`)
    }
    this.turnRoutes.set(serverTurnId, route)
  }

  closeRoute(route: RouteEntry): void {
    if (!this.routes.delete(route)) return
    if (this.threadRoutes.get(route.threadId) === route) this.threadRoutes.delete(route.threadId)
    if (route.serverTurnId != null && this.turnRoutes.get(route.serverTurnId) === route) {
      this.turnRoutes.delete(route.serverTurnId)
    }
  }

  reportHandlerError(error: Error): void {
    this.options.onHandlerError?.(error)
  }

  reportUnrouted(method: string, params: unknown): void {
    this.options.onUnroutedNotification?.(method, params)
  }

  private resolveRoute(threadId: string | null, turnId: string | null): RouteEntry | null {
    if (turnId != null) {
      const turnRoute = this.turnRoutes.get(turnId)
      if (turnRoute != null) return turnRoute
      if (threadId != null) {
        const threadRoute = this.threadRoutes.get(threadId) ?? null
        // turn/start response 前，真实 turn id 尚未 bind，只能先按 thread 缓存抢跑帧。
        // route 一旦绑定到别的 turn，明确但未知的 turn id 就是迟到/跨 turn 帧，禁止
        // 再按相同 threadId 回退，否则会把旧 turn/completed 送进新一轮。
        return threadRoute?.serverTurnId == null ? threadRoute : null
      }
      return null
    }
    if (threadId != null) return this.threadRoutes.get(threadId) ?? null
    // 兼容旧协议/全局错误帧：只有唯一 active route 时归属无歧义；一旦同 transport
    // 存在多个 route，必须丢弃/拒绝，不能把无 ID 帧猜给任意 turn。
    if (this.routes.size === 1) return this.routes.values().next().value ?? null
    return null
  }
}

class RouteEntry implements CodexAppServerRoute {
  private readonly router: CodexAppServerRouter
  private readonly handlers: CodexAppServerRouteHandlers
  private buffered: BufferedRouteFrame[] = []
  private boundTurnId: string | null = null
  private closed = false

  constructor(
    router: CodexAppServerRouter,
    readonly threadId: string,
    handlers: CodexAppServerRouteHandlers,
  ) {
    this.router = router
    this.handlers = handlers
  }

  get serverTurnId(): string | null {
    return this.boundTurnId
  }

  bindTurn(serverTurnId: string): void {
    if (this.closed) throw new Error('cannot bind a closed codex app-server route')
    if (serverTurnId.length === 0) throw new Error('codex app-server route requires a turn id')
    if (this.boundTurnId != null && this.boundTurnId !== serverTurnId) {
      throw new Error(
        `codex app-server route is already bound to ${this.boundTurnId}, cannot bind ${serverTurnId}`,
      )
    }
    if (this.boundTurnId === serverTurnId) return
    this.router.bindTurn(this, serverTurnId)
    this.boundTurnId = serverTurnId
    const pending = this.buffered
    this.buffered = []
    for (const frame of pending) {
      if (frame.turnId !== serverTurnId) {
        if (frame.kind === 'server-request') frame.reject(ROUTE_UNAVAILABLE_ERROR)
        else this.router.reportUnrouted(frame.method, frame.params)
        continue
      }
      if (frame.kind === 'notification') {
        this.deliverNotification(frame.method, frame.params)
      } else {
        this.deliverServerRequest(frame.method, frame.params, frame.respond, frame.reject)
      }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.router.closeRoute(this)
    const pending = this.buffered
    this.buffered = []
    for (const frame of pending) {
      if (frame.kind === 'server-request') frame.reject(ROUTE_UNAVAILABLE_ERROR)
    }
  }

  fail(error: Error): void {
    if (this.closed) return
    this.close()
    try {
      this.handlers.onTransportFailure(error)
    } catch (handlerError) {
      this.router.reportHandlerError(
        new Error(
          `codex app-server transport failure handler failed: ${toError(handlerError).message}`,
        ),
      )
    }
  }

  acceptNotification(method: string, params: unknown, turnId: string | null): void {
    if (this.closed) return
    if (turnId != null && this.boundTurnId == null) {
      this.buffered.push({ kind: 'notification', method, params, turnId })
      return
    }
    if (turnId != null && turnId !== this.boundTurnId) {
      this.router.reportUnrouted(method, params)
      return
    }
    this.deliverNotification(method, params)
  }

  acceptServerRequest(
    method: string,
    params: unknown,
    turnId: string | null,
    respond: AppServerRespond,
    reject: AppServerReject,
  ): void {
    if (this.closed) {
      reject(ROUTE_UNAVAILABLE_ERROR)
      return
    }
    if (turnId != null && this.boundTurnId == null) {
      this.buffered.push({
        kind: 'server-request',
        method,
        params,
        turnId,
        respond,
        reject,
      })
      return
    }
    if (turnId != null && turnId !== this.boundTurnId) {
      reject(ROUTE_UNAVAILABLE_ERROR)
      return
    }
    this.deliverServerRequest(method, params, respond, reject)
  }

  private deliverNotification(method: string, params: unknown): void {
    try {
      this.handlers.onNotification(method, params)
    } catch (error) {
      this.router.reportHandlerError(
        new Error(
          `codex app-server notification handler failed for ${method}: ${toError(error).message}`,
        ),
      )
    }
  }

  private deliverServerRequest(
    method: string,
    params: unknown,
    respond: AppServerRespond,
    reject: AppServerReject,
  ): void {
    try {
      this.handlers.onServerRequest(method, params, respond, reject)
    } catch (error) {
      reject({ code: -32603, message: `internal error: ${toError(error).message}` })
    }
  }
}

function readRoutingIds(params: unknown): RoutingIds {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    return { threadId: null, turnId: null }
  }
  const record = params as Record<string, unknown>
  const nestedTurn =
    record.turn != null && typeof record.turn === 'object' && !Array.isArray(record.turn)
      ? (record.turn as Record<string, unknown>)
      : null
  return {
    threadId: readNonEmptyString(record.threadId),
    turnId: readNonEmptyString(record.turnId) ?? readNonEmptyString(nestedTurn?.id),
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

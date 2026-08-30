import { describe, expect, it, vi } from 'vitest'
import {
  CodexAppServerRouter,
  type CodexAppServerRouteHandlers,
} from '../../sdk/codex-app-server/codex-app-server-router.js'

function createHandlers() {
  const notifications: Array<{ method: string; params: unknown }> = []
  const requests: string[] = []
  const failures: Error[] = []
  const handlers: CodexAppServerRouteHandlers = {
    onNotification: (method, params) => notifications.push({ method, params }),
    onServerRequest: (method, _params, respond) => {
      requests.push(method)
      respond({ decision: 'accept' })
    },
    onTransportFailure: (error) => failures.push(error),
  }
  return { handlers, notifications, requests, failures }
}

describe('CodexAppServerRouter', () => {
  it('turn/start 响应前缓存带 turnId 的通知，绑定后按到达顺序回放', () => {
    const router = new CodexAppServerRouter()
    const target = createHandlers()
    const route = router.registerThread('thread-1', target.handlers)

    router.handleNotification('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1', status: 'inProgress' },
    })
    router.handleNotification('item/agentMessage/delta', {
      threadId: 'thread-1',
      turnId: 'turn-1',
      delta: 'hello',
    })
    expect(target.notifications).toEqual([])

    route.bindTurn('turn-1')
    expect(target.notifications.map((entry) => entry.method)).toEqual([
      'turn/started',
      'item/agentMessage/delta',
    ])
  })

  it('绑定 turn 时丢弃上一轮迟到通知，避免串入新 turn', () => {
    const unrouted: string[] = []
    const router = new CodexAppServerRouter({
      onUnroutedNotification: (method) => unrouted.push(method),
    })
    const target = createHandlers()
    const route = router.registerThread('thread-1', target.handlers)
    router.handleNotification('turn/completed', { threadId: 'thread-1', turnId: 'turn-old' })
    router.handleNotification('turn/started', { threadId: 'thread-1', turnId: 'turn-new' })

    route.bindTurn('turn-new')

    expect(target.notifications.map((entry) => entry.method)).toEqual(['turn/started'])
    expect(unrouted).toEqual(['turn/completed'])
  })

  it('同 thread 新 route 已绑定后拒绝旧 turn 的嵌套 lifecycle 帧', () => {
    const unrouted: string[] = []
    const router = new CodexAppServerRouter({
      onUnroutedNotification: (method) => unrouted.push(method),
    })
    const previous = router.registerThread('thread-1', createHandlers().handlers)
    previous.bindTurn('turn-old')
    previous.close()
    const current = createHandlers()
    const currentRoute = router.registerThread('thread-1', current.handlers)
    currentRoute.bindTurn('turn-new')

    router.handleNotification('turn/completed', {
      threadId: 'thread-1',
      turn: { id: 'turn-old', status: 'completed' },
    })

    expect(current.notifications).toHaveLength(0)
    expect(unrouted).toEqual(['turn/completed'])
  })

  it('按 turnId 优先路由，两个 thread route 不会串流', () => {
    const router = new CodexAppServerRouter()
    const first = createHandlers()
    const second = createHandlers()
    const firstRoute = router.registerThread('thread-1', first.handlers)
    const secondRoute = router.registerThread('thread-2', second.handlers)
    firstRoute.bindTurn('turn-1')
    secondRoute.bindTurn('turn-2')

    router.handleNotification('item/completed', {
      threadId: 'thread-2',
      turnId: 'turn-1',
    })

    expect(first.notifications).toHaveLength(1)
    expect(second.notifications).toHaveLength(0)
  })

  it('无路由 ID 的旧协议帧仅在唯一 active route 时兼容投递', () => {
    const router = new CodexAppServerRouter()
    const first = createHandlers()
    const second = createHandlers()
    router.registerThread('thread-1', first.handlers)
    router.handleNotification('error', { error: { message: 'legacy error' } })
    expect(first.notifications.map((entry) => entry.method)).toEqual(['error'])

    router.registerThread('thread-2', second.handlers)
    router.handleNotification('error', { error: { message: 'ambiguous error' } })
    expect(first.notifications.map((entry) => entry.method)).toEqual(['error'])
    expect(second.notifications).toHaveLength(0)
  })

  it('抢跑 server request 在 bind 后交给当前 turn，旧 turn request 被拒绝', () => {
    const router = new CodexAppServerRouter()
    const target = createHandlers()
    const route = router.registerThread('thread-1', target.handlers)
    const accepted = vi.fn()
    const staleRejected = vi.fn()
    const currentRejected = vi.fn()

    router.handleServerRequest(
      'item/fileChange/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-old' },
      vi.fn(),
      staleRejected,
    )
    router.handleServerRequest(
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-new' },
      accepted,
      currentRejected,
    )
    route.bindTurn('turn-new')

    expect(staleRejected).toHaveBeenCalledWith(expect.objectContaining({ code: -32001 }))
    expect(currentRejected).not.toHaveBeenCalled()
    expect(target.requests).toEqual(['item/commandExecution/requestApproval'])
    expect(accepted).toHaveBeenCalledWith({ decision: 'accept' })
  })

  it('未知归属的 server request 立即 reject，不留下 waiter', () => {
    const router = new CodexAppServerRouter()
    const reject = vi.fn()
    router.handleServerRequest(
      'item/tool/requestUserInput',
      { threadId: 'missing', turnId: 'missing' },
      vi.fn(),
      reject,
    )
    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ code: -32001 }))
  })

  it('宿主可为未知归属请求提供最小权限兜底', () => {
    const router = new CodexAppServerRouter({
      onUnroutedServerRequest: (_method, _params, respond) => {
        respond({ decision: 'deny' })
      },
    })
    const respond = vi.fn()
    router.handleServerRequest(
      'item/commandExecution/requestApproval',
      { threadId: 'closed-thread', turnId: 'closed-turn' },
      respond,
      vi.fn(),
    )
    expect(respond).toHaveBeenCalledWith({ decision: 'deny' })
  })

  it('transport 退出广播所有 route，并拒绝后续注册', () => {
    const router = new CodexAppServerRouter()
    const first = createHandlers()
    const second = createHandlers()
    router.registerThread('thread-1', first.handlers)
    router.registerThread('thread-2', second.handlers)
    const failure = new Error('transport exited')

    router.handleTransportFailure(failure)

    expect(first.failures).toEqual([failure])
    expect(second.failures).toEqual([failure])
    expect(() => router.registerThread('thread-3', createHandlers().handlers)).toThrow(failure)
  })

  it('route 关闭后拒绝已缓存请求并允许同 thread 重新注册', () => {
    const router = new CodexAppServerRouter()
    const route = router.registerThread('thread-1', createHandlers().handlers)
    const reject = vi.fn()
    router.handleServerRequest(
      'item/commandExecution/requestApproval',
      { threadId: 'thread-1', turnId: 'turn-1' },
      vi.fn(),
      reject,
    )

    route.close()

    expect(reject).toHaveBeenCalledWith(expect.objectContaining({ code: -32001 }))
    expect(() => router.registerThread('thread-1', createHandlers().handlers)).not.toThrow()
  })

  it('通知 handler 异常被隔离并报告，后续通知仍可处理', () => {
    const errors: Error[] = []
    const seen: string[] = []
    const router = new CodexAppServerRouter({ onHandlerError: (error) => errors.push(error) })
    const route = router.registerThread('thread-1', {
      onNotification: (method) => {
        seen.push(method)
        if (method === 'first') throw new Error('persist failed')
      },
      onServerRequest: vi.fn(),
      onTransportFailure: vi.fn(),
    })
    route.bindTurn('turn-1')

    router.handleNotification('first', { threadId: 'thread-1', turnId: 'turn-1' })
    router.handleNotification('second', { threadId: 'thread-1', turnId: 'turn-1' })

    expect(seen).toEqual(['first', 'second'])
    expect(errors[0]?.message).toContain('persist failed')
  })
})

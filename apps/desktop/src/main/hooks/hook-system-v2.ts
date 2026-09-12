/**
 * HookSystemV2 — 主进程 Hook 运行时组装根（设计方案 §5/§14）。
 *
 * 职责：把 HookLifecycleBridge（事件发射）、HookDispatcher（派发）、HookWorker
 * （执行）与内置动作处理器（系统通知/提示音）、统一工具网关组装成单例，
 * 并挂到 SessionService / PermissionService 上。ipc/index.ts 只保留薄接线。
 *
 * 生命周期事实 → outbox（hook_events）→ 派发 → 队列（hook_runs）→ Worker 执行。
 * Hook 执行失败不改变已发生的 Turn 终态（失败隔离）。
 */

import { Notification, shell } from 'electron'
import type { SparkDatabase } from '@spark/storage'
import {
  HookDispatcher,
  HookLifecycleBridge,
  HookManagementService,
  HookWorker,
  type HookBuiltinActionHandlers,
  type HookErrorCodeV1,
  type HookToolGateway,
} from '@spark/agent-runtime'
import { shouldSuppressSessionNotification } from '../services/AppUnreadBadgeService.js'
import { getMainWindow } from '../windows/index.js'
import { pushStreamEvent } from '../ipc/typed-ipc.js'
import { createLogger } from '@spark/shared'

const log = createLogger('hooks:v2')

const WORKER_POLL_INTERVAL_MS = 2_000

export interface HookSystemV2Deps {
  db: SparkDatabase
  /** 惰性获取 SessionService（工具网关经统一工具目录解析/调用工具）。 */
  getSessionService: () => unknown
}

/** 工具动作错误到稳定错误码的归类：网络/超时类可重试，其余为确定性失败。 */
function classifyToolError(error: unknown): { errorCode: HookErrorCodeV1; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const transient =
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|network|fetch failed|aborted|timeout/i.test(
      message,
    )
  return transient
    ? { errorCode: 'transient_failure', message }
    : { errorCode: 'action_failed', message }
}

function createBuiltinActionHandlers(): HookBuiltinActionHandlers {
  return {
    notification: async ({ title, body, sessionId }) => {
      if (shouldSuppressSessionNotification(sessionId, getMainWindow()?.isFocused() === true)) {
        return false
      }
      if (!Notification.isSupported()) {
        log.warn('[hooks-v2] system notifications not supported')
        return false
      }
      const navigationTarget = { target: 'session' as const, sessionId, reason: 'hook' as const }
      const notification = new Notification({ title, body: body ?? '', silent: true })
      notification.on('click', () => {
        const mainWindow = getMainWindow()
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
        pushStreamEvent('stream:system-notification:navigate', navigationTarget)
      })
      notification.show()
      return true
    },
    sound: async () => {
      shell.beep()
      return true
    },
  }
}

function createHookToolGateway(deps: HookSystemV2Deps): HookToolGateway {
  const listHookVisibleTools = async (options: {
    sessionId?: string
    turnId?: string
    hookId?: string
    hookRunId?: string
    eventId?: string
  }) => {
    const sessionService = deps.getSessionService() as {
      listUnifiedTools?: (context?: Record<string, unknown>) => Promise<
        Array<{
          sourceKind: string
          sourceId: string
          version?: string
          toolName?: string
          qualifiedName: string
          tool: { risk: string; effect: string; idempotency: string }
          invoke: (input: Record<string, unknown>) => Promise<unknown>
        }>
      >
    }
    if (sessionService?.listUnifiedTools == null) return []
    return await sessionService.listUnifiedTools({
      invocationSource: 'hook',
      ...(options.sessionId != null ? { sessionId: options.sessionId } : {}),
      ...(options.turnId != null ? { turnId: options.turnId } : {}),
      ...(options.hookId != null && options.hookRunId != null && options.eventId != null
        ? {
            hookAttribution: {
              hookId: options.hookId,
              hookRunId: options.hookRunId,
              eventId: options.eventId,
            },
          }
        : {}),
    })
  }

  const findEntry = async (
    target: {
      sourceKind: string
      sourceId: string
      toolName: string
      qualifiedName: string
      version?: string
    },
    tools: Awaited<ReturnType<typeof listHookVisibleTools>>,
  ) =>
    tools.find(
      (entry) =>
        entry.sourceKind === target.sourceKind &&
        entry.sourceId === target.sourceId &&
        (entry.toolName === target.toolName || entry.qualifiedName === target.qualifiedName),
    )

  return {
    describeTool: async (target) => {
      try {
        const tools = await listHookVisibleTools({})
        const entry = await findEntry(target, tools)
        if (entry == null) return { found: false }
        return {
          found: true,
          governance: {
            risk: entry.tool.risk as 'read' | 'low-write' | 'high-write' | 'destructive',
            effect: entry.tool.effect,
            idempotency: entry.tool.idempotency as 'safe' | 'keyed' | 'unsafe',
            enabled: true,
            ...(entry.version != null ? { version: entry.version } : {}),
          },
        }
      } catch (error) {
        log.warn('[hooks-v2] describeTool failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        return { found: false }
      }
    },
    invokeTool: async (request) => {
      try {
        const tools = await listHookVisibleTools({
          sessionId: request.attribution.sessionId,
          turnId: request.attribution.turnId,
          hookId: request.attribution.hookId,
          hookRunId: request.attribution.hookRunId,
          eventId: request.attribution.eventId,
        })
        const entry = await findEntry(request.target, tools)
        if (entry == null) {
          return { ok: false, errorCode: 'tool_not_found', message: '统一工具目录中找不到目标工具' }
        }
        const result = await entry.invoke(request.input)
        return { ok: true, result }
      } catch (error) {
        const classified = classifyToolError(error)
        return { ok: false, errorCode: classified.errorCode, message: classified.message }
      }
    },
  }
}

export class HookSystemV2 {
  readonly management: HookManagementService
  private readonly bridge: HookLifecycleBridge
  private readonly dispatcher: HookDispatcher
  private readonly worker: HookWorker
  private started = false

  constructor(private readonly deps: HookSystemV2Deps) {
    this.management = new HookManagementService({ db: deps.db })
    const isEnabled = (): boolean => this.management.getSystemEnabled()
    this.dispatcher = new HookDispatcher(deps.db, { owner: `main:${process.pid}`, isEnabled })
    this.bridge = new HookLifecycleBridge(deps.db, {
      onEventPersisted: () => {
        void this.dispatcher.dispatchPending(8).catch(() => {})
      },
    })
    this.worker = new HookWorker(deps.db, {
      owner: `main:${process.pid}`,
      builtins: createBuiltinActionHandlers(),
      toolGateway: createHookToolGateway(deps),
      isEnabled,
      pollIntervalMs: WORKER_POLL_INTERVAL_MS,
    })
  }

  /** 挂到 SessionService（发射生命周期事件）并启动崩溃恢复 + Worker 轮询。 */
  attachSessionService(sessionService: {
    setHookLifecycleBridge: (bridge: unknown) => void
  }): void {
    sessionService.setHookLifecycleBridge(this.bridge)
    if (!this.started) {
      const recovery = this.worker.recoverOnStartup()
      if (recovery.unknownRuns > 0 || recovery.requeuedEvents > 0) {
        log.info('[hooks-v2] startup recovery', recovery)
      }
      this.worker.start()
      this.started = true
    }
  }

  /** 挂到 PermissionService：真实权限请求进入等待时发射 permission.requested。 */
  attachPermissionService(permissionService: {
    setPermissionRequestedListener: (listener: unknown) => void
  }): void {
    permissionService.setPermissionRequestedListener(
      (info: {
        sessionId: string
        requestId: string
        toolName: string
        action: string
        riskLevel: string
        turnId?: string
      }) => {
        this.bridge.permissionRequested({
          sessionId: info.sessionId,
          turnId: info.turnId ?? 'unknown',
          requestId: info.requestId,
          toolName: info.toolName,
          action: info.action,
          riskLevel: info.riskLevel,
        })
      },
    )
  }

  /** 应用退出流程：停止领取并尽力取消运行中动作（不撤回已发生的外部副作用）。 */
  stop(): void {
    this.worker.stop()
  }
}

let systemInstance: HookSystemV2 | null = null

export function getHookSystemV2(deps: HookSystemV2Deps): HookSystemV2 {
  if (systemInstance == null) systemInstance = new HookSystemV2(deps)
  return systemInstance
}

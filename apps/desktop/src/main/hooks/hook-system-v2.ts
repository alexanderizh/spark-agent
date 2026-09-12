/**
 * HookSystemV2 — 主进程 Hook 运行时组装根（设计方案 §5/§14）。
 *
 * 职责：把 HookLifecycleBridge（事件发射）、HookDispatcher（派发）、HookWorker
 * （执行）与内置动作处理器（系统通知/提示音）、统一工具网关组装成单例，
 * 并挂到 SessionService / PermissionService 上。ipc/index.ts 只保留薄接线。
 *
 * 生命周期事实 → outbox（hook_events）→ 派发 → 队列（hook_runs）→ Worker 执行。
 * Hook 执行失败不改变已发生的 Turn 终态（失败隔离）。
 *
 * 应用级总开关（设计方案 §10.1）：
 * - 开启：Worker 领取并执行。
 * - 关闭：停止领取并暂停尚未开始的任务，同时尽力取消运行中动作；工具结果无法
 *   确认的运行进入终态 outcome_unknown，不自动重投。它不是已发生外部副作用的回滚。
 */

import { Notification, shell } from 'electron'
import type { SparkDatabase } from '@spark/storage'
import type { HookToolCandidateV1 } from '@spark/protocol'
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

export interface HookCatalogEntryLite {
  sourceKind: string
  sourceId: string
  version?: string
  toolName?: string
  qualifiedName: string
  tool: { risk: string; effect: string; idempotency: string }
  invoke: (input: Record<string, unknown>) => Promise<unknown>
}

/** 经统一工具目录列出 Hook 可见工具（invocationSource='hook' 归因）。 */
async function listHookVisibleTools(
  deps: HookSystemV2Deps,
  options: {
    sessionId?: string
    turnId?: string
    hookId?: string
    hookRunId?: string
    eventId?: string
  } = {},
): Promise<HookCatalogEntryLite[]> {
  const sessionService = deps.getSessionService() as {
    listUnifiedTools?: (context?: Record<string, unknown>) => Promise<HookCatalogEntryLite[]>
  }
  if (sessionService?.listUnifiedTools == null) return []
  const tools = await sessionService.listUnifiedTools({
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
  return (tools ?? []) as HookCatalogEntryLite[]
}

function findEntry(
  target: { sourceKind: string; sourceId: string; toolName: string; qualifiedName: string },
  tools: HookCatalogEntryLite[],
): HookCatalogEntryLite | undefined {
  return tools.find(
    (entry) =>
      entry.sourceKind === target.sourceKind &&
      entry.sourceId === target.sourceId &&
      (entry.toolName === target.toolName || entry.qualifiedName === target.qualifiedName),
  )
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
        log.warn('system notifications not supported')
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
  return {
    describeTool: async (target) => {
      try {
        const tools = await listHookVisibleTools(deps)
        const entry = findEntry(target, tools)
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
        log.warn(`describeTool failed: ${error instanceof Error ? error.message : String(error)}`)
        return { found: false }
      }
    },
    invokeTool: async (request) => {
      try {
        const tools = await listHookVisibleTools(deps, {
          sessionId: request.attribution.sessionId,
          turnId: request.attribution.turnId,
          hookId: request.attribution.hookId,
          hookRunId: request.attribution.hookRunId,
          eventId: request.attribution.eventId,
        })
        const entry = findEntry(request.target, tools)
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
  private readonly deps: HookSystemV2Deps
  private readonly bridge: HookLifecycleBridge
  private readonly dispatcher: HookDispatcher
  private readonly worker: HookWorker
  private started = false

  constructor(deps: HookSystemV2Deps) {
    this.deps = deps
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
        log.info(`startup recovery: ${JSON.stringify(recovery)}`)
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

  /**
   * 应用级总开关。关闭 = 停止领取 + 尽力取消运行中动作（无法确认结果的运行进入
   * outcome_unknown）；重新开启恢复领取。它不会撤回已发生的外部副作用。
   */
  setSystemEnabled(enabled: boolean): boolean {
    const applied = this.management.setSystemEnabled(enabled)
    if (!enabled) {
      this.worker.stop()
      this.started = false
    } else if (!this.started) {
      this.worker.start()
      this.started = true
    }
    return applied
  }

  /** 工具候选：按 Hook 风险策略给出可选工具与不可选原因（设计方案 §14）。 */
  async listToolCandidates(): Promise<HookToolCandidateV1[]> {
    let tools: HookCatalogEntryLite[] = []
    try {
      tools = await listHookVisibleTools(this.deps)
    } catch (error) {
      log.warn(
        `listToolCandidates failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return tools.map((entry) => {
      const risk = entry.tool.risk as HookToolCandidateV1['risk']
      const selectable = risk === 'read' || risk === 'low-write'
      const unselectableReason =
        risk === 'destructive'
          ? '观察型 Hook 禁止 destructive 工具'
          : risk === 'high-write'
            ? 'high-write 工具默认不开放给 Hook 自动调用'
            : undefined
      return {
        target: {
          sourceKind: entry.sourceKind as 'connector' | 'custom-tool' | 'tool-package',
          sourceId: entry.sourceId,
          ...(entry.version != null ? { version: entry.version } : {}),
          toolName: entry.toolName ?? entry.qualifiedName,
          qualifiedName: entry.qualifiedName,
        },
        title: entry.toolName ?? entry.qualifiedName,
        risk,
        effect: entry.tool.effect,
        idempotency: entry.tool.idempotency as 'safe' | 'keyed' | 'unsafe',
        selectable,
        ...(unselectableReason != null ? { unselectableReason } : {}),
      }
    })
  }

  /** 应用退出流程：停止领取并尽力取消运行中动作（不撤回已发生的外部副作用）。 */
  stop(): void {
    this.worker.stop()
    this.started = false
  }
}

let systemInstance: HookSystemV2 | null = null

export function getHookSystemV2(deps: HookSystemV2Deps): HookSystemV2 {
  if (systemInstance == null) systemInstance = new HookSystemV2(deps)
  return systemInstance
}

/** 注册到应用退出清理流程（main/index.ts 的 shutdown cleanup steps）。 */
export function disposeHookSystemForShutdown(): void {
  systemInstance?.stop()
}

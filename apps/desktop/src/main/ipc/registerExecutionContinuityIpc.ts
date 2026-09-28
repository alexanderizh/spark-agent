/**
 * @module registerExecutionContinuityIpc
 *
 * 执行连续性（恢复中心）IPC — 列表/详情/动作/诊断/配置 + outbox 驱动的变更推送。
 */

import type { SessionService } from '@spark/agent-runtime'
import { setExecutionContinuityConfig } from '@spark/agent-runtime'
import { typedIpcHandle, pushStreamEvent } from './typed-ipc.js'
import { createLogger } from '@spark/shared'

const log = createLogger('ipc.execution-continuity')

/** outbox 泵间隔：低频即可，恢复中心打开时由渲染端轮询列表兜底。 */
const OUTBOX_PUMP_INTERVAL_MS = 15_000

export function registerExecutionContinuityIpc(input: {
  getSessionService: () => SessionService
}): void {
  const getSupervisor = () => input.getSessionService().getExecutionSupervisor()

  typedIpcHandle('execution:list-runs', async (request) => {
    const supervisor = getSupervisor()
    return {
      runs: supervisor.listRunSummaries({
        activeOnly: request.activeOnly ?? false,
        ...(request.kind != null ? { kind: request.kind } : {}),
        ...(request.sessionId != null ? { sessionId: request.sessionId } : {}),
        limit: request.limit ?? 100,
      }),
    }
  })

  typedIpcHandle('execution:get-run-detail', async (request) => {
    return { detail: getSupervisor().getRunDetail(request.runId) }
  })

  typedIpcHandle('execution:resolve-run', async (request) => {
    const supervisor = getSupervisor()
    const result = supervisor.resolveRun(request.runId, request.action)
    if (result.ok) {
      pushStreamEvent('stream:execution:runs-changed', {
        runId: request.runId,
        eventType: `resolve:${request.action}`,
        summary: supervisor.getStartupSummary(),
      })
    }
    log.info('execution resolve-run', {
      runId: request.runId,
      action: request.action,
      ok: result.ok,
      message: result.message,
    })
    return result
  })

  typedIpcHandle('execution:get-startup-summary', async () => {
    return { summary: getSupervisor().getStartupSummary() }
  })

  typedIpcHandle('execution:export-diagnostics', async (request) => {
    return { diagnostics: getSupervisor().exportDiagnostics(request.runId) }
  })

  typedIpcHandle('execution:get-config', async () => {
    // 配置读取经 agent-runtime 的进程内配置（与 Supervisor 同源）。
    const { getExecutionContinuityConfig } = await import('@spark/agent-runtime')
    return { config: getExecutionContinuityConfig() }
  })

  typedIpcHandle('execution:set-config', async (request) => {
    const config = setExecutionContinuityConfig(request.config)
    log.info('execution config updated', { enabled: config.enabled })
    return { config }
  })

  // outbox 泵：把 durable outbox 中的状态变化以流事件通知渲染端（不依赖 Renderer 在线）。
  const pumpTimer = setInterval(() => {
    try {
      const supervisor = getSupervisor()
      let published = 0
      for (;;) {
        const batch = supervisor.pumpOutbox(
          (runId, eventType, _payload) => {
            pushStreamEvent('stream:execution:runs-changed', {
              runId,
              eventType,
              summary: supervisor.getStartupSummary(),
            })
          },
        )
        published += batch
        if (batch < 50) break
      }
      if (published > 0) log.debug('outbox pumped', { published })
    } catch (error) {
      // 泵失败不影响其他功能；下轮重试。
    }
  }, OUTBOX_PUMP_INTERVAL_MS)
  pumpTimer.unref?.()
}

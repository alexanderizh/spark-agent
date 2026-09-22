/**
 * @module registerResourceMonitorIpc
 *
 * 资源监控 IPC 装配（性能监控体系 M1 桌面接线）：
 *  - 三个 invoke 通道（get-snapshot / get-history / subscribe）桥接
 *    SessionService 惰性单例上的 ResourceMonitorService；
 *  - 注入推流 sink（broadcastToAppWindows），随后启动采样（幂等）；
 *  - 订阅以 webContents id 为 subscriberId，窗口销毁自动退订防泄漏。
 */

import { broadcastToAppWindows } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import type { SessionService } from '@spark/agent-runtime'

export function registerResourceMonitorIpc(getSessionService: () => SessionService): void {
  const sessionService = getSessionService()
  const monitor = sessionService.getResourceMonitor()
  monitor.setStreamSink((channel, payload) => {
    broadcastToAppWindows(channel, payload)
  })
  monitor.start()

  typedIpcHandle('resource-monitor:get-snapshot', async (request) => {
    const response = monitor.getSnapshot(request.detail ?? 'summary')
    // 跨模块组合（装配层职责）：full 快照合并工作流治理回显（M3 配置面板）。
    if (response.full != null) {
      const workflowGovernance = sessionService.getWorkflowExecutionGovernance()
      response.full.workflowGovernance =
        workflowGovernance == null
          ? null
          : {
              waveWidth: workflowGovernance.waveWidth,
              fanoutClamp: workflowGovernance.fanoutClamp,
              loopFanoutProductCap: workflowGovernance.loopFanoutProductCap,
              maxDispatchesPerRun: workflowGovernance.maxDispatchesPerRun,
            }
    }
    return response
  })

  typedIpcHandle('resource-monitor:get-history', async (request) => {
    return { points: monitor.getHistory(request.windowMs) }
  })

  typedIpcHandle('resource-monitor:get-pressure-events', async (request) => {
    return { events: monitor.getRecentPressureEvents(request.limit) }
  })

  // 闸门诊断（M3「活动治理」双池占用表数据源；不触发 governor 惰性创建）。
  typedIpcHandle('dispatch-governor:get-diagnostics', async () => {
    const diagnostics = sessionService.getDispatchGovernorDiagnostics()
    return { available: diagnostics != null, diagnostics }
  })

  const destroyCleanups = new Map<number, () => void>()
  typedIpcHandle('resource-monitor:subscribe', async (request, event) => {
    const webContentsId = event.sender.id
    const subscriberId = String(webContentsId)
    const result = monitor.setSubscription(subscriberId, request.enabled, request.minIntervalMs)
    if (request.enabled && !destroyCleanups.has(webContentsId)) {
      const cleanup = (): void => {
        monitor.setSubscription(subscriberId, false)
        destroyCleanups.delete(webContentsId)
      }
      event.sender.once('destroyed', cleanup)
      destroyCleanups.set(webContentsId, cleanup)
    }
    return {
      ok: true,
      subscriberCount: result.subscriberCount,
      minIntervalMs: result.minIntervalMs,
    }
  })
}

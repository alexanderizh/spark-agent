/**
 * 主动推送投递器（spark_notify.notify_user 的 desktop 侧实现）。
 *
 * 目标解析（设计文档 todo/2026-11-14-远程渠道主动推送工具设计方案.md §3.2）：
 *   1. remoteRouteSessionOwners 反查该会话绑定的全部路由；
 *   2. 过滤 enabled 且 capabilities.proactivePush 的连接；
 *   3. 剩余 ≥1 条 → 逐条 sendReply（复用指数退避重试 / lastError 链路），
 *      多条全部投递（每条都是用户亲手绑定的路由，与定时任务「歧义不投」的保守
 *      先例刻意不同——推送目标是「通知会话的主人」而非路由选择）；
 *   4. 剩余 0 条 → 桌面系统通知回落，保证工具永远有送达路径。
 */
import { createLogger } from '@spark/shared'
import type { NotifyUserResult } from '@spark/agent-runtime'
import { remoteRouteSessionOwners } from './remoteSessionIsolation.js'
import type { RemoteConnectionService } from './RemoteConnectionService.js'

const log = createLogger('proactive-remote-push')

const DESKTOP_FALLBACK_TITLE = '助手通知'

/** 投递器只依赖 RemoteConnectionService 的这两个入口，测试可直接注入 stub。 */
export type ProactivePushConnectionService = Pick<RemoteConnectionService, 'list' | 'sendReply'>

export interface DesktopNotificationRequest {
  title: string
  body: string
  navigationTarget: { target: 'session'; sessionId: string }
}

export type DesktopNotifier = (request: DesktopNotificationRequest) => void

export interface DeliverProactivePushOptions {
  /** 未绑定路由时的桌面通知回落通道（ipc 装配处传 showSystemNotification）。 */
  showDesktopNotification?: DesktopNotifier
}

function describeDeliveryError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function deliverProactivePush(
  service: ProactivePushConnectionService,
  sessionId: string,
  text: string,
  title?: string,
  options: DeliverProactivePushOptions = {},
): Promise<NotifyUserResult> {
  const connections = service.list().connections
  const routes = remoteRouteSessionOwners(connections, sessionId).filter(
    ({ connection }) => connection.enabled && connection.capabilities.proactivePush === true,
  )
  const fullText = title != null && title.length > 0 ? `${title}\n${text}` : text

  if (routes.length === 0) {
    if (options.showDesktopNotification == null) {
      log.warn(`主动推送无可用送达路径: session=${sessionId}（未绑定路由且未装配桌面通知器）`)
      return {
        delivered: [],
        failures: [
          {
            label: 'desktop',
            channel: 'desktop',
            error: 'No remote route bound and desktop notifier unavailable.',
          },
        ],
        fallbackDesktop: false,
      }
    }
    options.showDesktopNotification({
      title: title ?? DESKTOP_FALLBACK_TITLE,
      body: text,
      navigationTarget: { target: 'session', sessionId },
    })
    log.info(`主动推送回落桌面通知: session=${sessionId}（未绑定启用推送的远程路由）`)
    return { delivered: [], failures: [], fallbackDesktop: true }
  }

  const delivered: NotifyUserResult['delivered'] = []
  const failures: NotifyUserResult['failures'] = []
  for (const { connection, route } of routes) {
    try {
      await service.sendReply(connection.id, route.externalId, fullText)
      delivered.push({ label: connection.name, channel: connection.channel })
      log.debug(
        `主动推送已投递: session=${sessionId} channel=${connection.channel}#${connection.id}`,
      )
    } catch (error) {
      // 单条失败不阻断其余路由；sendReply 内部重试耗尽已把原因落到连接 lastError。
      const detail = describeDeliveryError(error)
      failures.push({ label: connection.name, channel: connection.channel, error: detail })
      log.warn(
        `主动推送投递失败: session=${sessionId} channel=${connection.channel}#${connection.id} ${detail}`,
      )
    }
  }
  return { delivered, failures, fallbackDesktop: false }
}

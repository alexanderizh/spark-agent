/**
 * 消息通知 IPC 注册
 *
 * 通道语义见 packages/protocol/src/notifications.ts。
 * service 参数仅供测试注入 fake；生产走懒加载单例 getNotificationService()。
 */

import { typedIpcHandle } from './typed-ipc.js'
import {
  getNotificationService,
  type NotificationService,
} from '../services/Notifications/index.js'

export function registerNotificationIpc(service?: NotificationService): void {
  const resolve = () => service ?? getNotificationService()

  typedIpcHandle('notification:get-snapshot', async () => ({
    snapshot: resolve().getSnapshot(),
  }))

  typedIpcHandle('notification:list', async (request) => resolve().list(request))

  typedIpcHandle('notification:mark-read', async (request) => resolve().markRead(request))

  typedIpcHandle('notification:mark-all-read', async () => resolve().markAllRead())

  typedIpcHandle('notification:refresh', async () => ({
    snapshot: await resolve().refreshNow(),
  }))

  typedIpcHandle('notification:mark-announcements-seen', async (request) =>
    resolve().markAnnouncementsSeen(request),
  )
}

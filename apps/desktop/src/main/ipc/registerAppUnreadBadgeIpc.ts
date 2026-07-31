import { updateAppUnreadBadge } from '../services/AppUnreadBadgeService.js'
import { typedIpcHandle } from './typed-ipc.js'

export function registerAppUnreadBadgeIpc(): void {
  typedIpcHandle('app:set-unread-count', async (request) => ({
    count: updateAppUnreadBadge(request.count),
  }))
}


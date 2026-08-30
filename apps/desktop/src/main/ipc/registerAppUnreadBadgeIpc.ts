import {
  setActiveRendererSession,
  updateAppUnreadBadge,
} from '../services/AppUnreadBadgeService.js'
import { typedIpcHandle } from './typed-ipc.js'

export function registerAppUnreadBadgeIpc(): void {
  typedIpcHandle('app:set-unread-count', async (request) => {
    if (request.activeSessionId !== undefined) {
      setActiveRendererSession(request.activeSessionId)
    }
    return { count: updateAppUnreadBadge(request.count) }
  })
}

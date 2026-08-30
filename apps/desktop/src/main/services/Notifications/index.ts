/**
 * Notifications 服务装配（主进程单例）
 *
 * 依赖来源：
 *   - EduServerClient / 登录态：AuthService（复用同一实例，共享 401 续期单飞锁）
 *   - 「已见」持久化：SettingsRepository（app_settings 表，category 'notifications'）
 *   - 事件出口：pushStreamEvent('stream:notification:changed')
 */

import { SettingsRepository } from '@spark/storage'
import { SettingsService } from '@spark/agent-runtime'
import { pushStreamEvent } from '../../ipc/typed-ipc.js'
import { getDatabase } from '../../db.js'
import { getAuthService } from '../Auth/AuthService.js'
import { NotificationService, type NotificationPersistedState } from './NotificationService.js'

export { NotificationService } from './NotificationService.js'
export type { EduClientLike, NotificationPersistedState } from './NotificationService.js'

const NOTIFICATION_SETTINGS_CATEGORY = 'notifications'
const NOTIFICATION_SETTINGS_KEY = 'data'

let _instance: NotificationService | null = null

export function initNotificationService(): NotificationService {
  if (_instance) return _instance

  const authService = getAuthService()
  const settings = new SettingsService(new SettingsRepository(getDatabase()))

  _instance = new NotificationService({
    client: authService.getEduClient(),
    isAuthenticated: () => authService.getCurrentUserId() !== null,
    persistence: {
      load: () =>
        settings.get(
          NOTIFICATION_SETTINGS_CATEGORY,
          NOTIFICATION_SETTINGS_KEY,
        ) as NotificationPersistedState | null,
      save: (state) =>
        settings.set(NOTIFICATION_SETTINGS_CATEGORY, NOTIFICATION_SETTINGS_KEY, state),
    },
    emit: (event) => pushStreamEvent('stream:notification:changed', event),
  })
  return _instance
}

export function getNotificationService(): NotificationService {
  if (!_instance) {
    throw new Error('NotificationService not initialized, call initNotificationService() first')
  }
  return _instance
}

/** 仅供测试使用 */
export function __resetNotificationServiceForTesting(): void {
  _instance = null
}

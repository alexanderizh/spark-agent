import { describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown) => Promise<unknown>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: unknown) => Promise<unknown>) => {
    harness.handlers.set(channel, handler)
  },
  pushStreamEvent: vi.fn(),
}))

import { registerNotificationIpc } from './registerNotificationIpc.js'
import type { NotificationService } from '../services/Notifications/index.js'
import type { NotificationSnapshot } from '@spark/protocol'

function makeFakeService() {
  const snapshot: NotificationSnapshot = {
    authed: true,
    unreadCount: 2,
    latestNotifications: [],
    announcements: [],
    lastSyncAt: '2026-08-20T12:00:00.000Z',
    lastError: null,
  }
  return {
    snapshot,
    getSnapshot: vi.fn(() => structuredClone(snapshot)),
    list: vi.fn(async () => ({ list: [], total: 0 })),
    markRead: vi.fn(async () => ({ ok: true as const })),
    markAllRead: vi.fn(async () => ({ ok: true as const, unreadCount: 0 })),
    refreshNow: vi.fn(async () => structuredClone(snapshot)),
    markAnnouncementsSeen: vi.fn(() => ({ ok: true as const })),
  }
}

describe('registerNotificationIpc', () => {
  it('注册全部 6 个通道并转发到服务', async () => {
    const fake = makeFakeService()
    registerNotificationIpc(fake as unknown as NotificationService)

    expect([...harness.handlers.keys()].sort()).toEqual([
      'notification:get-snapshot',
      'notification:list',
      'notification:mark-all-read',
      'notification:mark-announcements-seen',
      'notification:mark-read',
      'notification:refresh',
    ])

    await harness.handlers.get('notification:get-snapshot')!({})
    expect(fake.getSnapshot).toHaveBeenCalledTimes(1)

    await harness.handlers.get('notification:list')!({ page: 2, pageSize: 50 })
    expect(fake.list).toHaveBeenCalledWith({ page: 2, pageSize: 50 })

    await harness.handlers.get('notification:mark-read')!({ id: 9 })
    expect(fake.markRead).toHaveBeenCalledWith({ id: 9 })

    await harness.handlers.get('notification:mark-all-read')!({})
    expect(fake.markAllRead).toHaveBeenCalledTimes(1)

    await harness.handlers.get('notification:refresh')!({})
    expect(fake.refreshNow).toHaveBeenCalledTimes(1)

    await harness.handlers.get('notification:mark-announcements-seen')!({ ids: [1, 2] })
    expect(fake.markAnnouncementsSeen).toHaveBeenCalledWith({ ids: [1, 2] })
  })
})

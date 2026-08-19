import { describe, expect, it, vi } from 'vitest'
import { SparkError } from '@spark/shared'
import type { EduNotificationItem, NotificationChangedEvent } from '@spark/protocol'
import {
  NotificationService,
  type EduClientLike,
  type NotificationPersistedState,
} from './NotificationService.js'

// ─── 测试替身 ──────────────────────────────────────────────────────────────────

class FakeEduClient implements EduClientLike {
  announcements: unknown[] = []
  notifList: { list: EduNotificationItem[]; total: number } = { list: [], total: 0 }
  unreadCount = 0
  failAnnouncements = false
  failNotifications = false
  calls: string[] = []

  async get<T>(path: string): Promise<T> {
    this.calls.push(`GET ${path}`)
    if (path.startsWith('/platform-announcements')) {
      if (this.failAnnouncements) throw new Error('网络不可达')
      return this.announcements as T
    }
    if (path.startsWith('/notifications/unread-count')) {
      if (this.failNotifications) throw new Error('网络不可达')
      return { count: this.unreadCount } as T
    }
    if (path.startsWith('/notifications')) {
      if (this.failNotifications) throw new Error('网络不可达')
      return this.notifList as T
    }
    throw new Error(`unexpected path: ${path}`)
  }

  async patch<T>(_path: string, _body?: unknown): Promise<T> {
    this.calls.push(`PATCH ${_path}`)
    return {} as T
  }

  async post<T>(path: string, _body?: unknown): Promise<T> {
    this.calls.push(`POST ${path}`)
    if (path === '/notifications/read-all') this.unreadCount = 0
    return {} as T
  }
}

function makeNotif(id: number, overrides: Partial<EduNotificationItem> = {}): EduNotificationItem {
  return {
    id,
    notificationId: id + 1000,
    title: `通知 ${id}`,
    content: `<p>正文 ${id}</p>`,
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: `2026-08-20T10:00:${String(id).padStart(2, '0')}.000Z`,
    ...overrides,
  }
}

function makeAnnouncement(
  id: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    content: `公告 ${id}`,
    status: 'active',
    startTime: `2026-08-0${id}T00:00:00.000Z`,
    endTime: '2026-12-31T00:00:00.000Z',
    createdAt: `2026-08-0${id}T00:00:00.000Z`,
    updatedAt: `2026-08-0${id}T00:00:00.000Z`,
    ...overrides,
  }
}

function makeService(overrides: { client?: FakeEduClient; authed?: boolean } = {}) {
  const client = overrides.client ?? new FakeEduClient()
  let authed = overrides.authed ?? true
  const persisted: { state: NotificationPersistedState | null } = { state: null }
  const events: NotificationChangedEvent[] = []
  const service = new NotificationService({
    client,
    isAuthenticated: () => authed,
    persistence: {
      load: () => persisted.state,
      save: (state) => {
        persisted.state = state
      },
    },
    emit: (event) => events.push(event),
    now: () => new Date('2026-08-20T12:00:00.000Z'),
  })
  return {
    service,
    client,
    events,
    persisted,
    eventAt: (index: number): NotificationChangedEvent => {
      const event = events[index]
      if (!event) throw new Error(`event ${index} not captured`)
      return event
    },
    setAuthed: (value: boolean) => {
      authed = value
    },
  }
}

// ─── 用例 ──────────────────────────────────────────────────────────────────────

describe('NotificationService 轮询', () => {
  it('首次轮询为基线：填充快照但不产生新消息提醒', async () => {
    const { service, client, eventAt } = makeService()
    client.notifList = { list: [makeNotif(1), makeNotif(2)], total: 2 }
    client.unreadCount = 2
    client.announcements = [makeAnnouncement(1)]

    const snapshot = await service.refreshNow()

    expect(snapshot.authed).toBe(true)
    expect(snapshot.unreadCount).toBe(2)
    expect(snapshot.latestNotifications).toHaveLength(2)
    expect(snapshot.announcements).toHaveLength(1)
    expect(snapshot.lastSyncAt).toBe('2026-08-20T12:00:00.000Z')
    expect(snapshot.lastError).toBeNull()
    expect(eventAt(0).newNotifications).toEqual([])
    expect(eventAt(0).newAnnouncements).toEqual([])
  })

  it('基线后出现未读站内信 → 事件携带新消息增量；再轮询不重复', async () => {
    const { service, client, eventAt } = makeService()
    client.unreadCount = 0
    await service.refreshNow() // 基线

    client.notifList = { list: [makeNotif(5)], total: 1 }
    client.unreadCount = 1
    await service.refreshNow()
    expect(eventAt(1).newNotifications.map((n) => n.id)).toEqual([5])

    await service.refreshNow()
    expect(eventAt(2).newNotifications).toEqual([])
  })

  it('已读的站内信即使首次出现也不算新消息', async () => {
    const { service, client, eventAt } = makeService()
    await service.refreshNow()
    client.notifList = {
      list: [makeNotif(9, { isRead: true, readAt: '2026-08-20T11:00:00.000Z' })],
      total: 1,
    }
    await service.refreshNow()
    expect(eventAt(1).newNotifications).toEqual([])
  })

  it('新公告触发增量；标记已见后不再触发', async () => {
    const { service, client, eventAt } = makeService()
    await service.refreshNow()
    client.announcements = [makeAnnouncement(2)]
    await service.refreshNow()
    expect(eventAt(1).newAnnouncements.map((a) => a.id)).toEqual([2])

    service.markAnnouncementsSeen()
    client.announcements = [makeAnnouncement(2), makeAnnouncement(3)]
    await service.refreshNow()
    expect(eventAt(2).newAnnouncements.map((a) => a.id)).toEqual([3])
  })

  it('登录态切换（登出→登录）重新走基线，存量未读不弹提醒', async () => {
    const { service, client, eventAt, setAuthed } = makeService({ authed: true })
    client.notifList = { list: [makeNotif(1)], total: 1 }
    client.unreadCount = 1
    await service.refreshNow()
    expect(eventAt(0).newNotifications).toEqual([])

    // 登出：清空站内信状态，公告保留
    setAuthed(false)
    const loggedOut = await service.refreshNow()
    expect(loggedOut.authed).toBe(false)
    expect(loggedOut.latestNotifications).toEqual([])
    expect(loggedOut.unreadCount).toBe(0)

    // 重新登录：切换回基线
    setAuthed(true)
    await service.refreshNow()
    expect(eventAt(2).newNotifications).toEqual([])
    expect(eventAt(2).snapshot.unreadCount).toBe(1)
  })

  it('轮询失败：保留上次快照数据并记录 lastError，仍广播事件', async () => {
    const { service, client, eventAt } = makeService()
    client.notifList = { list: [makeNotif(1)], total: 1 }
    client.unreadCount = 1
    await service.refreshNow()

    client.failNotifications = true
    client.failAnnouncements = true
    const snapshot = await service.refreshNow()

    expect(snapshot.lastError).toBe('网络不可达')
    expect(snapshot.latestNotifications).toHaveLength(1) // 保留旧数据
    expect(snapshot.unreadCount).toBe(1)
    expect(snapshot.lastSyncAt).toBe('2026-08-20T12:00:00.000Z') // 保留上次成功时间
    expect(eventAt(1).newNotifications).toEqual([]) // 失败轮询不产生提醒
  })

  it('公告接口成功但站内信失败：部分成功更新公告并记录错误', async () => {
    const { service, client, eventAt } = makeService()
    await service.refreshNow()
    client.announcements = [makeAnnouncement(7)]
    client.failNotifications = true
    const snapshot = await service.refreshNow()
    expect(snapshot.announcements).toHaveLength(1)
    expect(snapshot.lastError).toBe('网络不可达')
    expect(eventAt(1).newAnnouncements.map((a) => a.id)).toEqual([7])
  })

  it('坏数据被丢弃：非法公告条目剔除、非法列表响应报错', async () => {
    const { service, client } = makeService()
    client.announcements = [makeAnnouncement(1), { id: 'not-a-number' }]
    const snapshot = await service.refreshNow()
    expect(snapshot.announcements).toHaveLength(1)

    client.announcements = 'not-an-array' as unknown as unknown[]
    await expect(service.refreshNow()).resolves.toMatchObject({ lastError: expect.any(String) })
  })

  it('单飞：并发 refreshNow 只发起一轮请求', async () => {
    const { service, client } = makeService()
    const p1 = service.refreshNow()
    const p2 = service.refreshNow()
    await Promise.all([p1, p2])
    const getCalls = client.calls.filter((c) => c.startsWith('GET'))
    // 一轮 = 公告 + 未读数 + 首页（登录态）
    expect(getCalls).toHaveLength(3)
  })
})

describe('NotificationService 写操作', () => {
  it('未登录时 list/markRead 抛 AUTH_REQUIRED', async () => {
    const { service } = makeService({ authed: false })
    await expect(service.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    })
    await expect(service.markRead({ id: 1 })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(service.markAllRead()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('markRead 调用 PATCH /notifications/:id/read 并重新对齐快照', async () => {
    const { service, client, eventAt } = makeService()
    client.notifList = { list: [makeNotif(1, { isRead: false })], total: 1 }
    client.unreadCount = 1
    await service.refreshNow()

    client.notifList = {
      list: [makeNotif(1, { isRead: true, readAt: '2026-08-20T12:01:00.000Z' })],
      total: 1,
    }
    client.unreadCount = 0
    const result = await service.markRead({ id: 1 })

    expect(result).toEqual({ ok: true })
    expect(client.calls).toContain('PATCH /notifications/1/read')
    const last = eventAt(1)
    expect(last.snapshot.unreadCount).toBe(0)
    expect(last.snapshot.latestNotifications[0]?.isRead).toBe(true)
  })

  it('markAllRead 调用 POST read-all 并清零未读', async () => {
    const { service, client } = makeService()
    client.notifList = { list: [makeNotif(1), makeNotif(2, { isRead: true })], total: 2 }
    client.unreadCount = 1
    await service.refreshNow()

    // 服务端执行 read-all 后返回全已读数据
    client.notifList = {
      list: [
        makeNotif(1, { isRead: true, readAt: '2026-08-20T12:01:00.000Z' }),
        makeNotif(2, { isRead: true, readAt: '2026-08-20T11:00:00.000Z' }),
      ],
      total: 2,
    }
    const result = await service.markAllRead()
    expect(client.calls).toContain('POST /notifications/read-all')
    expect(result).toEqual({ ok: true, unreadCount: 0 })
    expect(service.getSnapshot().latestNotifications.every((n) => n.isRead)).toBe(true)
  })

  it('list 返回服务端校验后的分页数据；非法响应抛错', async () => {
    const { service, client } = makeService()
    client.notifList = { list: [makeNotif(3)], total: 30 }
    const page2 = await service.list({ page: 2, pageSize: 20 })
    expect(page2.total).toBe(30)
    expect(client.calls).toContain('GET /notifications/?page=2&pageSize=20')

    client.notifList = { list: [], total: 'many' } as unknown as {
      list: EduNotificationItem[]
      total: number
    }
    await expect(service.list({ page: 1, pageSize: 20 })).rejects.toBeInstanceOf(SparkError)
  })
})

describe('NotificationService 持久化与生命周期', () => {
  it('已见集合持久化：新消息轮询后 seen id 落盘', async () => {
    const first = makeService()
    await first.service.refreshNow()
    first.client.notifList = { list: [makeNotif(1), makeNotif(2, { isRead: true })], total: 2 }
    first.client.unreadCount = 1
    await first.service.refreshNow()
    expect(first.persisted.state?.seenNotificationIds).toEqual(expect.arrayContaining([1, 2]))
    expect(first.persisted.state?.seenNotificationIds).toHaveLength(2)
  })

  it('start/stop：定时轮询触发且 dispose 后停止', async () => {
    vi.useFakeTimers()
    try {
      const { service, client } = makeService()
      client.unreadCount = 0
      service.start()
      await vi.advanceTimersByTimeAsync(0) // 立即首轮
      const afterFirst = client.calls.filter((c) => c.startsWith('GET')).length
      expect(afterFirst).toBe(3)

      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.calls.filter((c) => c.startsWith('GET')).length).toBe(6)

      await service.dispose()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(client.calls.filter((c) => c.startsWith('GET')).length).toBe(6)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('NotificationService 构造防御', () => {
  it('持久化状态中的非法 id（非正整数）被忽略', () => {
    const service = new NotificationService({
      client: new FakeEduClient(),
      isAuthenticated: () => true,
      persistence: {
        load: () => ({
          seenNotificationIds: [1, -2, 3.5, '4' as unknown as number],
          seenAnnouncementIds: [0],
        }),
        save: () => undefined,
      },
      emit: () => undefined,
    })
    expect(service.getSnapshot().unreadCount).toBe(0)
  })

  it('load 抛错不阻断构造', () => {
    expect(
      () =>
        new NotificationService({
          client: new FakeEduClient(),
          isAuthenticated: () => false,
          persistence: {
            load: () => {
              throw new Error('db locked')
            },
            save: () => undefined,
          },
          emit: () => undefined,
        }),
    ).not.toThrow()
  })
})

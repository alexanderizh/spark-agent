import { describe, expect, it } from 'vitest'
import {
  EduAnnouncementItemSchema,
  EduNotificationItemSchema,
  EduNotificationListSchema,
  NotificationSnapshotSchema,
  NotificationsIpcSchemaRegistry,
} from '../notifications.js'

describe('EduNotificationItemSchema', () => {
  it('接受服务端完整字段并剥离未知键', () => {
    const parsed = EduNotificationItemSchema.parse({
      id: 42,
      notificationId: 7,
      title: '任务完成',
      content: '<p>done</p>',
      metadata: { type: 'task_status' },
      isRead: false,
      readAt: null,
      createdAt: '2026-08-20T10:00:00.000Z',
      extraFutureField: 'dropped',
    })
    expect(parsed.id).toBe(42)
    expect(parsed).not.toHaveProperty('extraFutureField')
  })

  it('拒绝缺失必填字段', () => {
    expect(() =>
      EduNotificationItemSchema.parse({
        id: 42,
        notificationId: 7,
        title: 'x',
        // content 缺失
        metadata: null,
        isRead: true,
        readAt: null,
        createdAt: '2026-08-20T10:00:00.000Z',
      }),
    ).toThrow()
  })

  it('拒绝非布尔 isRead', () => {
    expect(() =>
      EduNotificationItemSchema.parse({
        id: 1,
        notificationId: 1,
        title: 'x',
        content: 'y',
        metadata: null,
        isRead: 'yes',
        readAt: null,
        createdAt: 'z',
      }),
    ).toThrow()
  })

  it('接受 bigint 序列化为字符串的 id 并 coerce 为 number（线上 edu-server 实际形状）', () => {
    const parsed = EduNotificationItemSchema.parse({
      id: '42',
      notificationId: '7',
      title: '任务完成',
      content: '<p>done</p>',
      metadata: null,
      isRead: false,
      readAt: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    })
    expect(parsed.id).toBe(42)
    expect(parsed.notificationId).toBe(7)
  })

  it('拒绝无法转为整数的 id', () => {
    expect(() =>
      EduNotificationItemSchema.parse({
        id: 'abc',
        notificationId: 7,
        title: 'x',
        content: 'y',
        metadata: null,
        isRead: false,
        readAt: null,
        createdAt: '2026-08-20T10:00:00.000Z',
      }),
    ).toThrow()
  })
})

describe('EduNotificationListSchema', () => {
  it('解析 { list, total } 分页结构', () => {
    const parsed = EduNotificationListSchema.parse({ list: [], total: 0 })
    expect(parsed.total).toBe(0)
  })

  it('拒绝负数 total', () => {
    expect(() => EduNotificationListSchema.parse({ list: [], total: -1 })).toThrow()
  })
})

describe('EduAnnouncementItemSchema', () => {
  it('接受 bigint 序列化为字符串的 id 并 coerce 为 number（2026-09-01 线上抓包形状）', () => {
    const parsed = EduAnnouncementItemSchema.parse({
      id: '2',
      content: '111',
      status: 'active',
      startTime: '2026-08-31T05:00:18.000Z',
      endTime: '2026-09-03T05:00:18.000Z',
      createdBy: '14',
      createdAt: '2026-09-01T05:00:22.774Z',
      updatedAt: '2026-09-01T05:00:22.774Z',
    })
    expect(parsed.id).toBe(2)
    // 服务端多余字段（createdBy 等）剥离
    expect(parsed).not.toHaveProperty('createdBy')
  })

  it('拒绝非枚举 status', () => {
    expect(() =>
      EduAnnouncementItemSchema.parse({
        id: 1,
        content: '系统维护',
        status: 'archived',
        startTime: '2026-08-01T00:00:00.000Z',
        endTime: '2026-08-31T00:00:00.000Z',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      }),
    ).toThrow()
  })
})

describe('NotificationSnapshotSchema', () => {
  it('解析完整快照', () => {
    const parsed = NotificationSnapshotSchema.parse({
      authed: true,
      unreadCount: 3,
      latestNotifications: [],
      announcements: [],
      lastSyncAt: null,
      lastError: null,
    })
    expect(parsed.unreadCount).toBe(3)
  })
})

describe('NotificationsIpcSchemaRegistry 请求校验', () => {
  const registry = NotificationsIpcSchemaRegistry

  it('get-snapshot 拒绝多余字段', () => {
    expect(() => registry['notification:get-snapshot'].parse({ unexpected: 1 } as never)).toThrow()
  })

  it('list 边界：page/pageSize 最小 1、pageSize 上限 100', () => {
    const schema = registry['notification:list']
    expect(() => schema.parse({ page: 0, pageSize: 20 })).toThrow()
    expect(() => schema.parse({ page: 1, pageSize: 0 })).toThrow()
    expect(() => schema.parse({ page: 1, pageSize: 101 })).toThrow()
    expect(schema.parse({ page: 1, pageSize: 100 })).toEqual({ page: 1, pageSize: 100 })
  })

  it('mark-read 拒绝非正整数 id', () => {
    const schema = registry['notification:mark-read']
    expect(() => schema.parse({ id: 0 })).toThrow()
    expect(() => schema.parse({ id: '42' })).toThrow()
    expect(schema.parse({ id: 42 })).toEqual({ id: 42 })
  })

  it('mark-announcements-seen 拒绝空 id 与超长数组', () => {
    const schema = registry['notification:mark-announcements-seen']
    expect(schema.parse({ ids: [] })).toEqual({ ids: [] })
    expect(() => schema.parse({ ids: [1, -2] })).toThrow()
    expect(() => schema.parse({ ids: new Array(301).fill(1) })).toThrow()
  })
})

/**
 * 消息通知协议（Notifications）
 *
 * 对接 edu-server（spark-edugen）的「站内信通知」与「平台公告」：
 * - 站内信：GET /api/v1/notifications（需登录态，复用 AuthService/EduServerClient）
 * - 平台公告：GET /api/v1/platform-announcements/active（免登录）
 * - 服务端无推送 → 主进程 NotificationService 定时轮询，变化时经
 *   `stream:notification:changed` 广播快照与「新消息」增量（供渲染层 toast）
 *
 * 数据语义（与 edu-server 实体对齐）：
 * - EduNotificationItem.id 是 notification_recipients.id（收件记录 id），
 *   标记已读 PATCH /notifications/:id/read 用的就是它
 * - 公告无标题/已读概念（纯文本 ≤500 字、active + 时间窗过滤），
 *   「已见」由客户端本地记录（settings category 'notifications'）
 */

import { z } from 'zod'

// ─── 服务端数据模型（edu-server 响应项）──────────────────────────────────────

/**
 * edu-server bigint 主键经 JSON 序列化为字符串（如 "2"），
 * 统一 coerce 成 number（id 均在安全整数范围内），兼容新旧服务端。
 */
const eduId = z.coerce.number().int()

/**
 * edu-server 站内信条目（GET /notifications 的 list 元素）。
 * content 为服务端构造的富文本 HTML，渲染前必须做 XSS 净化。
 */
export const EduNotificationItemSchema = z.object({
  /** notification_recipients.id（收件记录 id，标记已读用它）*/
  id: eduId,
  /** notifications.id（通知本体 id，仅展示用途）*/
  notificationId: eduId,
  title: z.string(),
  content: z.string(),
  metadata: z.unknown().nullable(),
  isRead: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
})

export type EduNotificationItem = z.infer<typeof EduNotificationItemSchema>

/** edu-server 平台公告条目（GET /platform-announcements/active 的数组元素）*/
export const EduAnnouncementItemSchema = z.object({
  id: eduId,
  /** 纯文本（≤500 字），无标题 */
  content: z.string(),
  status: z.enum(['active', 'inactive']),
  startTime: z.string(),
  endTime: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type EduAnnouncementItem = z.infer<typeof EduAnnouncementItemSchema>

/** 站内信分页响应（edu-server 通用分页结构 { list, total }）*/
export const EduNotificationListSchema = z.object({
  list: z.array(EduNotificationItemSchema),
  total: z.number().int().min(0),
})

export type EduNotificationList = z.infer<typeof EduNotificationListSchema>

// ─── 快照（主进程缓存，渲染层一次拉全）──────────────────────────────────────

/**
 * 通知状态快照：主进程每次轮询后更新并随事件广播；
 * 渲染层打开快捷面板时用 notification:get-snapshot 即时取（不发网络请求）。
 */
export const NotificationSnapshotSchema = z.object({
  /** 是否已登录（未登录时仅公告可用）*/
  authed: z.boolean(),
  /** 站内信未读数（未登录为 0）*/
  unreadCount: z.number().int().min(0),
  /** 最新一页站内信（主进程缓存，≤ pageSize 条）*/
  latestNotifications: z.array(EduNotificationItemSchema),
  /** 当前生效的平台公告（新→旧）*/
  announcements: z.array(EduAnnouncementItemSchema),
  /** 最近一次成功轮询时间（ISO）；null = 从未成功 */
  lastSyncAt: z.string().nullable(),
  /** 最近一次轮询错误信息（静默降级保留旧数据）；null = 正常 */
  lastError: z.string().nullable(),
})

export type NotificationSnapshot = z.infer<typeof NotificationSnapshotSchema>

/** 轮询发现的新消息增量（仅用于渲染层 toast；通常为空数组）*/
export const NotificationChangedEventSchema = z.object({
  snapshot: NotificationSnapshotSchema,
  /** 新出现的未读站内信（新→旧，最多 3 条，多余由渲染层合并提示）*/
  newNotifications: z.array(EduNotificationItemSchema),
  /** 新出现的公告（新→旧，最多 3 条）*/
  newAnnouncements: z.array(EduAnnouncementItemSchema),
})

export type NotificationChangedEvent = z.infer<typeof NotificationChangedEventSchema>

// ─── IPC 请求/响应 ─────────────────────────────────────────────────────────

export type NotificationGetSnapshotRequest = Record<string, never>
export type NotificationGetSnapshotResponse = { snapshot: NotificationSnapshot }

export type NotificationListRequest = { page: number; pageSize: number }
export type NotificationListResponse = EduNotificationList

export type NotificationMarkReadRequest = { id: number }
export type NotificationMarkReadResponse = { ok: true }

export type NotificationMarkAllReadRequest = Record<string, never>
export type NotificationMarkAllReadResponse = { ok: true; unreadCount: number }

export type NotificationRefreshRequest = Record<string, never>
export type NotificationRefreshResponse = { snapshot: NotificationSnapshot }

export type NotificationMarkAnnouncementsSeenRequest = { ids: number[] }
export type NotificationMarkAnnouncementsSeenResponse = { ok: true }

export interface NotificationsIpcChannelMap {
  /** 取主进程缓存的快照（不发网络请求；面板/弹窗打开时用）*/
  'notification:get-snapshot': [NotificationGetSnapshotRequest, NotificationGetSnapshotResponse]
  /** 实时拉取站内信列表（消息中心分页加载，需登录）*/
  'notification:list': [NotificationListRequest, NotificationListResponse]
  /** 标记单条已读（id = EduNotificationItem.id，服务端 PATCH /notifications/:id/read）*/
  'notification:mark-read': [NotificationMarkReadRequest, NotificationMarkReadResponse]
  /** 全部已读（服务端 POST /notifications/read-all，完成后返回最新未读数）*/
  'notification:mark-all-read': [NotificationMarkAllReadRequest, NotificationMarkAllReadResponse]
  /** 触发立即轮询并返回新快照（登录成功后/手动刷新）*/
  'notification:refresh': [NotificationRefreshRequest, NotificationRefreshResponse]
  /** 标记公告为已见（打开消息中心时调用，避免重复 toast/角标提示）*/
  'notification:mark-announcements-seen': [
    NotificationMarkAnnouncementsSeenRequest,
    NotificationMarkAnnouncementsSeenResponse,
  ]
}

export const NOTIFICATION_MAX_PAGE_SIZE = 100
export const NOTIFICATION_MAX_SEEN_IDS = 300

export const NotificationsIpcSchemaRegistry = {
  'notification:get-snapshot': z.object({}).strict(),
  'notification:list': z
    .object({
      page: z.number().int().min(1).max(10_000),
      pageSize: z.number().int().min(1).max(NOTIFICATION_MAX_PAGE_SIZE),
    })
    .strict(),
  'notification:mark-read': z.object({ id: z.number().int().min(1) }).strict(),
  'notification:mark-all-read': z.object({}).strict(),
  'notification:refresh': z.object({}).strict(),
  'notification:mark-announcements-seen': z
    .object({
      ids: z.array(z.number().int().min(1)).max(NOTIFICATION_MAX_SEEN_IDS),
    })
    .strict(),
} as const

/**
 * NotificationService — 消息通知轮询与状态管理
 *
 * 对接 edu-server（spark-edugen）：
 *   - 平台公告 GET /api/v1/platform-announcements/active（免登录，skipAuth）
 *   - 站内信   GET /api/v1/notifications（需登录态，复用 AuthService 的 EduServerClient）
 *
 * 职责：
 *   1. 定时轮询（默认 60s），维护主进程内存快照（unreadCount + 最新一页 + 公告）
 *   2. 「新消息」增量检测：首次轮询 / 登录态切换为基线（不弹提醒），
 *      之后出现未读站内信或新公告时，经 emit 广播给渲染层做即时 toast
 *   3. 已读标记（单条 / 全部）与本地「已见」持久化（settings category 'notifications'）
 *
 * 不做：
 *   - HTTP 鉴权与 401 续期（EduServerClient 负责）
 *   - UI/toast（渲染层负责）
 */

import { z } from 'zod'
import { createLogger, SparkError } from '@spark/shared'
import {
  EduAnnouncementItemSchema,
  EduNotificationListSchema,
  NOTIFICATION_MAX_SEEN_IDS,
  type EduAnnouncementItem,
  type EduNotificationItem,
  type NotificationChangedEvent,
  type NotificationSnapshot,
} from '@spark/protocol'

const log = createLogger('notifications:service')

export const NOTIFICATION_POLL_INTERVAL_MS = 60_000
/** 单次事件携带的新消息上限（超过由渲染层合并提示）*/
const MAX_NEW_ITEMS_PER_EVENT = 3

/** EduServerClient 的结构子集（便于测试注入 fake）*/
export interface EduClientLike {
  get<T = unknown>(path: string, options?: { skipAuth?: boolean }): Promise<T>
  patch<T = unknown>(path: string, body?: unknown): Promise<T>
  post<T = unknown>(path: string, body?: unknown): Promise<T>
}

/** 本地持久化状态（settings category 'notifications' key 'data'）*/
export interface NotificationPersistedState {
  seenNotificationIds: number[]
  seenAnnouncementIds: number[]
}

export interface NotificationServiceOptions {
  client: EduClientLike
  /** 当前是否已登录（主进程 AuthService.getCurrentUserId() !== null）*/
  isAuthenticated(): boolean
  persistence: {
    load(): NotificationPersistedState | null
    save(state: NotificationPersistedState): void
  }
  /** 快照/新消息事件出口（wiring 层接 pushStreamEvent）*/
  emit(event: NotificationChangedEvent): void
  /** 轮询间隔（毫秒）；测试可注入 */
  intervalMs?: number
  /** 轮询缓存页大小 */
  pageSize?: number
  /** 时钟注入（测试用）*/
  now?(): Date
}

const EduUnreadCountSchema = z.object({ count: z.number().int().min(0) })

function emptySnapshot(): NotificationSnapshot {
  return {
    authed: false,
    unreadCount: 0,
    latestNotifications: [],
    announcements: [],
    lastSyncAt: null,
    lastError: null,
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** 解析公告数组：逐条 safeParse，坏条目丢弃并记日志；按 startTime 新→旧排序 */
function parseAnnouncements(raw: unknown): EduAnnouncementItem[] {
  if (!Array.isArray(raw)) throw new SparkError('UNKNOWN', '公告响应格式异常')
  const items: EduAnnouncementItem[] = []
  for (const entry of raw) {
    const parsed = EduAnnouncementItemSchema.safeParse(entry)
    if (parsed.success) items.push(parsed.data)
    else log.warn(`drop invalid announcement: ${parsed.error.message}`)
  }
  return items.sort((a, b) => (a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0))
}

/** 超Cap时按插入序淘汰最旧的已见 id */
function trimSet(set: Set<number>, cap: number): void {
  while (set.size > cap) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

export class NotificationService {
  private readonly client: EduClientLike
  private readonly isAuthenticatedFn: () => boolean
  private readonly persistence: NotificationServiceOptions['persistence']
  private readonly emitFn: (event: NotificationChangedEvent) => void
  private readonly intervalMs: number
  private readonly pageSize: number
  private readonly nowFn: () => Date

  private snapshot: NotificationSnapshot = emptySnapshot()
  private seenNotificationIds = new Set<number>()
  private seenAnnouncementIds = new Set<number>()
  /** 上一轮的登录态；变化时下一轮按基线处理（不弹提醒）*/
  private lastPollAuthed: boolean | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private inflight: Promise<void> | null = null

  constructor(opts: NotificationServiceOptions) {
    this.client = opts.client
    this.isAuthenticatedFn = opts.isAuthenticated
    this.persistence = opts.persistence
    this.emitFn = opts.emit
    this.intervalMs = opts.intervalMs ?? NOTIFICATION_POLL_INTERVAL_MS
    this.pageSize = opts.pageSize ?? 20
    this.nowFn = opts.now ?? (() => new Date())
    this.loadPersisted()
  }

  // ─── 生命周期 ────────────────────────────────────────────────────────────────

  /** 启动轮询：立即跑一轮，然后按 intervalMs 定时（timer unref，不阻塞退出）*/
  start(): void {
    if (this.timer) return
    void this.poll().catch((e) => log.warn(`initial poll failed: ${errorMessage(e)}`))
    this.timer = setInterval(() => {
      void this.poll().catch((e) => log.warn(`poll failed: ${errorMessage(e)}`))
    }, this.intervalMs)
    this.timer.unref?.()
  }

  async dispose(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.inflight) await this.inflight.catch(() => undefined)
  }

  // ─── 查询 ────────────────────────────────────────────────────────────────────

  /** 主进程缓存快照（深拷贝，调用方可安全持有/修改）*/
  getSnapshot(): NotificationSnapshot {
    return structuredClone(this.snapshot)
  }

  /** 实时拉取站内信列表（消息中心分页；需登录）*/
  async list(request: { page: number; pageSize: number }) {
    this.assertAuthed()
    const raw = await this.client.get<unknown>(
      `/notifications/?page=${request.page}&pageSize=${request.pageSize}`,
    )
    const parsed = EduNotificationListSchema.safeParse(raw)
    if (!parsed.success) throw new SparkError('UNKNOWN', '通知列表响应格式异常')
    return parsed.data
  }

  /** 触发立即轮询并返回新快照（登录成功后 / 手动刷新）*/
  async refreshNow(): Promise<NotificationSnapshot> {
    return this.poll()
  }

  // ─── 写操作 ──────────────────────────────────────────────────────────────────

  /** 标记单条已读（id = EduNotificationItem.id = notification_recipients.id）*/
  async markRead(request: { id: number }): Promise<{ ok: true }> {
    this.assertAuthed()
    await this.client.patch(`/notifications/${request.id}/read`)
    // 以服务端为准重新对齐（未读数/缓存页），并广播给渲染层
    await this.poll()
    return { ok: true }
  }

  async markAllRead(): Promise<{ ok: true; unreadCount: number }> {
    this.assertAuthed()
    await this.client.post('/notifications/read-all')
    // 乐观本地更新（即使随后的对齐轮询失败，UI 也能立即正确）
    const now = this.nowFn().toISOString()
    for (const item of this.snapshot.latestNotifications) {
      item.isRead = true
      if (!item.readAt) item.readAt = now
    }
    this.snapshot.unreadCount = 0
    this.emitChanged([], [])
    await this.poll()
    return { ok: true, unreadCount: this.snapshot.unreadCount }
  }

  /** 标记公告已见（打开消息中心时调用；不传 ids 则标记当前全部缓存公告）*/
  markAnnouncementsSeen(request?: { ids: number[] }): { ok: true } {
    const ids = request?.ids ?? this.snapshot.announcements.map((a) => a.id)
    for (const id of ids) this.seenAnnouncementIds.add(id)
    trimSet(this.seenAnnouncementIds, NOTIFICATION_MAX_SEEN_IDS)
    this.persistSeen()
    return { ok: true }
  }

  // ─── 内部：轮询 ──────────────────────────────────────────────────────────────

  /** 单飞轮询：并发调用复用在飞的那一轮 */
  private async poll(): Promise<NotificationSnapshot> {
    if (this.inflight) {
      await this.inflight
    } else {
      this.inflight = this.runPoll()
      try {
        await this.inflight
      } finally {
        this.inflight = null
      }
    }
    return this.getSnapshot()
  }

  private async runPoll(): Promise<void> {
    const authed = this.isAuthenticatedFn()
    // 基线轮询：首次成功前 / 登录态发生变化 → 只记录已见，不产生新消息提醒
    const baseline = this.snapshot.lastSyncAt === null || this.lastPollAuthed !== authed

    const [annRes, unreadRes, pageRes] = await Promise.allSettled([
      this.fetchAnnouncements(),
      authed ? this.fetchUnreadCount() : Promise.resolve(null),
      authed ? this.fetchLatestPage() : Promise.resolve(null),
    ])

    const errors: string[] = []
    let newNotifications: EduNotificationItem[] = []
    let newAnnouncements: EduAnnouncementItem[] = []
    let anySuccess = false

    if (annRes.status === 'fulfilled') {
      anySuccess = true
      this.snapshot.announcements = annRes.value
      if (baseline) {
        for (const item of annRes.value) this.seenAnnouncementIds.add(item.id)
      } else {
        newAnnouncements = annRes.value.filter((a) => !this.seenAnnouncementIds.has(a.id))
        for (const item of newAnnouncements) this.seenAnnouncementIds.add(item.id)
      }
    } else {
      errors.push(errorMessage(annRes.reason))
    }

    if (pageRes.status === 'fulfilled') {
      const page = pageRes.value
      if (page) {
        anySuccess = true
        this.snapshot.latestNotifications = page.list
        if (baseline) {
          for (const item of page.list) this.seenNotificationIds.add(item.id)
        } else {
          newNotifications = page.list.filter(
            (n) => !n.isRead && !this.seenNotificationIds.has(n.id),
          )
          for (const item of page.list) this.seenNotificationIds.add(item.id)
        }
      }
    } else if (pageRes.status === 'rejected') {
      errors.push(errorMessage(pageRes.reason))
    }

    if (unreadRes.status === 'fulfilled') {
      if (unreadRes.value !== null) {
        anySuccess = true
        this.snapshot.unreadCount = unreadRes.value
      }
    } else if (unreadRes.status === 'rejected') {
      errors.push(errorMessage(unreadRes.reason))
    }

    // 未登录：清空上一账号的站内信状态（公告对所有人可见，保留）
    if (!authed) {
      this.snapshot.latestNotifications = []
      this.snapshot.unreadCount = 0
    }

    this.snapshot.authed = authed
    if (anySuccess) this.snapshot.lastSyncAt = this.nowFn().toISOString()
    this.snapshot.lastError = errors.length > 0 ? (errors[0] ?? null) : null
    this.lastPollAuthed = authed

    trimSet(this.seenNotificationIds, NOTIFICATION_MAX_SEEN_IDS)
    trimSet(this.seenAnnouncementIds, NOTIFICATION_MAX_SEEN_IDS)
    this.persistSeen()

    this.emitChanged(
      newNotifications.slice(0, MAX_NEW_ITEMS_PER_EVENT),
      newAnnouncements.slice(0, MAX_NEW_ITEMS_PER_EVENT),
    )
  }

  private async fetchAnnouncements(): Promise<EduAnnouncementItem[]> {
    const raw = await this.client.get<unknown>('/platform-announcements/active', { skipAuth: true })
    return parseAnnouncements(raw)
  }

  private async fetchUnreadCount(): Promise<number | null> {
    const raw = await this.client.get<unknown>('/notifications/unread-count')
    const parsed = EduUnreadCountSchema.safeParse(raw)
    if (!parsed.success) throw new SparkError('UNKNOWN', '未读数响应格式异常')
    return parsed.data.count
  }

  private async fetchLatestPage() {
    const raw = await this.client.get<unknown>(`/notifications/?page=1&pageSize=${this.pageSize}`)
    const parsed = EduNotificationListSchema.safeParse(raw)
    if (!parsed.success) throw new SparkError('UNKNOWN', '通知列表响应格式异常')
    return parsed.data
  }

  private emitChanged(
    newNotifications: EduNotificationItem[],
    newAnnouncements: EduAnnouncementItem[],
  ): void {
    const event: NotificationChangedEvent = {
      snapshot: this.getSnapshot(),
      newNotifications,
      newAnnouncements,
    }
    try {
      this.emitFn(event)
    } catch (e) {
      log.warn(`emit failed: ${errorMessage(e)}`)
    }
  }

  private assertAuthed(): void {
    if (!this.isAuthenticatedFn()) {
      throw new SparkError('AUTH_REQUIRED', '请先登录后查看站内信通知')
    }
  }

  // ─── 内部：持久化 ────────────────────────────────────────────────────────────

  private loadPersisted(): void {
    let state: NotificationPersistedState | null
    try {
      state = this.persistence.load()
    } catch (e) {
      log.warn(`load seen state failed: ${errorMessage(e)}`)
      return
    }
    if (!state) return
    if (Array.isArray(state.seenNotificationIds)) {
      for (const id of state.seenNotificationIds) {
        if (Number.isInteger(id) && id > 0) this.seenNotificationIds.add(id)
      }
    }
    if (Array.isArray(state.seenAnnouncementIds)) {
      for (const id of state.seenAnnouncementIds) {
        if (Number.isInteger(id) && id > 0) this.seenAnnouncementIds.add(id)
      }
    }
  }

  private persistSeen(): void {
    try {
      this.persistence.save({
        seenNotificationIds: [...this.seenNotificationIds],
        seenAnnouncementIds: [...this.seenAnnouncementIds],
      })
    } catch (e) {
      log.warn(`persist seen state failed: ${errorMessage(e)}`)
    }
  }
}

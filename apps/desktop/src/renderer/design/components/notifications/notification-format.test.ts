// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type {
  EduAnnouncementItem,
  EduNotificationItem,
  NotificationSnapshot,
} from '@spark/protocol'
import {
  formatNotificationTime,
  htmlToPreview,
  mergeFeed,
  sanitizeNotificationHtml,
} from './notification-format'

// ─── sanitizeNotificationHtml：XSS 净化白名单（安全关键路径）─────────────────

describe('sanitizeNotificationHtml', () => {
  it('剥离 script / img / iframe / 事件属性', () => {
    const dirty =
      '<p>正文</p><script>alert(1)</script><img src=x onerror=alert(2)>' +
      '<iframe src="https://evil.example"></iframe><p onclick="alert(3)">点击</p>'
    const clean = sanitizeNotificationHtml(dirty)
    expect(clean).not.toContain('script')
    expect(clean).not.toContain('<img')
    expect(clean).not.toContain('<iframe')
    expect(clean).not.toContain('onclick')
    expect(clean).toContain('<p>正文</p>')
  })

  it('保留白名单内的富文本标签', () => {
    const html =
      '<p>a<b>b</b><strong>c</strong><a href="https://example.com">d</a></p><ul><li>e</li></ul>'
    expect(sanitizeNotificationHtml(html)).toContain('<b>b</b>')
    expect(sanitizeNotificationHtml(html)).toContain('href="https://example.com"')
  })

  it('链接强制 _blank + noopener noreferrer', () => {
    const clean = sanitizeNotificationHtml('<a href="https://example.com">link</a>')
    expect(clean).toContain('target="_blank"')
    expect(clean).toContain('rel="noopener noreferrer"')
  })

  it('剥离 javascript: 协议链接与 style/script 标签、data-* 属性', () => {
    const clean = sanitizeNotificationHtml(
      '<a href="javascript:alert(1)">x</a><span data-track="1" style="color:red">y</span>',
    )
    expect(clean).not.toContain('javascript:')
    expect(clean).not.toContain('data-track')
    expect(clean).not.toContain('style')
  })
})

// ─── htmlToPreview：标签剥离 + 实体解码 + 截断 ────────────────────────────────

describe('htmlToPreview', () => {
  it('剥离标签并保留文本', () => {
    expect(htmlToPreview('<p>hello <b>world</b></p>')).toBe('hello world')
  })

  it('br 转空格、实体解码、空白折叠', () => {
    expect(htmlToPreview('a<br/>b&amp;c&nbsp;&nbsp;d')).toBe('a b&c d')
  })

  it('超长截断加省略号', () => {
    expect(htmlToPreview('x'.repeat(100), 80)).toBe(`${'x'.repeat(80)}…`)
    expect(htmlToPreview('short', 80)).toBe('short')
  })
})

// ─── mergeFeed：站内信 + 公告按时间新→旧合并截断 ──────────────────────────────

function makeNotification(id: number, createdAt: string): EduNotificationItem {
  return {
    id,
    notificationId: id,
    title: `n-${id}`,
    content: 'body',
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt,
  }
}

function makeAnnouncement(id: number, startTime: string): EduAnnouncementItem {
  return {
    id,
    content: `a-${id}`,
    status: 'active',
    startTime,
    endTime: '2999-12-31T23:59:59.000Z',
    createdAt: startTime,
    updatedAt: startTime,
  }
}

describe('mergeFeed', () => {
  const snapshot: NotificationSnapshot = {
    authed: true,
    unreadCount: 2,
    latestNotifications: [
      makeNotification(1, '2026-08-20T10:00:00Z'),
      makeNotification(2, '2026-08-19T10:00:00Z'),
    ],
    announcements: [
      makeAnnouncement(11, '2026-08-20T12:00:00Z'),
      makeAnnouncement(12, '2026-08-18T10:00:00Z'),
    ],
    lastSyncAt: '2026-08-20T12:30:00Z',
    lastError: null,
  }

  it('两类条目按时间新→旧交错排序', () => {
    const feed = mergeFeed(snapshot, 10)
    expect(feed.map((f) => `${f.kind[0]}${f.item.id}`)).toEqual(['a11', 'n1', 'n2', 'a12'])
  })

  it('limit 截断最新 N 条', () => {
    expect(mergeFeed(snapshot, 2)).toHaveLength(2)
    expect(mergeFeed(snapshot, 2)[0]?.kind).toBe('announcement')
  })

  it('空快照返回空数组', () => {
    expect(mergeFeed(null, 10)).toEqual([])
  })
})

// ─── formatNotificationTime：相对时间分档 ────────────────────────────────────

describe('formatNotificationTime', () => {
  const now = new Date('2026-08-20T12:00:00')

  it('无效时间返回空串', () => {
    expect(formatNotificationTime('not-a-date', 'zh', now)).toBe('')
  })

  it('刚刚 / 分钟前', () => {
    expect(formatNotificationTime('2026-08-20T11:59:30', 'zh', now)).toBe('刚刚')
    expect(formatNotificationTime('2026-08-20T11:30:00', 'zh', now)).toBe('30 分钟前')
    expect(formatNotificationTime('2026-08-20T11:30:00', 'en', now)).toBe('30m ago')
  })

  it('同日跨小时显示 N 小时前', () => {
    expect(formatNotificationTime('2026-08-20T09:00:00', 'zh', now)).toBe('3 小时前')
  })

  it('同年非同日显示 月-日，跨年显示完整日期', () => {
    expect(formatNotificationTime('2026-07-01T10:00:00', 'zh', now)).toBe('7月1日')
    expect(formatNotificationTime('2025-12-31T10:00:00', 'zh', now)).toBe('2025-12-31')
    expect(formatNotificationTime('2026-07-01T10:00:00', 'en', now)).toBe('7/1')
  })
})

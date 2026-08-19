/**
 * 通知展示辅助：时间格式化 / 富文本净化 / 纯文本预览
 *
 * 安全说明：edu-server 站内信 content 为服务端构造的富文本 HTML，
 * 展示前必须经 DOMPurify 净化（白名单标签 + 链接强制 _blank + noopener）。
 * 公告 content 为纯文本（≤500 字），直接按文本渲染，无注入面。
 */

import DOMPurify from 'dompurify'
import type {
  EduAnnouncementItem,
  EduNotificationItem,
  NotificationSnapshot,
} from '@spark/protocol'
import type { Lang } from '../../i18n'

/** 允许的标签白名单：文本级富文本，无脚本/样式/媒体执行面 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'a',
  'ul',
  'ol',
  'li',
  'code',
  'pre',
  'blockquote',
  'span',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'hr',
]
const ALLOWED_ATTR = ['href', 'title']

let hookInstalled = false

function ensureLinkHook(): void {
  if (hookInstalled) return
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  hookInstalled = true
}

/** 净化站内信富文本正文（用于 dangerouslySetInnerHTML）*/
export function sanitizeNotificationHtml(html: string): string {
  ensureLinkHook()
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['style', 'script', 'img', 'iframe', 'form', 'input', 'button', 'svg', 'math'],
  })
}

/** HTML → 纯文本预览（标签剥离；预览按文本节点渲染，本身无注入风险）*/
export function htmlToPreview(html: string, maxLength = 80): string {
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

// ─── 快捷面板合并 feed（站内信 + 公告按时间新→旧）────────────────────────────

export type NotificationFeedItem =
  | { kind: 'notification'; item: EduNotificationItem }
  | { kind: 'announcement'; item: EduAnnouncementItem }

export function mergeFeed(
  snapshot: NotificationSnapshot | null,
  limit: number,
): NotificationFeedItem[] {
  if (!snapshot) return []
  const items: NotificationFeedItem[] = [
    ...snapshot.latestNotifications.map(
      (item): NotificationFeedItem => ({ kind: 'notification', item }),
    ),
    ...snapshot.announcements.map((item): NotificationFeedItem => ({ kind: 'announcement', item })),
  ]
  return items
    .sort((a, b) => {
      const ta = a.kind === 'notification' ? a.item.createdAt : a.item.startTime
      const tb = b.kind === 'notification' ? b.item.createdAt : b.item.startTime
      return ta < tb ? 1 : ta > tb ? -1 : 0
    })
    .slice(0, limit)
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 今天 HH:mm / MM-DD / YYYY-MM-DD */
export function formatNotificationTime(iso: string, lang: Lang, now = new Date()): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 60_000) return lang === 'zh' ? '刚刚' : 'just now'
  if (diffMs < 3_600_000) {
    const minutes = Math.floor(diffMs / 60_000)
    return lang === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`
  }
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  if (sameDay) {
    const hours = Math.floor(diffMs / 3_600_000)
    return lang === 'zh' ? `${hours} 小时前` : `${hours}h ago`
  }
  const sameYear = date.getFullYear() === now.getFullYear()
  if (sameYear)
    return lang === 'zh'
      ? `${date.getMonth() + 1}月${date.getDate()}日`
      : `${date.getMonth() + 1}/${date.getDate()}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

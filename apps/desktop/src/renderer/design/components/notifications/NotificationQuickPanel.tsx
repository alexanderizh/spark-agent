/**
 * 通知快捷面板（铃铛 Popover 内容）
 *
 * 最新 8 条（站内信 + 公告按时间合并）+ 全部已读 + 查看全部入口。
 * 扁平风格：无卡片边框，--bg-sunken 拉开层次，hover 加深底色。
 */

import { useMemo } from 'react'
import type { NotificationSnapshot } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useI18n } from '../../i18n'
import {
  formatNotificationTime,
  htmlToPreview,
  mergeFeed,
  type NotificationFeedItem,
} from './notification-format'
import { Button } from '@lobehub/ui'

export interface NotificationQuickPanelProps {
  snapshot: NotificationSnapshot | null
  ready: boolean
  refreshing: boolean
  onRefresh: () => void
  onMarkAllRead: () => void
  onOpenCenter: () => void
  onMarkRead: (id: number) => void
}

export function NotificationQuickPanel(props: NotificationQuickPanelProps): React.ReactElement {
  const { snapshot, ready, refreshing, onRefresh, onMarkAllRead, onOpenCenter, onMarkRead } = props
  const { t, lang } = useI18n()
  const feed = useMemo(() => mergeFeed(snapshot, 8), [snapshot])
  const unread = snapshot?.unreadCount ?? 0
  const authed = snapshot?.authed ?? false

  const handleItemClick = (entry: NotificationFeedItem): void => {
    if (entry.kind === 'notification' && !entry.item.isRead) onMarkRead(entry.item.id)
    onOpenCenter()
  }

  return (
    <div className="nb-quick">
      <div className="nb-quick-head">
        <span className="nb-quick-title">{t('app.notification.title')}</span>
        <div className="nb-quick-actions">
          <button
            className="nb-quick-action"
            aria-label={t('app.notification.refresh')}
            disabled={refreshing}
            onClick={onRefresh}
          >
            <Icons.Refresh size={12} className={refreshing ? 'nb-spin' : ''} />
          </button>
          {authed && (
            <button
              className="nb-quick-action"
              disabled={!authed || unread === 0}
              onClick={onMarkAllRead}
            >
              {t('app.notification.markAllRead')}
            </button>
          )}
        </div>
      </div>

      {!authed && <div className="nb-quick-hint">{t('app.notification.loginHint')}</div>}
      {snapshot?.lastError != null && (
        <div className="nb-quick-error" title={snapshot.lastError}>
          {t('app.notification.syncFailed')}
        </div>
      )}

      <div className="nb-quick-list">
        {feed.length === 0 ? (
          <div className="nb-quick-empty">
            <Icons.Bell size={20} />
            <span>{ready ? t('app.notification.emptyQuick') : '…'}</span>
          </div>
        ) : (
          feed.map((entry) =>
            entry.kind === 'notification' ? (
              <button
                key={`n-${entry.item.id}`}
                className={`nb-quick-item${entry.item.isRead ? '' : ' is-unread'}`}
                onClick={() => handleItemClick(entry)}
              >
                <span className="nb-quick-item-title">
                  {!entry.item.isRead && <i className="nb-dot" />}
                  {entry.item.title}
                </span>
                <span className="nb-quick-item-sub">
                  {formatNotificationTime(entry.item.createdAt, lang)}
                </span>
              </button>
            ) : (
              <button
                key={`a-${entry.item.id}`}
                className="nb-quick-item nb-quick-announcement"
                onClick={() => handleItemClick(entry)}
              >
                <span className="nb-quick-item-title">
                  <span className="badge info nb-quick-badge">
                    {t('app.notification.announcement')}
                  </span>
                  {htmlToPreview(entry.item.content, 46)}
                </span>
                <span className="nb-quick-item-sub">
                  {formatNotificationTime(entry.item.startTime, lang)}
                </span>
              </button>
            ),
          )
        )}
      </div>

      <Button className="nb-quick-footer" type="text" size="small" onClick={onOpenCenter}>
        {t('app.notification.viewAll')}
      </Button>
    </div>
  )
}

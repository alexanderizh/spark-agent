/**
 * NotificationCenterModal — 消息中心弹窗
 *
 * 全部 / 未读 Tab；平台公告置顶横幅；条目点击内联展开正文（DOMPurify 净化）；
 * 「加载更多」分页累积；空态与未登录引导。
 * 扁平风格：条目无描边，--bg-sunken 底色 + hover 加深。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Modal, Tabs } from 'antd'
import { Empty } from '@lobehub/ui'
import type { EduNotificationItem, NotificationSnapshot } from '@spark/protocol'
import { Icons } from '../../Icons'
import { useI18n } from '../../i18n'
import { formatNotificationTime, sanitizeNotificationHtml } from './notification-format'
import './NotificationCenterModal.less'

const PAGE_SIZE = 20

export interface NotificationCenterModalProps {
  open: boolean
  onClose: () => void
  snapshot: NotificationSnapshot | null
  refreshing: boolean
  onRefresh: () => void
  onMarkRead: (id: number) => void
  onMarkAllRead: () => void
}

interface ListState {
  items: EduNotificationItem[]
  total: number
  page: number
  loading: boolean
  error: string | null
}

export function NotificationCenterModal(props: NotificationCenterModalProps): React.ReactElement {
  const { open, onClose, snapshot, refreshing, onRefresh, onMarkRead, onMarkAllRead } = props
  const { t, lang } = useI18n()
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [state, setState] = useState<ListState>({
    items: [],
    total: 0,
    page: 1,
    loading: false,
    error: null,
  })
  const requestSeq = useRef(0)

  const authed = snapshot?.authed ?? false
  const unreadCount = snapshot?.unreadCount ?? 0
  const announcements = snapshot?.announcements ?? []

  const loadPage = useCallback(async (page: number, mode: 'replace' | 'append') => {
    const seq = ++requestSeq.current
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const res = await window.spark.invoke('notification:list', { page, pageSize: PAGE_SIZE })
      if (seq !== requestSeq.current) return
      setState((prev) => ({
        items: mode === 'replace' ? res.list : [...prev.items, ...res.list],
        total: res.total,
        page,
        loading: false,
        error: null,
      }))
    } catch (e) {
      if (seq !== requestSeq.current) return
      setState((prev) => ({ ...prev, loading: false, error: (e as Error).message }))
    }
  }, [])

  // 打开时：加载第一页 + 标记公告已见（避免后续轮询重复提示）。
  // 公告列表经 ref 读取：快照更新不应重复触发本 effect。
  const announcementsRef = useRef(announcements)
  announcementsRef.current = announcements
  useEffect(() => {
    if (!open) return
    setTab('all')
    setExpandedId(null)
    void loadPage(1, 'replace')
    window.spark
      .invoke('notification:mark-announcements-seen', {
        ids: announcementsRef.current.map((a) => a.id),
      })
      .catch(() => undefined)
  }, [open, loadPage])

  const handleItemToggle = (item: EduNotificationItem): void => {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    if (!item.isRead) {
      onMarkRead(item.id)
      setState((prev) => ({
        ...prev,
        items: prev.items.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)),
      }))
    }
  }

  const handleMarkAll = (): void => {
    onMarkAllRead()
    setState((prev) => ({ ...prev, items: prev.items.map((n) => ({ ...n, isRead: true })) }))
  }

  const unreadItems = useMemo(() => state.items.filter((n) => !n.isRead), [state.items])
  const visibleItems = tab === 'unread' ? unreadItems : state.items
  const hasMore = state.items.length < state.total

  const renderBanner = (): ReactNode => {
    if (announcements.length === 0) return null
    const top = announcements.slice(0, 2)
    const rest = announcements.length - top.length
    return (
      <div className="nb-banner">
        {top.map((a) => (
          <div key={a.id} className="nb-banner-row">
            <span className="badge info nb-quick-badge">{t('app.notification.announcement')}</span>
            <span className="nb-banner-text" title={a.content}>
              {a.content}
            </span>
            <span className="nb-banner-time">{formatNotificationTime(a.startTime, lang)}</span>
          </div>
        ))}
        {rest > 0 && (
          <div className="nb-banner-more">
            {t('app.notification.moreAnnouncements', { n: String(rest) })}
          </div>
        )}
      </div>
    )
  }

  const renderList = (): ReactNode => {
    if (!authed) {
      return (
        <div className="nb-center-hint">
          <Empty description={t('app.notification.loginHint')} />
        </div>
      )
    }
    if (state.loading && state.items.length === 0) {
      return <div className="nb-center-hint">{t('app.notification.loading')}</div>
    }
    if (state.error != null && state.items.length === 0) {
      return (
        <div className="nb-center-hint">
          <div>{t('app.notification.loadFailed')}</div>
          <button className="nb-link" onClick={() => void loadPage(1, 'replace')}>
            {t('app.notification.retry')}
          </button>
        </div>
      )
    }
    if (visibleItems.length === 0) {
      return (
        <div className="nb-center-hint">
          <Empty
            description={
              tab === 'unread' ? t('app.notification.emptyUnread') : t('app.notification.emptyDesc')
            }
          />
        </div>
      )
    }
    return (
      <>
        {tab === 'unread' && unreadCount > unreadItems.length && (
          <div className="nb-unread-note">{t('app.notification.unreadNote')}</div>
        )}
        <div className="nb-list">
          {visibleItems.map((item) => (
            <div key={item.id} className={`nb-item${item.isRead ? '' : ' is-unread'}`}>
              <button className="nb-item-head" onClick={() => handleItemToggle(item)}>
                <span className="nb-item-title">
                  {!item.isRead && <i className="nb-dot" />}
                  {item.title}
                </span>
                <span className="nb-item-time">{formatNotificationTime(item.createdAt, lang)}</span>
                <Icons.ChevronDown
                  size={12}
                  className={`nb-item-chev${expandedId === item.id ? ' is-open' : ''}`}
                />
              </button>
              {expandedId === item.id && (
                <div
                  className="nb-item-body"
                  // 正文为服务端富文本 HTML，已在 sanitizeNotificationHtml 白名单净化
                  dangerouslySetInnerHTML={{ __html: sanitizeNotificationHtml(item.content) }}
                />
              )}
            </div>
          ))}
        </div>
        {hasMore && (
          <button
            className="nb-load-more"
            disabled={state.loading}
            onClick={() => void loadPage(state.page + 1, 'append')}
          >
            {state.loading
              ? t('app.notification.loadingMore')
              : t('app.notification.loadMore', {
                  shown: String(state.items.length),
                  total: String(state.total),
                })}
          </button>
        )}
      </>
    )
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={600}
      centered
      destroyOnHidden
      className="nb-center-modal"
      title={
        <div className="nb-center-title">
          <span>{t('app.notification.title')}</span>
          <div className="nb-center-title-actions">
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
                disabled={!authed || unreadCount === 0}
                onClick={handleMarkAll}
              >
                {t('app.notification.markAllRead')}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="nb-center">
        {renderBanner()}
        <Tabs
          size="small"
          activeKey={tab}
          onChange={(key) => setTab(key === 'unread' ? 'unread' : 'all')}
          items={[
            { key: 'all', label: t('app.notification.tabAll') },
            {
              key: 'unread',
              label:
                unreadCount > 0
                  ? `${t('app.notification.tabUnread')} (${unreadCount > 99 ? '99+' : unreadCount})`
                  : t('app.notification.tabUnread'),
            },
          ]}
        />
        {renderList()}
      </div>
    </Modal>
  )
}

/**
 * useNotifications — 渲染层通知状态钩子
 *
 * 数据流：
 *   - 挂载时拉取主进程缓存快照（notification:get-snapshot，无网络请求）
 *   - 订阅 stream:notification:changed：更新快照；携带新消息增量时弹 toast
 *     （单条显示标题/公告摘要，多条合并计数；带「查看 / 忽略」操作）
 *
 * toast 与主进程增量检测配合：主进程已按「已见集合」去重并处理基线
 * （首启/登录切换不弹），这里只负责展示。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { NotificationSnapshot } from '@spark/protocol'
import { useToast } from '../Toast'
import { useI18n } from '../../i18n'
import { htmlToPreview } from './notification-format'

export interface UseNotificationsOptions {
  /** 点击 toast「查看」时打开消息中心（由宿主组件注入）*/
  onOpenCenter?: () => void
}

export interface UseNotificationsResult {
  snapshot: NotificationSnapshot | null
  /** 初始快照是否已加载（区分「未同步」与「空」）*/
  ready: boolean
  refreshing: boolean
  refresh: () => Promise<void>
  markRead: (id: number) => Promise<void>
  markAllRead: () => Promise<void>
}

export function useNotifications(options: UseNotificationsOptions = {}): UseNotificationsResult {
  const { t } = useI18n()
  const { toast, dismiss } = useToast()
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null)
  const [ready, setReady] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const onOpenCenterRef = useRef(options.onOpenCenter)
  onOpenCenterRef.current = options.onOpenCenter
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('notification:get-snapshot', {})
      .then((res) => {
        if (!cancelled) setSnapshot(res.snapshot)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.spark?.on?.('stream:notification:changed', (payload) => {
      setSnapshot(payload.snapshot)
      fireToastForNewItems(payload)
    })
    return () => unsubscribe?.()
  }, [])

  const fireToastForNewItems = (payload: {
    newNotifications: { title: string }[]
    newAnnouncements: { content: string }[]
  }): void => {
    const { newNotifications, newAnnouncements } = payload
    const count = newNotifications.length + newAnnouncements.length
    if (count === 0) return

    const tr = tRef.current
    let message: string
    if (count === 1 && newNotifications.length === 1) {
      message = newNotifications[0]?.title ?? tr('app.notification.newMessage')
    } else if (count === 1 && newAnnouncements.length === 1) {
      message = `${tr('app.notification.announcement')}：${htmlToPreview(newAnnouncements[0]?.content ?? '', 60)}`
    } else {
      message = tr('app.notification.newMessages', { n: String(count) })
    }

    const id = toast.info(message, {
      duration: 8000,
      actions: [
        {
          label: tr('app.notification.view'),
          onClick: () => {
            dismiss(id)
            onOpenCenterRef.current?.()
          },
        },
        { label: tr('app.notification.ignore'), onClick: () => dismiss(id) },
      ],
    })
  }

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await window.spark.invoke('notification:refresh', {})
      setSnapshot(res.snapshot)
    } catch {
      // 静默：面板保留旧快照，lastError 由主进程维护
    } finally {
      setRefreshing(false)
    }
  }, [])

  const markRead = useCallback(async (id: number) => {
    try {
      await window.spark.invoke('notification:mark-read', { id })
    } catch {
      // 快照将由轮询事件自然对齐；这里不弹错误打扰
    }
  }, [])

  const markAllRead = useCallback(async () => {
    try {
      await window.spark.invoke('notification:mark-all-read', {})
    } catch {
      // 同上
    }
  }, [])

  return { snapshot, ready, refreshing, refresh, markRead, markAllRead }
}

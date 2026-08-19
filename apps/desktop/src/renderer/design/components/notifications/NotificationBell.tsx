/**
 * NotificationBell — 侧栏底部通知铃铛
 *
 * 位置：用户头像与设置按钮之间（App.tsx .sidebar-bottom-user 内）。
 * 结构：铃铛按钮（复用 .sidebar-user-settings 28×28 样式）+ 红色数字徽标
 *      （>99 显示 99+）+ 快捷面板（antd Popover，click / topLeft，与用户菜单一致）。
 */

import { useState } from 'react'
import { Popover } from 'antd'
import { Tooltip } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { useI18n } from '../../i18n'
import { useNotifications } from './useNotifications'
import { NotificationQuickPanel } from './NotificationQuickPanel'
import { NotificationCenterModal } from './NotificationCenterModal'
import './NotificationBell.less'

export function NotificationBell(): React.ReactElement {
  const { t } = useI18n()
  const [panelOpen, setPanelOpen] = useState(false)
  const [centerOpen, setCenterOpen] = useState(false)
  const { snapshot, ready, refreshing, refresh, markRead, markAllRead } = useNotifications({
    onOpenCenter: () => {
      setPanelOpen(false)
      setCenterOpen(true)
    },
  })

  const unread = snapshot?.unreadCount ?? 0

  const openCenter = (): void => {
    setPanelOpen(false)
    setCenterOpen(true)
  }

  return (
    <>
      <Popover
        trigger="click"
        placement="topLeft"
        open={panelOpen}
        onOpenChange={(open) => {
          setPanelOpen(open)
          // 打开面板时静默刷新一轮，保证数据不落后于上一个轮询周期
          if (open) void refresh()
        }}
        overlayClassName="nb-quick-popover"
        align={{ offset: [4, 0] }}
        content={
          <NotificationQuickPanel
            snapshot={snapshot}
            ready={ready}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onMarkAllRead={() => void markAllRead()}
            onOpenCenter={openCenter}
            onMarkRead={(id) => void markRead(id)}
          />
        }
      >
        <Tooltip title={t('app.notification.bellTip')} mouseEnterDelay={0.05}>
          <button
            className="sidebar-user-settings nb-bell-btn"
            aria-label={t('app.notification.bellTip')}
            aria-haspopup="dialog"
            aria-expanded={panelOpen}
          >
            <Icons.Bell size={13} />
            {unread > 0 && (
              <span
                className="nb-bell-badge"
                aria-label={t('app.notification.unreadCount', { n: String(unread) })}
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </button>
        </Tooltip>
      </Popover>

      <NotificationCenterModal
        open={centerOpen}
        onClose={() => setCenterOpen(false)}
        snapshot={snapshot}
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        onMarkRead={(id) => void markRead(id)}
        onMarkAllRead={() => void markAllRead()}
      />
    </>
  )
}

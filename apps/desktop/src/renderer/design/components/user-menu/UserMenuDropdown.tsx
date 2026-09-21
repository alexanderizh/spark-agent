/**
 * UserMenuDropdown — 侧栏左下角账号弹层（点用户信息后展开的菜单）。
 *
 * 容器只负责挂载与触发；条目、图标列、数值列与分区的版式都在
 * userMenuItems 里，便于单测覆盖各种登录 / 同步 / 更新状态。
 * 打开时菜单保持受控，账号同步执行期间不收起，让行内 loading 可见。
 */
import React from 'react'
import { Dropdown, type MenuProps } from 'antd'
import { Icons } from '../../Icons'
import {
  buildUserMenuItems,
  type BuildUserMenuItemsOptions,
  type UserMenuAccountSummary,
  type UserMenuAppearanceState,
} from './userMenuItems'
import type { UserMenuSyncState, UserMenuUpdateInfo } from './userMenuModel'

export interface UserMenuDropdownProps extends BuildUserMenuItemsOptions {
  open: boolean
  /**
   * 开合回调；关闭来源会通过 info.source 区分「点菜单项」与「点触发器/外部」，
   * 宿主可据此在同步进行中拒绝因点击菜单项而收起。
   */
  onOpenChange: (open: boolean, info?: { source: 'trigger' | 'menu' }) => void
  /** 菜单项点击（含 accent-* 二级项）；同步项由调用方决定是否关闭菜单 */
  onAction: (key: string) => void
  children: React.ReactNode
}

export type { UserMenuAccountSummary, UserMenuAppearanceState, UserMenuSyncState, UserMenuUpdateInfo }

export function UserMenuDropdown({
  open,
  onOpenChange,
  children,
  onAction,
  ...itemOptions
}: UserMenuDropdownProps): React.ReactElement {
  return (
    <Dropdown
      open={open}
      onOpenChange={onOpenChange}
      trigger={['click']}
      placement="topLeft"
      align={{ offset: [4, 0] }}
      styles={{
        root: {
          width: 264,
          minWidth: 256,
          maxWidth: 'calc(100vw - 24px)',
        },
      }}
      menu={
        {
          className: 'user-menu',
          expandIcon: (
            <span className="user-menu-expand-icon" aria-hidden="true">
              <Icons.ChevronRight size={12} strokeWidth={2} />
            </span>
          ),
          items: buildUserMenuItems(itemOptions),
          onClick: ({ key }: { key: string }) => onAction(key),
        } as MenuProps
      }
    >
      {children}
    </Dropdown>
  )
}

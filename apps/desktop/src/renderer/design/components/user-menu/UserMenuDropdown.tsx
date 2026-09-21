/**
 * UserMenuDropdown — 侧栏左下角账号弹层（点用户信息后展开的菜单）。
 *
 * 版式对齐同类桌面端的账号弹层：
 * 1. 账号区：头像 + 昵称 + 账号 + 档位标识，下面是账号中心、账号同步；
 * 2. 外观区：主题（浅色/深色/系统）、主题色（二级菜单）、菜单栏样式；
 * 3. 应用区：远程连接、检查更新、帮助与反馈、关于。
 *
 * 三块之间用内缩分割线隔开；所有「当前值 / 开关」都落在右侧同一列，
 * 图标列固定 16px，保证逐行对齐；同步执行期间菜单保持打开并在行内显示 loading。
 */
import React from 'react'
import { Dropdown, type MenuProps } from 'antd'
import { Segmented } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { PRIMARIES, type SidebarStyle, type ThemeMode } from '../../AppContext'
import { AvatarImage } from '../AvatarImage'
import type { TranslationKey } from '../../i18n'
import {
  describeSyncValue,
  describeUpdateValue,
  type UserMenuSyncState,
  type UserMenuUpdateInfo,
  type UserMenuValue,
} from './userMenuModel'

export interface UserMenuAccountSummary {
  authenticated: boolean
  name: string
  /** 账号（邮箱/手机号）等次要信息 */
  accountLabel: string
  avatarSrc: string
  /** 服务档位；无档位信息时不展示标识 */
  tier: { name: string; isPaid: boolean } | null
}

export interface UserMenuAppearanceState {
  theme: ThemeMode
  sidebarStyle: SidebarStyle
  /** 当前主色色值 */
  primary: string
}

export interface UserMenuDropdownProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: UserMenuAccountSummary
  appearance: UserMenuAppearanceState
  sync: UserMenuSyncState
  update: UserMenuUpdateInfo
  /** i18n 取词函数（当前语言） */
  tr: (key: TranslationKey, params?: Record<string, string | number>) => string
  /** 菜单项点击（含 accent-* 二级项）；同步项由调用方决定是否关闭菜单 */
  onAction: (key: string) => void
  onThemeChange: (theme: ThemeMode) => void
  onSidebarStyleChange: (style: SidebarStyle) => void
  children: React.ReactNode
}

function indicatorNode(indicator: UserMenuValue['indicator']): React.ReactNode {
  if (indicator === 'spinner') return <Icons.Spinner size={12} className="animate-spin" />
  if (indicator === 'check') return <Icons.Check size={12} />
  if (indicator === 'alert') return <Icons.AlertTriangle size={12} />
  return null
}

export function UserMenuDropdown({
  open,
  onOpenChange,
  account,
  appearance,
  sync,
  update,
  tr,
  onAction,
  onThemeChange,
  onSidebarStyleChange,
  children,
}: UserMenuDropdownProps): React.ReactElement {
  /** 图标列：固定 16px 容器，保证所有行左对齐到同一条竖线 */
  const iconSlot = (node: React.ReactNode): React.ReactNode => (
    <span className="user-menu-icon" aria-hidden="true">
      {node}
    </span>
  )

  const valueNode = (value: UserMenuValue | null): React.ReactNode => {
    if (value == null) return null
    const text = value.labelKey != null ? tr(value.labelKey, value.params) : (value.raw ?? '')
    if (text.length === 0 && value.swatch == null) return null
    return (
      <span className={`user-menu-value is-${value.tone}`}>
        {value.swatch != null && (
          <span className="user-menu-value-swatch" style={{ background: value.swatch }} />
        )}
        {indicatorNode(value.indicator)}
        {text.length > 0 && <span className="user-menu-value-text">{text}</span>}
      </span>
    )
  }

  const row = (options: {
    icon: React.ReactNode
    text: string
    value?: UserMenuValue | null
    checked?: boolean
  }): React.ReactNode => (
    <span className="user-menu-label">
      {iconSlot(options.icon)}
      <span className="user-menu-label-text">{options.text}</span>
      {valueNode(options.value ?? null)}
      {options.checked === true && (
        <span className="user-menu-check">
          <Icons.Check size={13} />
        </span>
      )}
    </span>
  )

  const accentName = PRIMARIES[appearance.primary]?.name ?? appearance.primary
  const themeIcon =
    appearance.theme === 'dark' ? (
      <Icons.Moon size={14} />
    ) : appearance.theme === 'light' ? (
      <Icons.Sun size={14} />
    ) : (
      <Icons.Monitor size={14} />
    )

  const items: NonNullable<MenuProps['items']> = []

  if (account.authenticated) {
    items.push({
      key: 'account-header',
      className: 'user-menu-account-header',
      disabled: true,
      label: (
        <span className="user-menu-account">
          <span className="user-menu-account-avatar">
            {account.avatarSrc.length > 0 && (
              <AvatarImage
                src={account.avatarSrc}
                seed={account.accountLabel || account.name}
                name={account.name}
                alt={tr('app.user.avatarAlt')}
                className="user-menu-account-avatar-image"
              />
            )}
          </span>
          <span className="user-menu-account-info">
            <span className="user-menu-account-name">{account.name}</span>
            {account.accountLabel.length > 0 && (
              <span className="user-menu-account-sub">{account.accountLabel}</span>
            )}
          </span>
          {account.tier != null && account.tier.name.trim().length > 0 && (
            <span className={`user-menu-tier${account.tier.isPaid ? ' is-paid' : ''}`}>
              {account.tier.name}
            </span>
          )}
        </span>
      ),
    })
    items.push({
      key: 'account',
      label: row({ icon: <Icons.User size={14} />, text: tr('app.user.accountCenter') }),
    })
    items.push({
      key: 'account-sync',
      // exactOptionalPropertyTypes 下不能传 undefined，未执行时给空串
      className: sync.busy ? 'user-menu-item-busy' : '',
      label: row({
        icon: <Icons.Refresh size={14} />,
        text: tr('app.user.sync'),
        value: describeSyncValue(sync),
      }),
    })
  } else {
    items.push({
      key: 'login',
      label: row({ icon: <Icons.User size={14} />, text: tr('app.user.login') }),
    })
  }

  items.push({ key: 'divider-account', type: 'divider' })

  items.push({
    key: 'theme',
    className: 'user-menu-inline-menu-item',
    label: (
      <div
        className="user-menu-inline-control"
        role="group"
        aria-label={tr('app.user.theme')}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="user-menu-inline-control-label">
          {iconSlot(themeIcon)}
          <span>{tr('app.user.theme')}</span>
        </span>
        <Segmented
          className="user-menu-inline-segmented user-menu-inline-segmented-appearance"
          size="small"
          value={appearance.theme}
          options={[
            { label: tr('app.user.themeLight'), value: 'light' },
            { label: tr('app.user.themeDark'), value: 'dark' },
            { label: tr('app.user.themeSystem'), value: 'system' },
          ]}
          onChange={(value) => onThemeChange(value as ThemeMode)}
        />
      </div>
    ),
  })

  items.push({
    key: 'accent',
    popupClassName: 'user-menu-submenu-popup',
    label: row({
      icon: <Icons.Palette size={14} />,
      text: tr('app.user.accent'),
      value: {
        labelKey: null,
        raw: accentName,
        tone: 'muted',
        indicator: 'none',
        swatch: appearance.primary,
      },
    }),
    children: Object.entries(PRIMARIES).map(([color, info]) => ({
      key: `accent-${color}`,
      label: row({
        icon: <span className="user-menu-accent-swatch" style={{ background: color }} />,
        text: info.name,
        checked: appearance.primary === color,
      }),
    })),
  })

  items.push({
    key: 'sidebar-style',
    className: 'user-menu-inline-menu-item',
    label: (
      <div
        className="user-menu-inline-control"
        role="group"
        aria-label={tr('app.sidebar.style')}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="user-menu-inline-control-label">
          {iconSlot(<Icons.PanelLeft size={14} />)}
          <span>{tr('app.sidebar.style')}</span>
        </span>
        <Segmented
          className="user-menu-inline-segmented user-menu-inline-segmented-sidebar"
          size="small"
          value={appearance.sidebarStyle}
          options={[
            { label: tr('app.sidebar.styleFloating'), value: 'floating' },
            { label: tr('app.sidebar.styleFlat'), value: 'flat' },
          ]}
          onChange={(value) => onSidebarStyleChange(value as SidebarStyle)}
        />
      </div>
    ),
  })

  items.push({ key: 'divider-appearance', type: 'divider' })

  items.push({
    key: 'remote',
    label: row({ icon: <Icons.Globe size={14} />, text: tr('app.nav.remote') }),
  })
  items.push({
    key: 'check-update',
    label: row({
      icon: <Icons.CloudDownload size={14} />,
      text: tr('app.update.check'),
      value: describeUpdateValue(update),
    }),
  })
  items.push({
    key: 'help',
    popupClassName: 'user-menu-submenu-popup',
    label: row({ icon: <Icons.HelpCircle size={14} />, text: tr('app.user.help') }),
    children: [
      {
        key: 'contact-qq',
        label: row({ icon: <Icons.Chat size={14} />, text: tr('app.user.qqGroup') }),
      },
      {
        key: 'contact-email',
        label: row({ icon: <Icons.Mail size={14} />, text: tr('app.user.emailFeedback') }),
      },
      {
        key: 'contact-github-issue',
        label: row({ icon: <Icons.Bug size={14} />, text: tr('app.user.contactGithubIssue') }),
      },
    ],
  })
  items.push({
    key: 'about-spark',
    popupClassName: 'user-menu-submenu-popup',
    label: row({ icon: <Icons.Sparkles size={14} />, text: tr('app.user.aboutSpark') }),
    children: [
      {
        key: 'website',
        label: row({ icon: <Icons.Home size={14} />, text: tr('app.user.website') }),
      },
      {
        key: 'github',
        label: row({ icon: <Icons.GitHub size={14} />, text: tr('app.user.githubRepo') }),
      },
    ],
  })

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
          items,
          onClick: ({ key }: { key: string }) => onAction(key),
        } as MenuProps
      }
    >
      {children}
    </Dropdown>
  )
}

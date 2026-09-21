/**
 * userMenuItems — 用户菜单的条目树（数据 + 行内版式），与容器解耦。
 *
 * 约定：
 * - 图标列：每行左侧固定 16px 图标槽（iconSlot），保证所有行对齐；
 * - 数值列：当前值 / 状态 / 开关统一落在右侧同一列，按语义着色；
 * - 分区：块与块之间插入分割线条目（.user-menu-item-divider 内缩到文字列）。
 * 纯函数产出 antd items，便于单测覆盖登录态、同步态、更新态矩阵。
 */
import React from 'react'
import type { MenuProps } from 'antd'
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

export type UserMenuTranslate = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string

export interface UserMenuAccountSummary {
  authenticated: boolean
  name: string
  /** 账号（邮箱 / 手机号）等次要信息 */
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

export interface BuildUserMenuItemsOptions {
  tr: UserMenuTranslate
  account: UserMenuAccountSummary
  appearance: UserMenuAppearanceState
  sync: UserMenuSyncState
  update: UserMenuUpdateInfo
  onThemeChange: (theme: ThemeMode) => void
  onSidebarStyleChange: (style: SidebarStyle) => void
}

/** 图标列：固定 16px 容器，所有行左边缘对齐到同一条竖线 */
function iconSlot(node: React.ReactNode): React.ReactNode {
  return (
    <span className="user-menu-icon" aria-hidden="true">
      {node}
    </span>
  )
}

function indicatorNode(indicator: UserMenuValue['indicator']): React.ReactNode {
  if (indicator === 'spinner') return <Icons.Spinner size={12} className="animate-spin" />
  if (indicator === 'check') return <Icons.Check size={12} />
  if (indicator === 'alert') return <Icons.AlertTriangle size={12} />
  return null
}

/** 数值列：色块 + 指示器 + 文案，固定在行右侧 */
function valueNode(value: UserMenuValue | null, tr: UserMenuTranslate): React.ReactNode {
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

interface MenuRowOptions {
  icon: React.ReactNode
  text: string
  value?: UserMenuValue | null
  checked?: boolean
}

function row(options: MenuRowOptions, tr: UserMenuTranslate): React.ReactNode {
  return (
    <span className="user-menu-label">
      {iconSlot(options.icon)}
      <span className="user-menu-label-text">{options.text}</span>
      {valueNode(options.value ?? null, tr)}
      {options.checked === true && (
        <span className="user-menu-check">
          <Icons.Check size={13} />
        </span>
      )}
    </span>
  )
}

/** 行内分段控件（主题 / 菜单栏样式）：控件自身响应切换，行整体不触发菜单项点击 */
function inlineControl(options: {
  ariaLabel: string
  icon: React.ReactNode
  label: string
  className: string
  value: string
  options: { label: string; value: string }[]
  // Segmented 的取值类型是 string | number，这里按原样透传
  onChange: (value: string | number) => void
}): React.ReactNode {
  return (
    <div
      className="user-menu-inline-control"
      role="group"
      aria-label={options.ariaLabel}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="user-menu-inline-control-label">
        {iconSlot(options.icon)}
        <span>{options.label}</span>
      </span>
      <Segmented
        className={`user-menu-inline-segmented ${options.className}`}
        size="small"
        value={options.value}
        options={options.options}
        onChange={options.onChange}
      />
    </div>
  )
}

export function buildUserMenuItems(
  options: BuildUserMenuItemsOptions,
): NonNullable<MenuProps['items']> {
  const { tr, account, appearance, sync, update, onThemeChange, onSidebarStyleChange } = options
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
      label: row({ icon: <Icons.User size={14} />, text: tr('app.user.accountCenter') }, tr),
    })
    items.push({
      key: 'account-sync',
      // exactOptionalPropertyTypes 下不能传 undefined，未执行时给空串
      className: sync.busy ? 'user-menu-item-busy' : '',
      label: row(
        {
          icon: <Icons.Refresh size={14} />,
          text: tr('app.user.sync'),
          value: describeSyncValue(sync),
        },
        tr,
      ),
    })
  } else {
    items.push({
      key: 'login',
      label: row({ icon: <Icons.User size={14} />, text: tr('app.user.login') }, tr),
    })
  }

  items.push({ key: 'divider-account', type: 'divider' })

  items.push({
    key: 'theme',
    className: 'user-menu-inline-menu-item',
    label: inlineControl({
      ariaLabel: tr('app.user.theme'),
      icon:
        appearance.theme === 'dark' ? (
          <Icons.Moon size={14} />
        ) : appearance.theme === 'light' ? (
          <Icons.Sun size={14} />
        ) : (
          <Icons.Monitor size={14} />
        ),
      label: tr('app.user.theme'),
      className: 'user-menu-inline-segmented-appearance',
      value: appearance.theme,
      options: [
        { label: tr('app.user.themeLight'), value: 'light' },
        { label: tr('app.user.themeDark'), value: 'dark' },
        { label: tr('app.user.themeSystem'), value: 'system' },
      ],
      onChange: (value) => onThemeChange(value as ThemeMode),
    }),
  })

  items.push({
    key: 'accent',
    popupClassName: 'user-menu-submenu-popup',
    label: row(
      {
        icon: <Icons.Palette size={14} />,
        text: tr('app.user.accent'),
        value: {
          labelKey: null,
          raw: PRIMARIES[appearance.primary]?.name ?? appearance.primary,
          tone: 'muted',
          indicator: 'none',
          swatch: appearance.primary,
        },
      },
      tr,
    ),
    children: Object.entries(PRIMARIES).map(([color, info]) => ({
      key: `accent-${color}`,
      label: row(
        {
          icon: <span className="user-menu-accent-swatch" style={{ background: color }} />,
          text: info.name,
          checked: appearance.primary === color,
        },
        tr,
      ),
    })),
  })

  items.push({
    key: 'sidebar-style',
    className: 'user-menu-inline-menu-item',
    label: inlineControl({
      ariaLabel: tr('app.sidebar.style'),
      icon: <Icons.PanelLeft size={14} />,
      label: tr('app.sidebar.style'),
      className: 'user-menu-inline-segmented-sidebar',
      value: appearance.sidebarStyle,
      options: [
        { label: tr('app.sidebar.styleFloating'), value: 'floating' },
        { label: tr('app.sidebar.styleFlat'), value: 'flat' },
      ],
      onChange: (value) => onSidebarStyleChange(value as SidebarStyle),
    }),
  })

  items.push({ key: 'divider-appearance', type: 'divider' })

  items.push({
    key: 'remote',
    label: row({ icon: <Icons.Globe size={14} />, text: tr('app.nav.remote') }, tr),
  })
  items.push({
    key: 'check-update',
    label: row(
      {
        icon: <Icons.CloudDownload size={14} />,
        text: tr('app.update.check'),
        value: describeUpdateValue(update),
      },
      tr,
    ),
  })
  items.push({
    key: 'help',
    popupClassName: 'user-menu-submenu-popup',
    label: row({ icon: <Icons.HelpCircle size={14} />, text: tr('app.user.help') }, tr),
    children: [
      {
        key: 'contact-qq',
        label: row({ icon: <Icons.Chat size={14} />, text: tr('app.user.qqGroup') }, tr),
      },
      {
        key: 'contact-email',
        label: row({ icon: <Icons.Mail size={14} />, text: tr('app.user.emailFeedback') }, tr),
      },
      {
        key: 'contact-github-issue',
        label: row(
          { icon: <Icons.Bug size={14} />, text: tr('app.user.contactGithubIssue') },
          tr,
        ),
      },
    ],
  })
  items.push({
    key: 'about-spark',
    popupClassName: 'user-menu-submenu-popup',
    label: row({ icon: <Icons.Sparkles size={14} />, text: tr('app.user.aboutSpark') }, tr),
    children: [
      {
        key: 'website',
        label: row({ icon: <Icons.Home size={14} />, text: tr('app.user.website') }, tr),
      },
      {
        key: 'github',
        label: row({ icon: <Icons.GitHub size={14} />, text: tr('app.user.githubRepo') }, tr),
      },
    ],
  })

  return items
}

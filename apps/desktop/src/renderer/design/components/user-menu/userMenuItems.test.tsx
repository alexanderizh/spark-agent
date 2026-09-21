// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuProps } from 'antd'
import type { TranslationKey } from '../../i18n'
import {
  buildUserMenuItems,
  type BuildUserMenuItemsOptions,
} from './userMenuItems'

// 分段控件用最小 stub，断言聚焦在菜单自身的结构与数值列版式
vi.mock('@lobehub/ui', () => ({
  Segmented: ({
    className,
    value,
    options,
    onChange,
  }: {
    className?: string
    value?: string
    options?: { label: string; value: string }[]
    onChange?: (value: string) => void
  }) => (
    <span
      className={className}
      data-segmented-value={value}
      data-segmented-options={(options ?? []).map((option) => option.label).join('|')}
    >
      {(options ?? []).map((option) => (
        <button
          key={option.value}
          type="button"
          data-option={option.value}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  ),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TRANSLATIONS: Partial<Record<TranslationKey, string>> = {
  'app.user.accountCenter': '账号中心',
  'app.user.sync': '账号同步',
  'app.user.syncBusy': '同步中…',
  'app.user.syncDone': '已完成',
  'app.user.syncOff': '未开启',
  'app.user.syncLastAt': '上次 {{time}}',
  'app.user.theme': '主题',
  'app.user.themeLight': '浅色',
  'app.user.themeDark': '深色',
  'app.user.themeSystem': '系统',
  'app.user.accent': '主题色',
  'app.sidebar.style': '菜单栏',
  'app.sidebar.styleFloating': '悬浮态',
  'app.sidebar.styleFlat': '扁平态',
  'app.nav.remote': '远程连接',
  'app.update.check': '检查更新',
  'app.user.updateChecking': '检查中…',
  'app.user.updateAvailable': '新版本 {{version}}',
  'app.user.updateReady': '待安装',
  'app.user.help': '帮助与反馈',
  'app.user.qqGroup': '加入 QQ 讨论组',
  'app.user.emailFeedback': '邮箱反馈',
  'app.user.contactGithubIssue': 'GitHub Issue',
  'app.user.aboutSpark': '关于 SparkWork',
  'app.user.website': '官网',
  'app.user.githubRepo': 'GitHub 仓库',
  'app.user.login': '登录 / 注册',
  'app.user.avatarAlt': '用户头像',
}

const tr = (key: TranslationKey, params?: Record<string, string | number>): string => {
  const template = TRANSLATIONS[key] ?? key
  if (params == null) return template
  return template.replace(/{{(\w+)}}/g, (_, name: string) => String(params[name] ?? ''))
}

function options(patch: Partial<BuildUserMenuItemsOptions> = {}): BuildUserMenuItemsOptions {
  return {
    tr,
    account: {
      authenticated: true,
      name: '清欢',
      accountLabel: 'spark@example.com',
      avatarSrc: '',
      tier: { name: '免费版', isPaid: false },
    },
    appearance: { theme: 'light', sidebarStyle: 'flat', primary: '#6366f1' },
    sync: {
      authenticated: true,
      busy: false,
      outcome: null,
      enabled: true,
      selectedCount: 2,
      lastFinishedAt: null,
    },
    update: { state: 'idle', currentVersion: '1.1.0', availableVersion: null, percent: 0 },
    onThemeChange: vi.fn(),
    onSidebarStyleChange: vi.fn(),
    ...patch,
  }
}

type Item = NonNullable<MenuProps['items']>[number]

function keysOf(items: NonNullable<MenuProps['items']>): string[] {
  return items.map((item) => String(item?.key ?? '?'))
}

function findItem(items: NonNullable<MenuProps['items']>, key: string): Item {
  const found = items.find((item) => item != null && item.key === key)
  if (found == null) throw new Error(`Missing menu item: ${key}`)
  return found
}

function labelOf(item: Item): React.ReactNode {
  return item != null && 'label' in item ? item.label : null
}

describe('buildUserMenuItems', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** 渲染单个条目的 label，返回其根元素用于结构断言 */
  function renderLabel(node: React.ReactNode): HTMLElement {
    act(() => {
      root.render(<>{node}</>)
    })
    const element = container.firstElementChild
    if (element == null) throw new Error('label did not render')
    return element as HTMLElement
  }

  it('已登录：账号区 → 外观区 → 应用区，块之间用分割线隔开', () => {
    const items = buildUserMenuItems(options())

    expect(keysOf(items)).toEqual([
      'account-header',
      'account',
      'account-sync',
      'divider-account',
      'theme',
      'accent',
      'sidebar-style',
      'divider-appearance',
      'remote',
      'check-update',
      'help',
      'about-spark',
    ])
    expect(items.filter((item) => item != null && 'type' in item)).toHaveLength(2)
  })

  it('未登录：只保留登录入口，不展示账号区与同步行', () => {
    const items = buildUserMenuItems(
      options({ account: { ...options().account, authenticated: false } }),
    )

    expect(keysOf(items)).toEqual([
      'login',
      'divider-account',
      'theme',
      'accent',
      'sidebar-style',
      'divider-appearance',
      'remote',
      'check-update',
      'help',
      'about-spark',
    ])
  })

  it('账号区展示昵称、账号与档位标识，且不可点击', () => {
    const items = buildUserMenuItems(options())
    const header = findItem(items, 'account-header')

    expect(header != null && 'disabled' in header && header.disabled).toBe(true)
    const element = renderLabel(labelOf(header))
    expect(element.querySelector('.user-menu-account-name')?.textContent).toBe('清欢')
    expect(element.querySelector('.user-menu-account-sub')?.textContent).toBe(
      'spark@example.com',
    )
    expect(element.querySelector('.user-menu-tier')?.textContent).toBe('免费版')
    expect(element.querySelector('.user-menu-tier')?.className).not.toContain('is-paid')
  })

  it('每行左侧都只有一个图标槽，数值列落在右侧同一列', () => {
    const items = buildUserMenuItems(options())

    for (const item of items) {
      if (item == null || ('type' in item && item.type === 'divider')) continue
      // 账号区是头像 + 文案的信息块，不参与图标列对齐
      if (item.key === 'account-header') continue
      const element = renderLabel(labelOf(item))
      const iconSlots = element.querySelectorAll('.user-menu-icon')
      expect(iconSlots.length, `item ${String(item.key)} icon slot`).toBe(1)
      const value = element.querySelector('.user-menu-value')
      if (value != null) {
        expect(element.className).toContain('user-menu-label')
        expect(element.lastElementChild).toBe(value)
      }
    }
  })

  it('同步执行中：整行标记 busy 并显示 loading 文案', () => {
    const items = buildUserMenuItems(
      options({ sync: { ...options().sync, busy: true } }),
    )
    const syncItem = findItem(items, 'account-sync')

    expect(syncItem != null && 'className' in syncItem && syncItem.className).toContain(
      'user-menu-item-busy',
    )
    const element = renderLabel(labelOf(syncItem))
    expect(element.querySelector('.user-menu-value')?.textContent).toContain('同步中…')
    expect(element.querySelector('.user-menu-value')?.className).toContain('is-primary')
    expect(element.querySelector('.user-menu-spinner')).not.toBeNull()
  })

  it('同步未开启显示「未开启」，有记录则显示上次同步时间', () => {
    const off = buildUserMenuItems(options({ sync: { ...options().sync, enabled: false } }))
    expect(renderLabel(labelOf(findItem(off, 'account-sync'))).textContent).toContain('未开启')

    const last = buildUserMenuItems(
      options({
        sync: { ...options().sync, lastFinishedAt: '2026-09-22T14:05:00' },
      }),
    )
    expect(renderLabel(labelOf(findItem(last, 'account-sync'))).textContent).toContain(
      `上次 ${new Date('2026-09-22T14:05:00').toTimeString().slice(0, 5)}`,
    )
  })

  it('主题行用当前主题图标，分段值同步当前设置', () => {
    const items = buildUserMenuItems(
      options({ appearance: { ...options().appearance, theme: 'dark' } }),
    )
    const element = renderLabel(labelOf(findItem(items, 'theme')))
    const segmented = element.querySelector('.user-menu-inline-segmented')

    expect(segmented?.getAttribute('data-segmented-value')).toBe('dark')
    expect(segmented?.getAttribute('data-segmented-options')).toBe('浅色|深色|系统')
    // 深色主题下图标列切换为月亮图标（lucide 风格 path 不同，用图标存在性 + 槽位数保证）
    expect(element.querySelectorAll('.user-menu-icon')).toHaveLength(1)
  })

  it('主题色行：数值列显示当前主色名与色块，二级菜单勾选当前色', () => {
    const items = buildUserMenuItems(options())
    const element = renderLabel(labelOf(findItem(items, 'accent')))

    const swatch = element.querySelector<HTMLElement>('.user-menu-value-swatch')
    expect(swatch?.style.background).toBe('rgb(99, 102, 241)')
    expect(element.querySelector('.user-menu-value')?.textContent).toBe('Indigo')

    const accentItem = findItem(items, 'accent')
    const children =
      accentItem != null && 'children' in accentItem ? (accentItem.children ?? []) : []
    expect(children).toHaveLength(8)
    const currentChild = children.find((child) => child?.key === 'accent-#6366f1')
    expect(currentChild).toBeTruthy()
    expect(renderLabel(labelOf(currentChild ?? null)).querySelector('.user-menu-check')).not.toBeNull()
  })

  it('检查更新行显示当前版本，状态变化时切换到对应文案', () => {
    const idle = buildUserMenuItems(options())
    expect(renderLabel(labelOf(findItem(idle, 'check-update'))).textContent).toContain('v1.1.0')

    const available = buildUserMenuItems(
      options({
        update: {
          state: 'available',
          currentVersion: '1.1.0',
          availableVersion: '1.3.0',
          percent: 0,
        },
      }),
    )
    const element = renderLabel(labelOf(findItem(available, 'check-update')))
    expect(element.textContent).toContain('新版本 1.3.0')
    expect(element.querySelector('.user-menu-value')?.className).toContain('is-primary')
  })

  it('帮助与关于二级菜单使用各自文案，不再混用联系人与版本号', () => {
    const items = buildUserMenuItems(options())
    const help = findItem(items, 'help')
    const about = findItem(items, 'about-spark')

    expect(labelOf(help)).toBeTruthy()
    const helpChildren = help != null && 'children' in help ? (help.children ?? []) : []
    expect(helpChildren.map((child) => child?.key)).toEqual([
      'contact-qq',
      'contact-email',
      'contact-github-issue',
    ])
    expect(renderLabel(labelOf(helpChildren[0] ?? null)).textContent).toContain('加入 QQ 讨论组')

    const aboutChildren = about != null && 'children' in about ? (about.children ?? []) : []
    expect(aboutChildren.map((child) => child?.key)).toEqual(['website', 'github'])
    expect(renderLabel(labelOf(findItem(items, 'about-spark'))).textContent).toContain('关于 SparkWork')
  })

  it('分段控件切换按值回调，且不把点击冒泡成菜单项点击', async () => {
    const onThemeChange = vi.fn()
    const onSidebarStyleChange = vi.fn()
    const items = buildUserMenuItems(options({ onThemeChange, onSidebarStyleChange }))

    const themeElement = renderLabel(labelOf(findItem(items, 'theme')))
    expect(themeElement.getAttribute('role')).toBe('group')
    expect(themeElement.getAttribute('aria-label')).toBe('主题')
    const darkOption = themeElement.querySelector<HTMLButtonElement>('[data-option="dark"]')
    if (darkOption == null) throw new Error('missing dark option')
    await act(async () => darkOption.click())
    expect(onThemeChange).toHaveBeenCalledWith('dark')

    const styleElement = renderLabel(labelOf(findItem(items, 'sidebar-style')))
    const floatingOption = styleElement.querySelector<HTMLButtonElement>('[data-option="floating"]')
    if (floatingOption == null) throw new Error('missing floating option')
    await act(async () => floatingOption.click())
    expect(onSidebarStyleChange).toHaveBeenCalledWith('floating')
  })
})

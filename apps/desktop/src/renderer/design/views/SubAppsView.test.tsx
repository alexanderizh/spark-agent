// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppSummary } from '@spark/protocol'
import { SUB_APP_DIRECTORY_CHANGED_EVENT } from '../sub-app/subAppEvents'
import { SubAppsView } from './SubAppsView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  list: vi.fn(),
  updateDraft: vi.fn(),
  publish: vi.fn(),
  setEnabled: vi.fn(),
  archive: vi.fn(),
  deleteApp: vi.fn(),
  listReleases: vi.fn(),
}))

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Button = ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children: React.ReactNode
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
  }) => ReactActual.createElement('button', { disabled: disabled || loading, onClick }, children)
  const Input = ({
    allowClear: _allowClear,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { allowClear?: boolean }) =>
    ReactActual.createElement('input', props)
  const Empty = ({ children, description }: { children?: React.ReactNode; description?: string }) =>
    ReactActual.createElement('div', { 'data-testid': 'empty', 'data-desc': description }, children)
  const Tooltip = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children)
  const Modal = ({
    children,
    className,
    onCancel,
    open,
    title,
  }: {
    children?: React.ReactNode
    className?: string
    onCancel?: () => void
    open?: boolean
    title?: React.ReactNode
  }) =>
    ReactActual.createElement(
      'div',
      { className, 'data-modal-open': String(open), 'data-modal-title': title },
      open
        ? ReactActual.createElement(
            ReactActual.Fragment,
            null,
            ReactActual.createElement(
              'button',
              { 'aria-label': '关闭', className: 'ant-modal-close', onClick: onCancel },
              '×',
            ),
            children,
          )
        : null,
    )
  // 简化版 Dropdown：点击触发器展开，把 menu.items 渲染为按钮列表，便于测试菜单项交互。
  type MockMenuEntry =
    | { key: string; label: React.ReactNode; onClick?: () => void }
    | { type: 'divider' }
  const Dropdown = ({
    children,
    menu,
  }: {
    children: React.ReactNode
    menu?: { items?: MockMenuEntry[] }
  }) => {
    const [open, setOpen] = ReactActual.useState(false)
    const menuItems = (menu?.items ?? []).filter(
      (entry): entry is { key: string; label: React.ReactNode; onClick?: () => void } =>
        !('type' in entry),
    )
    return ReactActual.createElement(
      ReactActual.Fragment,
      null,
      ReactActual.createElement(
        'div',
        { 'data-testid': 'dropdown-trigger', onClick: () => setOpen((prev) => !prev) },
        children,
      ),
      open
        ? ReactActual.createElement(
            'div',
            { 'data-testid': 'dropdown-menu' },
            menuItems.map((item, index) =>
              ReactActual.createElement(
                'button',
                {
                  key: item.key ?? `item-${index}`,
                  type: 'button',
                  onClick: () => {
                    setOpen(false)
                    item.onClick?.()
                  },
                },
                item.label,
              ),
            ),
          )
        : null,
    )
  }
  const Checkbox = ({
    checked,
    children,
    onChange,
  }: {
    checked?: boolean
    children?: React.ReactNode
    onChange?: (checked: boolean) => void
  }) =>
    ReactActual.createElement(
      'label',
      null,
      ReactActual.createElement('input', {
        type: 'checkbox',
        checked: checked ?? false,
        onChange: (e) => onChange?.(e.target.checked),
      }),
      children,
    )
  return { Button, Input, Empty, Tooltip, Modal, Dropdown, Checkbox }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Badge = ({ text }: { text?: string }) =>
    ReactActual.createElement('span', { 'data-testid': 'badge' }, text)
  const Drawer = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    ReactActual.createElement('div', { 'data-drawer-open': String(open) }, children)
  const Popconfirm = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children)
  const Spin = () => ReactActual.createElement('span', { 'data-testid': 'spin' })
  const Switch = ({
    checked,
    onChange,
  }: {
    checked?: boolean
    onChange?: (checked: boolean) => void
  }) =>
    ReactActual.createElement('input', {
      type: 'checkbox',
      checked: checked ?? false,
      'data-testid': 'switch',
      onChange: (e) => onChange?.(e.target.checked),
    })
  const message = { success: vi.fn(), error: vi.fn() }
  const Modal = { confirm: vi.fn() }
  const Typography = {
    Text: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement('span', null, children),
  }
  const Alert = ({
    message: alertMessage,
    description,
  }: {
    message?: React.ReactNode
    description?: React.ReactNode
  }) =>
    ReactActual.createElement(
      'div',
      { 'data-testid': 'alert', role: 'alert' },
      alertMessage,
      description,
    )
  const Space = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement('div', null, children)
  const Tag = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement('span', { 'data-testid': 'tag' }, children)
  return { Badge, Drawer, Modal, Popconfirm, Spin, Switch, message, Typography, Alert, Space, Tag }
})

vi.mock('../sub-app/subAppClient', () => ({
  subAppClient: {
    list: (...args: unknown[]) => mocks.list(...args),
    updateDraft: (...args: unknown[]) => mocks.updateDraft(...args),
    publish: (...args: unknown[]) => mocks.publish(...args),
    setEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
    archive: (...args: unknown[]) => mocks.archive(...args),
    delete: (...args: unknown[]) => mocks.deleteApp(...args),
    listReleases: (...args: unknown[]) => mocks.listReleases(...args),
    rollback: vi.fn(),
    shareExport: vi.fn(),
    shareImportPreview: vi.fn(),
    shareImportApply: vi.fn(),
  },
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({ setTweak: mocks.setTweak }),
}))

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, lang: 'zh-CN' }),
}))

vi.mock('../Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get:
        (_target, prop: string) =>
        ({ size }: { size?: number }) =>
          React.createElement('span', { 'data-icon': prop, 'data-size': size }),
    },
  ),
}))

function makeApp(overrides: Partial<SubAppSummary> = {}): SubAppSummary {
  return {
    id: 'app-0001',
    name: '记账工具',
    description: '月度收支统计',
    icon: '📊',
    surface: 'content',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 3,
    publishedVersion: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('SubAppsView', () => {
  let container: HTMLElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    mocks.setTweak.mockReset()
    mocks.list.mockReset()
    mocks.updateDraft.mockReset()
    mocks.publish.mockReset()
    mocks.setEnabled.mockReset()
    mocks.archive.mockReset()
    mocks.deleteApp.mockReset()
    mocks.listReleases.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    container?.remove()
    container = undefined
    root = undefined
  })

  async function renderView(): Promise<void> {
    await act(async () => {
      const { SubAppSurfaceProvider } = await import('../sub-app/SubAppSurfaceHost')
      root?.render(
        React.createElement(SubAppSurfaceProvider, null, React.createElement(SubAppsView)),
      )
    })
  }

  it('空列表显示创建引导空态', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 })
    await renderView()
    const empty = container?.querySelector('[data-testid="empty"]')
    expect(empty).not.toBeNull()
    expect(empty?.getAttribute('data-desc')).toContain('还没有子应用')
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false }))
  })

  it('渲染应用卡片与状态徽标', async () => {
    mocks.list.mockResolvedValue({
      items: [
        makeApp(),
        makeApp({
          id: 'app-0002',
          name: '读书打卡',
          publicationStatus: 'draft',
          publishedVersion: null,
        }),
      ],
      total: 2,
    })
    await renderView()
    const cards = container?.querySelectorAll('[data-testid="sub-app-card"]')
    expect(cards?.length).toBe(2)
    expect(container?.textContent).toContain('记账工具')
    expect(container?.textContent).toContain('读书打卡')
    expect(container?.textContent).toContain('已发布 v2')
    expect(container?.textContent).toContain('草稿')
    expect(
      container?.querySelector('[data-testid="sub-app-card"]')?.getAttribute('data-featured'),
    ).toBe('true')
  })

  it('状态筛选只展示对应应用并保留特色卡片锚点', async () => {
    mocks.list.mockResolvedValue({
      items: [
        makeApp(),
        makeApp({
          id: 'app-0002',
          name: '读书打卡',
          publicationStatus: 'draft',
          publishedVersion: null,
        }),
      ],
      total: 2,
    })
    await renderView()

    const draftFilter = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('.sa-filter') ?? [],
    ).find((button) => button.textContent === '草稿')
    expect(draftFilter).toBeDefined()
    await act(async () => {
      draftFilter?.click()
    })

    const cards = container?.querySelectorAll('[data-testid="sub-app-card"]')
    expect(cards?.length).toBe(1)
    expect(cards?.[0]?.textContent).toContain('读书打卡')
    expect(cards?.[0]?.getAttribute('data-featured')).toBe('false')
  })

  it('筛选工具栏将搜索筛选与统计归档分列到两侧', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp()], total: 1 })
    await renderView()

    const start = container?.querySelector('.sa-toolbar-start')
    const end = container?.querySelector('.sa-toolbar-end')
    expect(start?.querySelector('.sa-search')).not.toBeNull()
    expect(start?.querySelector('.sa-filters')).not.toBeNull()
    expect(end?.querySelector('.sa-toolbar-meta')).not.toBeNull()
    expect(end?.querySelector('.sa-archived-toggle')).not.toBeNull()
  })

  it('头部保持紧凑且双击控件不会触发窗口最大化', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp()], total: 1 })
    const invoke = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
    await renderView()

    const header = container?.querySelector('.sa-header')
    expect(header?.querySelector('.sa-eyebrow')).toBeNull()
    expect(header?.querySelector('.sa-subtitle')).toBeNull()

    const refreshButton = Array.from(header?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === '刷新',
    )
    expect(refreshButton).toBeDefined()
    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(invoke).not.toHaveBeenCalled()

    await act(async () => {
      header?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    expect(invoke).toHaveBeenCalledWith('window:maximize', {})

    delete (window as unknown as { spark?: unknown }).spark
  })

  it('创建引导弹窗的关闭按钮可点击并关闭弹窗', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 })
    await renderView()

    const openButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('查看创建方式'),
    )
    expect(openButton).toBeDefined()
    await act(async () => {
      openButton?.click()
    })
    expect(container?.querySelector('.sa-guide-modal')?.getAttribute('data-modal-open')).toBe(
      'true',
    )

    const closeButton = container?.querySelector<HTMLButtonElement>(
      '.sa-guide-modal .ant-modal-close',
    )
    expect(closeButton).not.toBeNull()
    await act(async () => {
      closeButton?.click()
    })
    expect(container?.querySelector('.sa-guide-modal')?.getAttribute('data-modal-open')).toBe(
      'false',
    )
  })

  it('目录变化事件触发列表刷新并显示新发布应用', async () => {
    mocks.list.mockResolvedValue({ items: [], total: 0 })
    await renderView()
    expect(container?.querySelector('[data-testid="sub-app-card"]')).toBeNull()

    mocks.list.mockResolvedValue({ items: [makeApp()], total: 1 })
    await act(async () => {
      window.dispatchEvent(new Event(SUB_APP_DIRECTORY_CHANGED_EVENT))
    })

    expect(container?.querySelector('[data-testid="sub-app-card"]')?.textContent).toContain(
      '记账工具',
    )
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false }))
  })

  it('未知的历史文本图标回退为默认应用图标', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp({ icon: 'to do' })], total: 1 })
    await renderView()
    expect(
      container?.querySelector('[data-testid="sub-app-card"] [data-icon="AppWindow"]'),
    ).not.toBeNull()
    expect(container?.querySelector('.sa-card-icon')?.textContent).not.toContain('to do')
  })

  it('图标选择器把选择写入草稿并刷新菜单', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp({ icon: null })], total: 1 })
    mocks.updateDraft.mockResolvedValue({})
    await renderView()
    // 「修改图标」已收进更多操作菜单：先展开菜单，再点击菜单项
    const moreTrigger = container?.querySelector<HTMLDivElement>('[data-testid="dropdown-trigger"]')
    expect(moreTrigger).not.toBeNull()
    await act(async () => {
      moreTrigger?.click()
    })
    const iconButton = Array.from(container?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('图标'),
    )
    expect(iconButton).toBeDefined()
    await act(async () => {
      iconButton?.click()
    })
    const todoOption = container?.querySelector<HTMLButtonElement>('[aria-label="待办清单"]')
    expect(todoOption).not.toBeNull()
    await act(async () => {
      todoOption?.click()
    })
    expect(mocks.updateDraft).toHaveBeenCalledWith({
      appId: 'app-0001',
      expectedDraftRevision: 3,
      patch: { icon: 'builtin:list-todo' },
    })
  })

  it('点击打开写入 subAppOpenId 并切换到运行页视图', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp()], total: 1 })
    await renderView()
    const openBtn = Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('打开'),
    )
    expect(openBtn).toBeDefined()
    await act(async () => {
      openBtn?.click()
    })
    expect(mocks.setTweak).toHaveBeenCalledWith('subAppOpenId', 'app-0001')
    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'sub-app')
  })

  it('禁用开关触发 setEnabled 并刷新列表', async () => {
    mocks.list.mockResolvedValue({ items: [makeApp()], total: 1 })
    mocks.setEnabled.mockResolvedValue({ id: 'app-0001', enabled: false })
    await renderView()
    const switchEl = container?.querySelector<HTMLInputElement>(
      '[data-testid="sub-app-card"] [data-testid="switch"]',
    )
    expect(switchEl).not.toBeNull()
    await act(async () => {
      switchEl?.click()
    })
    expect(mocks.setEnabled).toHaveBeenCalledWith({ appId: 'app-0001', enabled: false })
  })

  it('加载失败展示错误横幅且不渲染卡片', async () => {
    mocks.list.mockRejectedValue(new Error('db locked'))
    await renderView()
    expect(container?.textContent).toContain('db locked')
    expect(container?.querySelector('[data-testid="sub-app-card"]')).toBeNull()
  })
})

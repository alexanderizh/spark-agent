// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppDetails } from '@spark/protocol'
import { SubAppRunView } from './SubAppRunView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  get: vi.fn(),
  publish: vi.fn(),
  setEnabled: vi.fn(),
  runnerProps: [] as Array<Record<string, unknown>>,
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
  const Tooltip = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children)
  return { Button, Tooltip }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Badge = ({ text }: { text?: string }) =>
    ReactActual.createElement('span', { 'data-testid': 'badge' }, text)
  const Popconfirm = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement(ReactActual.Fragment, null, children)
  const Segmented = ({ value }: { value?: string }) =>
    ReactActual.createElement('span', { 'data-testid': 'segmented', 'data-value': value })
  const Spin = () => ReactActual.createElement('span', { 'data-testid': 'spin' })
  const Switch = () => ReactActual.createElement('input', { 'data-testid': 'run-switch' })
  const message = { success: vi.fn(), error: vi.fn() }
  return { Badge, Popconfirm, Segmented, Spin, Switch, message }
})

vi.mock('../sub-app/subAppClient', () => ({
  subAppClient: {
    get: (...args: unknown[]) => mocks.get(...args),
    publish: (...args: unknown[]) => mocks.publish(...args),
    setEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
  },
}))

vi.mock('../sub-app/SubAppRunner', () => ({
  SubAppRunner: (props: Record<string, unknown>) => {
    mocks.runnerProps.push(props)
    return React.createElement('div', { 'data-testid': 'sub-app-runner' })
  },
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({
    setTweak: mocks.setTweak,
    t: { subAppOpenId: 'app-0001' },
  }),
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

function makeDetails(overrides: Partial<SubAppDetails> = {}): SubAppDetails {
  return {
    id: 'app-0001',
    name: '记账工具',
    description: '月度收支统计',
    icon: '📊',
    surface: 'content',
    publicationStatus: 'published',
    enabled: true,
    draftRevision: 4,
    publishedVersion: 3,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    draft: {
      revision: 4,
      source: '<html>draft-body</html>',
      config: {},
      manifest: {
        name: '记账工具',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: [],
      },
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
    publishedRelease: {
      id: 'rel-0003',
      appId: 'app-0001',
      version: 3,
      source: '<html>published-body</html>',
      config: {},
      manifest: {
        name: '记账工具',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: [],
      },
      publishedAt: '2026-08-09T00:00:00.000Z',
    },
    ...overrides,
  }
}

describe('SubAppRunView', () => {
  let container: HTMLElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    mocks.setTweak.mockReset()
    mocks.get.mockReset()
    mocks.publish.mockReset()
    mocks.setEnabled.mockReset()
    mocks.runnerProps = []
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
      root?.render(React.createElement(SubAppRunView))
    })
  }

  it('默认运行发布版并传入 release 信息', async () => {
    mocks.get.mockResolvedValue(makeDetails())
    await renderView()
    const runner = container?.querySelector('[data-testid="sub-app-runner"]')
    expect(runner).not.toBeNull()
    expect(mocks.runnerProps[0]).toMatchObject({
      appId: 'app-0001',
      mode: 'published',
      source: '<html>published-body</html>',
    })
    expect((mocks.runnerProps[0] as { release?: { version?: number } }).release?.version).toBe(3)
  })

  it('未发布过的应用自动回退草稿模式', async () => {
    mocks.get.mockResolvedValue(
      makeDetails({ publicationStatus: 'draft', publishedVersion: null, publishedRelease: null }),
    )
    await renderView()
    expect(mocks.runnerProps[0]).toMatchObject({
      mode: 'draft',
      source: '<html>draft-body</html>',
    })
  })

  it('加载失败显示错误与重试/返回', async () => {
    mocks.get.mockRejectedValue(new Error('not found'))
    await renderView()
    expect(container?.textContent).toContain('not found')
    expect(container?.querySelector('[data-testid="sub-app-runner"]')).toBeNull()
    const back = Array.from(container?.querySelectorAll('button') ?? []).find((b) =>
      b.textContent?.includes('返回列表'),
    )
    expect(back).toBeDefined()
    await act(async () => {
      back?.click()
    })
    expect(mocks.setTweak).toHaveBeenCalledWith('subAppOpenId', null)
    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'sub-apps')
  })

  it('返回按钮回到应用列表', async () => {
    mocks.get.mockResolvedValue(makeDetails())
    await renderView()
    const back = Array.from(container?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent?.includes('返回列表') || b.closest('.sar-header') != null,
    )
    await act(async () => {
      back?.click()
    })
    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'sub-apps')
  })
})

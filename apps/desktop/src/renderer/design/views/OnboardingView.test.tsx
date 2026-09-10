// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingView, shouldShowOnboardingAsync } from './OnboardingView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  toastInfo: vi.fn(),
  refreshData: vi.fn(),
  handleNewSession: vi.fn(),
  invoke: vi.fn(),
  api: vi.fn(),
}))

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Button = ({
    children,
    disabled,
    loading,
    onClick,
    type,
  }: {
    children: React.ReactNode
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
    type?: string
  }) =>
    ReactActual.createElement(
      'button',
      { disabled: disabled || loading, onClick, type: 'button', 'data-button-type': type },
      children,
    )

  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    ReactActual.createElement('input', props)
  const InputPassword = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    ReactActual.createElement('input', { ...props, type: 'password' })
  const TextArea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
    ReactActual.createElement('textarea', props)
  const Select = () => ReactActual.createElement('select')

  return { Button, Input, InputPassword, Select, TextArea }
})

vi.mock('../AppContext', () => ({
  useApp: () => ({ setTweak: mocks.setTweak }),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}))

vi.mock('../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({ invoke: (args: unknown) => mocks.api(channel, args) }),
}))

vi.mock('../SessionSidebarContext', () => ({
  useSessionSidebar: () => ({
    refreshData: mocks.refreshData,
    handleNewSession: mocks.handleNewSession,
  }),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: { info: mocks.toastInfo, success: vi.fn() } }),
}))

vi.mock('../components/ProviderLogo', () => ({
  ProviderLogo: () => React.createElement('span', { 'data-testid': 'provider-logo' }),
}))

vi.mock('../components/brand/SparkRibbon', () => ({
  SparkRibbon: () => React.createElement('div', { 'data-testid': 'ribbon' }),
}))

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.includes(text),
  )
  expect(button).toBeDefined()
  if (button == null) throw new Error(`Button not found: ${text}`)
  return button
}

describe('OnboardingView', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    localStorage.clear()
    mocks.setTweak.mockClear()
    mocks.toastInfo.mockClear()
    mocks.refreshData.mockClear()
    mocks.handleNewSession.mockClear()
    mocks.invoke.mockReset()
    mocks.api.mockReset()
    // 默认：settings:get 返回 null（未设置），settings:set 成功
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'settings:get') return Promise.resolve({ value: null })
      if (channel === 'settings:set') return Promise.resolve({ ok: true })
      return Promise.resolve(undefined)
    })
    vi.stubGlobal('spark', { invoke: mocks.invoke })
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('marks onboarding completed when the user skips it', async () => {
    act(() => {
      root = createRoot(container)
      root.render(<OnboardingView />)
    })

    await act(async () => {
      buttonByText('稍后再说').click()
      // 让 dismissOnboarding 触发的 IPC 微任务落地
      await Promise.resolve()
    })

    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'chat')
    expect(mocks.toastInfo).toHaveBeenCalledWith('已跳过新手引导，可稍后从设置中重新打开。')
    // 关键：跳过时把权威值写主进程（category=onboarding）。
    // 这是修复「生产环境每次重启都弹引导」的核心 —— localStorage 按 origin 隔离
    // (file:// vs http://localhost:5173)，只有主进程值能跨 origin 共享。
    expect(mocks.invoke).toHaveBeenCalledWith('settings:set', {
      category: 'onboarding',
      key: 'data',
      value: { completed: true, dismissed: true },
    })
  })

  it('matches the banner and assistant to the selected use case', () => {
    act(() => {
      root = createRoot(container)
      root.render(<OnboardingView />)
    })
    act(() => buttonByText('资料与文件').click())
    expect(buttonByText('资料与文件').getAttribute('aria-pressed')).toBe('true')
    expect(container.querySelector('.experience-story')?.textContent).toContain(
      '让信息，清晰起来。',
    )
    expect(container.querySelectorAll('.experience-progress li')).toHaveLength(3)
  })

  it('creates the matched assistant and opens chat after the first task succeeds', async () => {
    mocks.api.mockImplementation((channel: string) => {
      if (channel === 'provider:list') return Promise.resolve({ profiles: [] })
      if (channel === 'agent:create') return Promise.resolve({ agent: { id: 'agent-1' } })
      return Promise.resolve({})
    })
    mocks.handleNewSession.mockResolvedValue('session-1')
    act(() => {
      root = createRoot(container)
      root.render(<OnboardingView />)
    })
    act(() => buttonByText('资料与文件').click())
    await act(async () => {
      buttonByText('继续').click()
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await act(async () => {
      buttonByText('暂时跳过').click()
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await act(async () => {
      buttonByText('开始第一项任务').click()
    })
    expect(mocks.api).toHaveBeenCalledWith(
      'agent:create',
      expect.objectContaining({ metadata: expect.objectContaining({ templateId: 'document' }) }),
    )
    expect(mocks.api).toHaveBeenCalledWith(
      'session:submit-turn',
      expect.objectContaining({ sessionId: 'session-1' }),
    )
    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'chat')
    expect(mocks.invoke).toHaveBeenCalledWith(
      'settings:set',
      expect.objectContaining({ value: { completed: true, dismissed: false } }),
    )
  })

  it('keeps onboarding open and reports a failed first task', async () => {
    mocks.api.mockImplementation((channel: string) => {
      if (channel === 'provider:list') return Promise.resolve({ profiles: [] })
      if (channel === 'agent:create') return Promise.resolve({ agent: { id: 'agent-1' } })
      if (channel === 'session:submit-turn') return Promise.reject(new Error('network unavailable'))
      return Promise.resolve({})
    })
    mocks.handleNewSession.mockResolvedValue('session-1')
    act(() => {
      root = createRoot(container)
      root.render(<OnboardingView />)
    })
    await act(async () => {
      buttonByText('继续').click()
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await act(async () => {
      buttonByText('暂时跳过').click()
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    await act(async () => {
      buttonByText('开始第一项任务').click()
    })
    expect(container.querySelector('.onboarding-error')?.textContent).toContain(
      'network unavailable',
    )
    expect(mocks.setTweak).not.toHaveBeenCalledWith('view', 'chat')
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'settings:set',
      expect.objectContaining({ value: { completed: true, dismissed: false } }),
    )
  })

  it('shouldShowOnboardingAsync returns false when the main process marks onboarding completed', async () => {
    // 模拟主进程 SQLite 里已记录 completed=true（例如另一个 origin / 上次会话写过）
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'settings:get') {
        return Promise.resolve({ value: { completed: true, dismissed: false } })
      }
      return Promise.resolve({ ok: true })
    })
    // 即便 localStorage 为空（新 origin），异步读主进程也应判定为"已完成"
    expect(localStorage.getItem('spark-agent:onboarding-completed')).toBeNull()
    const show = await shouldShowOnboardingAsync()
    expect(show).toBe(false)
    // 注意：不应再回写 localStorage —— 那会重新引入 origin 隔离的脏数据
    expect(localStorage.getItem('spark-agent:onboarding-completed')).toBeNull()
  })

  it('shouldShowOnboardingAsync migrates legacy localStorage to main process on first read', async () => {
    // 老用户首次升级：主进程无记录，但 localStorage（当前 origin）有完成标记
    localStorage.setItem('spark-agent:onboarding-completed', 'true')
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'settings:get') return Promise.resolve({ value: null })
      if (channel === 'settings:set') return Promise.resolve({ ok: true })
      return Promise.resolve(undefined)
    })

    const show = await shouldShowOnboardingAsync()

    expect(show).toBe(false)
    // localStorage 值应被迁移到主进程
    expect(mocks.invoke).toHaveBeenCalledWith('settings:set', {
      category: 'onboarding',
      key: 'data',
      value: { completed: true, dismissed: false },
    })
    // 迁移后清掉 localStorage，避免后续读取歧义
    expect(localStorage.getItem('spark-agent:onboarding-completed')).toBeNull()
  })

  it('shouldShowOnboardingAsync falls back to localStorage when IPC fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('ipc down'))
    localStorage.setItem('spark-agent:onboarding-completed', 'true')
    const show = await shouldShowOnboardingAsync()
    expect(show).toBe(false)
  })
})

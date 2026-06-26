// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingView, shouldShowOnboarding } from './OnboardingView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  setTweak: vi.fn(),
  toastInfo: vi.fn(),
  refreshData: vi.fn(),
  handleNewSession: vi.fn(),
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
  useIpcInvoke: () => ({ invoke: vi.fn() }),
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

vi.mock('../components/MacWindowDragHeader', () => ({
  MacWindowDragHeader: () => React.createElement('div', { 'data-testid': 'drag-header' }),
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
  })

  it('marks onboarding completed when the user skips it', () => {
    expect(shouldShowOnboarding()).toBe(true)

    act(() => {
      root = createRoot(container)
      root.render(<OnboardingView />)
    })

    act(() => {
      buttonByText('稍后再说').click()
    })

    expect(localStorage.getItem('spark-agent:onboarding-completed')).toBe('true')
    expect(localStorage.getItem('spark-agent:onboarding-dismissed')).toBe('true')
    expect(shouldShowOnboarding()).toBe(false)
    expect(mocks.setTweak).toHaveBeenCalledWith('view', 'chat')
    expect(mocks.toastInfo).toHaveBeenCalledWith('已跳过新手引导，可稍后从设置中重新打开。')
  })
})

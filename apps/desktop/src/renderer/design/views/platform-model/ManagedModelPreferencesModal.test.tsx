// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import { ManagedModelPreferencesModal } from './ManagedModelPreferencesModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({
    title,
    disabled,
    onClick,
  }: {
    title?: string
    disabled?: boolean
    onClick?: () => void
  }) => <button type="button" title={title} disabled={disabled} onClick={onClick} />,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children?: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Checkbox: ({
    checked,
    disabled,
    onChange,
  }: {
    checked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange?.(event.currentTarget.checked)}
    />
  ),
  Input: ({
    value,
    placeholder,
    onChange,
  }: {
    value?: string
    placeholder?: string
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  }) => <input value={value} placeholder={placeholder} onChange={onChange} />,
  Modal: ({
    children,
    footer,
    open,
  }: {
    children?: React.ReactNode
    footer?: React.ReactNode
    open?: boolean
  }) =>
    open ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
  Select: ({
    value,
    options = [],
    onChange,
  }: {
    value?: string | number
    options?: Array<{ label: string; value: string | number }>
    onChange?: (value: string | number) => void
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.currentTarget.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: toastMocks }),
}))

vi.mock('../../Icons', () => ({
  Icons: { Refresh: () => null, Spinner: () => null },
}))

const toastMocks = {
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}

const invoke = vi.fn()

describe('ManagedModelPreferencesModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('separates platform image models and shows them as automatically enabled', async () => {
    const profile = {
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      defaultModel: 'glm-5',
      modelIds: ['glm-5'],
      availableModelIds: ['glm-5'],
      mediaModelRefs: [
        {
          manifestId: 'platform:spark-img:test',
          modelId: 'spark-img',
          templateManifestId: 'openai-images:gpt-image-2',
          displayName: 'spark-img',
          enabled: true,
        },
      ],
      maxTokens: 128_000,
      modelType: 'text',
      supportsMillionContext: false,
      isDefault: false,
      keystoreRef: 'newapi-spark-user-1-api-key',
      managed: true,
      managedType: 'newapi',
      createdAt: '',
    } satisfies ProviderProfile

    await act(async () =>
      root.render(
        <ManagedModelPreferencesModal profile={profile} onClose={vi.fn()} onSaved={vi.fn()} />,
      ),
    )

    expect(container.textContent).toContain('对话模型')
    expect(container.textContent).toContain('上下文窗口')
    expect(container.querySelectorAll('select')).toHaveLength(2)
    expect(container.querySelectorAll('select')[1]?.value).toBe('1000000')
    expect(container.textContent).toContain('图片模型')
    expect(container.textContent).toContain('由平台标签自动启用')
    expect(container.textContent).toContain('spark-img')
    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[1]?.checked).toBe(true)
    expect(checkboxes[1]?.disabled).toBe(true)
  })

  it('renders an independent context window selector for each text model', async () => {
    const profile = {
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      defaultModel: 'glm-5',
      modelIds: ['glm-5', 'deepseek-v4'],
      availableModelIds: ['glm-5', 'deepseek-v4'],
      modelContextWindows: { 'glm-5': 1_000_000, 'deepseek-v4': 256_000 },
      maxTokens: 128_000,
      modelType: 'text',
      supportsMillionContext: false,
      isDefault: false,
      keystoreRef: 'newapi-spark-user-1-api-key',
      managed: true,
      managedType: 'newapi',
      createdAt: '',
    } satisfies ProviderProfile

    await act(async () =>
      root.render(
        <ManagedModelPreferencesModal profile={profile} onClose={vi.fn()} onSaved={vi.fn()} />,
      ),
    )

    const selects = container.querySelectorAll<HTMLSelectElement>('select')
    expect(selects).toHaveLength(3)
    expect(selects[1]?.value).toBe('1000000')
    expect(selects[2]?.value).toBe('256000')
    expect(container.textContent).toContain('glm-5')
    expect(container.textContent).toContain('deepseek-v4')
  })

  it('force refreshes and replaces the form with the latest provider catalog', async () => {
    const profile = {
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      defaultModel: 'glm-5',
      modelIds: ['glm-5'],
      availableModelIds: ['glm-5'],
      maxTokens: 128_000,
      modelType: 'text',
      supportsMillionContext: false,
      isDefault: false,
      keystoreRef: 'newapi-spark-user-1-api-key',
      managed: true,
      managedType: 'newapi',
      createdAt: '',
    } satisfies ProviderProfile
    const refreshedProfile = {
      ...profile,
      defaultModel: 'deepseek-v4',
      modelIds: ['deepseek-v4'],
      availableModelIds: ['deepseek-v4'],
      modelContextWindows: { 'deepseek-v4': 256_000 },
    } satisfies ProviderProfile
    let resolveRefresh!: () => void
    const refreshPending = new Promise<void>((resolve) => {
      resolveRefresh = resolve
    })
    invoke
      .mockReturnValueOnce(refreshPending)
      .mockResolvedValueOnce({ profiles: [refreshedProfile] })

    await act(async () =>
      root.render(
        <ManagedModelPreferencesModal profile={profile} onClose={vi.fn()} onSaved={vi.fn()} />,
      ),
    )

    act(() => {
      container.querySelector<HTMLButtonElement>('button[title="刷新模型列表"]')?.click()
    })

    const refreshingButton = container.querySelector<HTMLButtonElement>(
      'button[title="正在刷新模型列表"]',
    )
    expect(refreshingButton?.disabled).toBe(true)
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
        (button) => button.textContent === '保存',
      )?.disabled,
    ).toBe(true)

    await act(async () => {
      resolveRefresh()
      await refreshPending
    })

    expect(invoke).toHaveBeenNthCalledWith(1, 'platform-model:refresh-catalog', { force: true })
    expect(invoke).toHaveBeenNthCalledWith(2, 'provider:list', { includeDisabled: true })
    expect(container.textContent).not.toContain('glm-5')
    expect(container.textContent).toContain('deepseek-v4')
    expect(container.querySelectorAll<HTMLSelectElement>('select')[1]?.value).toBe('256000')
    expect(toastMocks.success).toHaveBeenCalledWith('平台模型列表已更新')
  })

  it('keeps the current catalog when refresh fails', async () => {
    const profile = {
      id: 'spark-platform-newapi',
      name: 'Spark 平台模型',
      provider: 'anthropic',
      defaultModel: 'glm-5',
      modelIds: ['glm-5'],
      availableModelIds: ['glm-5'],
      maxTokens: 128_000,
      modelType: 'text',
      supportsMillionContext: false,
      isDefault: false,
      keystoreRef: 'newapi-spark-user-1-api-key',
      managed: true,
      managedType: 'newapi',
      createdAt: '',
    } satisfies ProviderProfile
    invoke.mockRejectedValueOnce(new Error('目录服务不可用'))

    await act(async () =>
      root.render(
        <ManagedModelPreferencesModal profile={profile} onClose={vi.fn()} onSaved={vi.fn()} />,
      ),
    )

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[title="刷新模型列表"]')?.click()
    })

    expect(container.textContent).toContain('glm-5')
    expect(toastMocks.error).toHaveBeenCalledWith('目录服务不可用')
  })
})

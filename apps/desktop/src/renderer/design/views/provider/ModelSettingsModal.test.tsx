// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import { ModelSettingsModal } from './ModelSettingsModal'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  updateProvider: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.updateProvider }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { success: mocks.success, error: mocks.error } }),
}))

vi.mock('../../Icons', () => {
  const Icon = () => <span data-icon="stub" />
  return {
    Icons: new Proxy(
      {},
      {
        get: () => Icon,
      },
    ),
  }
})

vi.mock('antd', () => ({
  Switch: ({
    checked,
    disabled,
    size: _size,
    onChange,
    ...props
  }: {
    checked: boolean
    disabled?: boolean
    size?: string
    onChange: (checked: boolean) => void
    [key: string]: unknown
  }) => (
    <input
      type="checkbox"
      role="switch"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      {...props}
    />
  ),
}))

vi.mock('@lobehub/ui', () => ({
  Modal: ({
    open,
    title,
    footer,
    children,
  }: {
    open: boolean
    title?: React.ReactNode
    footer?: React.ReactNode
    children?: React.ReactNode
  }) =>
    open ? (
      <div data-testid="modal">
        <div data-testid="modal-title">{title}</div>
        <div>{children}</div>
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    placeholder?: string
  }) => (
    <input
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
    />
  ),
  Select: ({
    value,
    options,
    disabled,
    onChange,
  }: {
    value?: string
    options?: Array<{ value: string; label: string }>
    disabled?: boolean
    onChange?: (value: string) => void
  }) => (
    <select
      data-testid="reasoning-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Button: ({
    children,
    onClick,
    disabled,
    loading: _loading,
    size: _size,
    type: _type,
    icon: _icon,
    ...props
  }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
    loading?: boolean
    size?: string
    type?: string
    icon?: React.ReactNode
    [key: string]: unknown
  }) => (
    <button type="button" disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

function profile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>,
): ProviderProfile {
  return {
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    ...partial,
  } as ProviderProfile
}

const providerA = profile({
  id: 'provider-a',
  name: '渠道 A',
  modelIds: ['glm-5.3', 'glm-5.3-flash'],
  modelSettings: { 'glm-5.3': { reasoningEffort: 'high' } },
})

const providerB = profile({
  id: 'provider-b',
  name: '渠道 B',
  modelIds: ['gpt-5.4'],
  modelContextWindows: { 'gpt-5.4': 400_000 },
})

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  )
}

describe('ModelSettingsModal', () => {
  let container: HTMLDivElement
  let root: Root

  const renderModal = async (props: Partial<React.ComponentProps<typeof ModelSettingsModal>> = {}) => {
    const onClose = vi.fn()
    const onManageChannels = vi.fn()
    const onSaved = vi.fn()
    await act(async () => {
      root.render(
        <ModelSettingsModal
          open
          conversationalProviders={[providerA, providerB]}
          onClose={onClose}
          onManageChannels={onManageChannels}
          onSaved={onSaved}
          {...props}
        />,
      )
    })
    return { onClose, onManageChannels, onSaved }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateProvider.mockResolvedValue({ profile: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('按渠道分组渲染模型行，并展示已自定义统计', async () => {
    await renderModal()
    expect(container.textContent).toContain('渠道 A')
    expect(container.textContent).toContain('glm-5.3-flash')
    expect(container.textContent).toContain('渠道 B')
    // 渠道 A 的 glm-5.3 有推理默认、渠道 B 的 gpt-5.4 有模型级上下文
    expect(container.textContent).toContain('2 个模型已自定义')
  })

  it('显示状态列只渲染开关，后面不再跟文案', async () => {
    await renderModal()
    const cells = container.querySelectorAll('.mv_settings_visibility')
    // providerA 两个模型 + providerB 一个模型
    expect(cells.length).toBe(3)
    for (const cell of cells) {
      expect(cell.querySelector('[role="switch"]')).not.toBeNull()
      // 隐藏态由开关的 off 表达，单元格里不应再有「显示 / 已隐藏」文案
      expect(cell.textContent?.trim() ?? '').toBe('')
    }
    expect(container.querySelector('.mv_settings_visibility_label')).toBeNull()
  })

  it('无改动时保存按钮禁用，点击不发起 IPC 也不关闭弹窗', async () => {
    const { onClose } = await renderModal()
    const saveButton = findButton(container, '保存设置')
    expect(saveButton?.disabled).toBe(true)
    await act(async () => {
      saveButton?.click()
    })
    expect(mocks.updateProvider).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('修改推理强度后保存：整表下发该渠道并回调 onSaved', async () => {
    const { onClose, onSaved } = await renderModal()
    const selects = container.querySelectorAll<HTMLSelectElement>('[data-testid="reasoning-select"]')
    // 第 2 行 = 渠道 A 的 glm-5.3-flash（默认 → low）
    await act(async () => {
      const target = selects[1]
      if (target == null) throw new Error('select not found')
      target.value = 'low'
      target.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const saveButton = findButton(container, '保存设置')
    expect(saveButton?.disabled).toBe(false)
    await act(async () => {
      saveButton?.click()
    })

    expect(mocks.updateProvider).toHaveBeenCalledTimes(1)
    expect(mocks.updateProvider.mock.calls[0]?.[0]).toEqual({
      id: 'provider-a',
      modelSettings: {
        'glm-5.3': { reasoningEffort: 'high' },
        'glm-5.3-flash': { reasoningEffort: 'low' },
      },
    })
    expect(mocks.success).toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('隐藏开关写入 hidden:true，且上下文窗口随 modelSettings 一并下发', async () => {
    const { onClose } = await renderModal()
    const switches = container.querySelectorAll<HTMLInputElement>('input[role="switch"]')
    await act(async () => {
      switches[0]?.click()
    })
    await act(async () => {
      findButton(container, '保存设置')?.click()
    })
    const payload = mocks.updateProvider.mock.calls[0]?.[0] as {
      id: string
      modelSettings: Record<string, Record<string, unknown>>
    }
    expect(payload.id).toBe('provider-a')
    expect(payload.modelSettings['glm-5.3']).toEqual({ reasoningEffort: 'high', hidden: true })
    // 未改动模型保持原有覆盖（整表替换语义下不能丢）
    expect(payload.modelSettings['glm-5.3-flash']).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })

  it('保存失败：报错且保持弹窗打开（保留草稿供重试）', async () => {
    mocks.updateProvider.mockRejectedValue(new Error('渠道更新失败'))
    const { onClose, onSaved } = await renderModal()
    const switches = container.querySelectorAll<HTMLInputElement>('input[role="switch"]')
    await act(async () => {
      switches[0]?.click()
    })
    await act(async () => {
      findButton(container, '保存设置')?.click()
    })
    expect(mocks.error).toHaveBeenCalledWith('渠道更新失败')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="modal"]')).not.toBeNull()
  })

  it('「管理模型渠道」入口触发跳转回调', async () => {
    const { onManageChannels } = await renderModal()
    await act(async () => {
      findButton(container, '管理模型渠道')?.click()
    })
    expect(onManageChannels).toHaveBeenCalled()
  })

  it('搜索过滤模型行', async () => {
    await renderModal()
    const search = container.querySelector<HTMLInputElement>('input[placeholder="搜索模型或渠道"]')
    await act(async () => {
      if (search == null) throw new Error('search not found')
      // 受控 input：必须走原生 value setter，React 的 value tracker 才会识别变化
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set
      setValue?.call(search, 'flash')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('glm-5.3-flash')
    expect(container.textContent).not.toContain('gpt-5.4')
  })
})

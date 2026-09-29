// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderCreateRequest } from '@spark/protocol'

import {
  default as ProvidersView,
  ProviderEditPanel,
  resolveCodexApiKind,
  resolveProviderCardKind,
  sortProviderProfilesForCards,
} from './ProvidersView'
import { getMediaRequestPreviewUrl } from './provider/providerMediaConfig'
import { canHealthCheckProviderCardKind } from './provider-card-actions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  invokers: new Map<string, ReturnType<typeof vi.fn>>(),
  // 删除复刻音色走全局确认弹窗（requestConfirm）。默认「取消」，
  // 用例要走到真删除时显式 mockResolvedValueOnce(true)。
  requestConfirm: vi.fn(async () => false),
}))

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Button = ({
    children,
    loading: _loading,
    danger: _danger,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; danger?: boolean }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
  const Drawer = ({
    children,
    footer,
  }: {
    children: React.ReactNode
    footer?: React.ReactNode
  }) => (
    <div>
      {children}
      {footer}
    </div>
  )
  const Input = ({
    allowClear: _allowClear,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { allowClear?: boolean }) => <input {...props} />
  // 音色 / 参数默认值用 AutoComplete 渲染候选，测试里把候选项摊平成可查询节点。
  const AutoComplete = ({
    value,
    options = [],
    placeholder,
    onChange,
  }: {
    value?: string
    options?: Array<{ label?: React.ReactNode; value: string }>
    placeholder?: string
    onChange?: (value: string) => void
  }) => (
    <div data-testid="auto-complete">
      <input
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {options.map((option) => (
        <div key={option.value} data-option-value={option.value}>
          {option.label}
        </div>
      ))}
    </div>
  )
  const InputPassword = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input type="password" {...props} />
  )
  const Select = ({
    value,
    options = [],
    onChange,
  }: {
    value?: string
    options?: Array<{ label: React.ReactNode; value: string }>
    onChange?: (value: string) => void
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
  const Checkbox = ({ children }: { children?: React.ReactNode }) => <label>{children}</label>
  const Tag = ({ children }: { children?: React.ReactNode }) => <span>{children}</span>
  const Dropdown = ({
    children,
    open,
    onOpenChange,
    popupRender,
  }: {
    children?: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
    popupRender?: () => React.ReactNode
    menu?: unknown
    trigger?: unknown
    placement?: unknown
  }) => (
    <span onClick={() => onOpenChange?.(!open)}>
      {children}
      {open && popupRender ? popupRender() : null}
    </span>
  )
  const Alert = ({ message }: { message?: React.ReactNode }) => <div>{message}</div>
  const ActionIcon = () => ReactActual.createElement('button')
  const SearchBar = () => ReactActual.createElement('input')
  const Modal = ({
    children,
    open,
    onOk,
  }: {
    children?: React.ReactNode
    open?: boolean
    onOk?: () => void
  }) =>
    open ? (
      <div>
        {children}
        <button type="button" onClick={onOk}>
          检查并保存
        </button>
      </div>
    ) : null
  return {
    ActionIcon,
    Alert,
    AutoComplete,
    Button,
    Checkbox,
    Drawer,
    Dropdown,
    Input,
    InputPassword,
    Modal,
    SearchBar,
    Select,
    Tag,
  }
})

vi.mock('antd', () => ({
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Popconfirm: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Select: ({
    value,
    options = [],
    onChange,
  }: {
    value?: string[]
    options?: Array<{ label: React.ReactNode; value: string }>
    onChange?: (value: string[]) => void
  }) => (
    <select
      multiple
      data-testid="schedule-model-select"
      defaultValue={value}
      onChange={(event) => {
        const selected = Array.from(event.target.selectedOptions).map((option) => option.value)
        onChange?.(selected)
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Switch: ({
    checked,
    disabled,
    onChange,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    checked?: boolean
    disabled?: boolean
    onChange?: (checked: boolean) => void
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked === true ? 'true' : 'false'}
      disabled={disabled === true}
      onClick={() => onChange?.(!checked)}
      {...props}
    />
  ),
}))

vi.mock('../components/ProviderLogo', () => ({
  PROVIDER_ICON_CATALOG: [
    { id: 'openai', label: 'OpenAI', keywords: [] },
    { id: 'anthropic', label: 'Anthropic', keywords: [] },
    { id: 'deepseek', label: 'DeepSeek', keywords: [] },
  ],
  PROVIDER_ICON_STYLES: [
    { value: 'avatar', label: '头像' },
    { value: 'mono', label: '线性' },
  ],
  ProviderLogo: ({
    icon,
    vendor,
  }: {
    icon?: { id: string; style?: string } | null
    vendor?: { id?: string } | null
  }) => (
    <span data-testid="provider-logo">
      {icon ? `${icon.id}:${icon.style ?? 'avatar'}` : vendor?.id}
    </span>
  ),
  getProviderIconForVendor: (vendorId?: string | null) => {
    if (vendorId === 'deepseek-api') return { id: 'deepseek', style: 'avatar' }
    if (vendorId === 'openai') return { id: 'openai', style: 'avatar' }
    return { id: 'anthropic', style: 'avatar' }
  },
  normalizeProviderIconConfig: (icon?: { id: string; style?: string } | null) =>
    icon ? { id: icon.id, style: icon.style === 'mono' ? 'mono' : 'avatar' } : null,
}))

// ProviderModelCatalog 的可交互 stub：按候选目录渲染 toggle 按钮，
// 让测试能驱动「勾选启用 / 取消启用」的父级状态联动（组件内部交互不在本测试范围）。
vi.mock('../components/ProviderModelCatalog', () => ({
  ProviderModelCatalog: ({
    catalogModelIds,
    modelIds,
    onToggleCatalogModel,
  }: {
    catalogModelIds: string[]
    modelIds: string[]
    onToggleCatalogModel: (modelId: string, checked: boolean) => void
  }) => (
    <div data-testid="provider-model-catalog">
      {catalogModelIds.map((id) => (
        <button key={id} onClick={() => onToggleCatalogModel(id, !modelIds.includes(id))}>
          {id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }),
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({
    requestConfirm: mocks.requestConfirm,
    setTweak: vi.fn(),
    t: { showProviderEdit: false },
  }),
}))

vi.mock('./platform-model/usePlatformModelCatalogRefresh', () => ({
  usePlatformModelCatalogRefresh: () => ({ refreshPlatformCatalog: vi.fn() }),
}))

vi.mock('../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => {
    if (!mocks.invokers.has(channel)) {
      const invoke = vi.fn(async () => {
        if (channel === 'canvas:media-models:list') return { models: [] }
        if (channel === 'provider:list') return { profiles: [] }
        return {}
      })
      mocks.invokers.set(channel, invoke)
    }
    return { invoke: mocks.invokers.get(channel) }
  },
}))

describe('ProviderEditPanel progressive configuration', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    mocks.invokers.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('refreshes local provider data without requiring platform catalog access', async () => {
    const listProviders = vi.fn(async () => ({ profiles: [] }))
    mocks.invokers.set('provider:list', listProviders)

    await act(async () => {
      root = createRoot(container)
      root.render(<ProvidersView />)
    })

    const refreshButton = container.querySelector('button[aria-label="刷新"]')
    expect(refreshButton).not.toBeNull()

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(listProviders).toHaveBeenCalledWith({ includeDisabled: true })
    expect(mocks.invokers.has('platform-model:refresh-catalog')).toBe(false)
  })

  it('echoes the saved key but only sends it back after the user edits it', async () => {
    const profile = {
      id: 'provider-key-echo',
      name: 'Key Echo Provider',
      provider: 'openai',
      defaultModel: 'gpt-5',
      modelIds: ['gpt-5'],
      apiEndpoint: 'https://api.openai.com/v1',
      codexApiKind: 'responses',
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: 'openai-provider-key-echo',
      createdAt: '',
      updatedAt: '',
    }
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    const getApiKey = vi.fn(async () => ({ apiKey: 'sk-saved-plaintext' }))
    mocks.invokers.set('provider:get-api-key', getApiKey)
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible profileId="provider-key-echo" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(getApiKey).toHaveBeenCalledWith({ id: 'provider-key-echo' })
    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput?.value).toBe('sk-saved-plaintext')

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0]).not.toHaveProperty('apiKey')

    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-user-updated',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(updateProvider).toHaveBeenCalledTimes(2)
    expect(updateProvider.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        apiKey: 'sk-user-updated',
      }),
    )
  })

  it('persists the API protocol format switch when saving an edited provider', async () => {
    const profile = {
      id: 'provider-protocol-switch',
      name: 'Protocol Switch Provider',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
      modelIds: ['claude-sonnet-4-20250514'],
      apiEndpoint: 'https://api.anthropic.com',
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: 'anthropic-provider-protocol-switch',
      createdAt: '',
      updatedAt: '',
    }
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-ant-saved' })),
    )
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          profileId="provider-protocol-switch"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const protocolSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="anthropic"]'),
    ) as HTMLSelectElement | undefined
    expect(protocolSelect).toBeDefined()
    act(() => {
      if (!protocolSelect) return
      protocolSelect.value = 'openai'
      protocolSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ id: 'provider-protocol-switch', provider: 'openai' }),
    )
  })

  it('keeps the full-URL switch inside the BaseURL input row and persists it', async () => {
    const profile = {
      id: 'provider-full-url-switch',
      name: 'Full URL Provider',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-20250514',
      modelIds: ['claude-sonnet-4-20250514'],
      apiEndpoint: 'https://api.anthropic.com',
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: 'anthropic-provider-full-url-switch',
      createdAt: '',
      updatedAt: '',
    }
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-ant-saved' })),
    )
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          profileId="provider-full-url-switch"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    // 开关必须落在 BaseURL 输入框同一行内（而不是标签行右侧）。
    const inputRow = container.querySelector('.pv_endpoint_input_row')
    expect(inputRow).not.toBeNull()
    expect(inputRow?.querySelector('input')).not.toBeNull()
    const toggle = inputRow?.querySelector('[role="switch"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()
    expect(toggle?.getAttribute('aria-checked')).toBe('false')

    act(() => toggle?.click())
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    // 开启后预览让位给「原样请求」，不再展示派生地址。
    expect(container.textContent).toContain('实际请求地址（原样请求）')

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ id: 'provider-full-url-switch', apiEndpointFullUrl: true }),
    )
  })

  it('exposes the full-URL switch for image models and persists it', async () => {
    const profile = {
      id: 'provider-image-full-url',
      name: 'Image Provider',
      provider: 'openai',
      modelType: 'image',
      defaultModel: 'gpt-image-1',
      modelIds: ['gpt-image-1'],
      apiEndpoint: 'https://images.example.com/v1',
      mediaProvider: 'openai-compatible',
      mediaApiType: 'sync',
      mediaCapabilities: ['image.generate'],
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: 'openai-provider-image-full-url',
      createdAt: '',
      updatedAt: '',
    }
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-image' })),
    )
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible profileId="provider-image-full-url" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const inputRow = container.querySelector('.pv_endpoint_input_row')
    const toggle = inputRow?.querySelector('[role="switch"]') as HTMLButtonElement | null
    expect(toggle).not.toBeNull()

    act(() => toggle?.click())
    expect(container.textContent).toContain('生成/提交请求按所填地址原样发送')

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ id: 'provider-image-full-url', apiEndpointFullUrl: true }),
    )
  })

  it('saves a manually selected provider icon and keeps it while other fields change', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="anthropic-official"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const iconTrigger = container.querySelector(
      'button[aria-label="修改模型配置图标"]',
    ) as HTMLButtonElement | null
    expect(iconTrigger).not.toBeNull()
    act(() => iconTrigger?.click())

    const styleSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="mono"]'),
    ) as HTMLSelectElement | undefined
    expect(styleSelect).toBeDefined()
    act(() => {
      if (!styleSelect) return
      styleSelect.value = 'mono'
      styleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const deepSeekButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('DeepSeek'),
    )
    expect(deepSeekButton).toBeDefined()
    act(() => deepSeekButton?.click())
    expect(container.textContent).toContain('deepseek:mono')

    const nameInput = container.querySelector(
      'input[placeholder="例：Anthropic · Claude"]',
    ) as HTMLInputElement | null
    expect(nameInput).not.toBeNull()
    act(() => {
      if (!nameInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        nameInput,
        'My Claude Provider',
      )
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('deepseek:mono')

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-icon',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        providerIcon: { id: 'deepseek', style: 'mono' },
      }),
    )
  })

  it('replaces a manually selected icon when the provider template changes', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="anthropic-official"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const iconTrigger = container.querySelector(
      'button[aria-label="修改模型配置图标"]',
    ) as HTMLButtonElement | null
    act(() => iconTrigger?.click())
    const styleSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="mono"]'),
    ) as HTMLSelectElement | undefined
    act(() => {
      if (!styleSelect) return
      styleSelect.value = 'mono'
      styleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const openAiButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'OpenAI',
    )
    act(() => openAiButton?.click())
    expect(container.textContent).toContain('openai:mono')

    const templateSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="deepseek-api-anthropic"]'),
    ) as HTMLSelectElement | undefined
    expect(templateSelect).toBeDefined()
    act(() => {
      if (!templateSelect) return
      templateSelect.value = 'deepseek-api-anthropic'
      templateSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('deepseek:avatar')
  })

  it('keeps template-derived media routing read-only until converted to custom configuration', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="apimart-images" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('跟随供应商模板自动切换')
    expect(container.textContent).not.toContain('平台适配器')
    expect(container.textContent).not.toContain('生图接口来源')

    expect(container.textContent).toContain('媒体调用配置')
    expect(container.textContent).toContain('APIMart · auto 自动兼容')
    expect(container.textContent).toContain('转为自定义配置')
    expect(container.textContent).not.toContain('平台适配器')
    expect(container.textContent).not.toContain('生图接口来源')

    const convertButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('转为自定义配置'),
    )
    expect(convertButton).toBeDefined()

    act(() => convertButton?.click())

    expect(container.textContent).toContain('平台适配器')
    expect(container.textContent).toContain('调用方式')
    expect(container.textContent).not.toContain('生图接口来源')
    expect(container.querySelector('input[placeholder="接口超时 ms"]')).not.toBeNull()
    expect(container.querySelector('input[placeholder="轮询超时 ms"]')).toBeNull()
  })

  it('maps Volcengine Seedream template to Seedream image source before advanced settings are opened', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="volcengine-seedream-image"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKeyInput = container.querySelector(
      'input[placeholder="媒体平台 API Key"]',
    ) as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'volc-ak',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: 'image',
        imageProvider: 'seeddance',
        imageApiType: 'sync',
        mediaProvider: 'volcengine-ark',
        mediaApiType: 'sync',
      }),
    )
  })

  it('exposes the custom adapter entry for dedicated media providers', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="apimart-images" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('自定义模型 / 适配器')
    expect(container.textContent).toContain('点击「编辑协议」配置请求模板')
    expect(container.querySelector('input[placeholder*="输入模型 ID"]')).not.toBeNull()
  })

  it('keeps custom media catalogs empty and initializes candidates from /models', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'toapis-image-model', ownedBy: 'toapis' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const modelTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="image"]'),
    ) as HTMLSelectElement | undefined
    expect(modelTypeSelect).toBeDefined()
    act(() => {
      if (!modelTypeSelect) return
      modelTypeSelect.value = 'image'
      modelTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const mediaProviderSelect = Array.from(container.querySelectorAll('select')).find(
      (select) =>
        select.querySelector('option[value="custom"]') &&
        select.querySelector('option[value="apimart"]') &&
        select.querySelector('option[value="xai"]'),
    ) as HTMLSelectElement | undefined
    expect(mediaProviderSelect).toBeDefined()
    expect(mediaProviderSelect?.value).toBe('custom')
    expect(container.textContent).toContain('暂无匹配的内置模型清单')
    act(() => {
      if (!mediaProviderSelect) return
      mediaProviderSelect.value = 'custom'
      mediaProviderSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.textContent).toContain('暂无匹配的内置模型清单')
    expect(container.textContent).toContain('配置自定义适配器')

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-toapis-test',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const fetchButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '获取模型',
    )
    expect(fetchButton).toBeDefined()
    await act(async () => {
      fetchButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiKey: 'sk-toapis-test',
      }),
    )
    expect(container.textContent).toContain('toapis-image-model')
    expect(container.textContent).toContain('渠道 /models 返回的模型')
  })

  it('opens the full custom adapter editor without requiring an existing model ref', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const modelTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="image"]'),
    ) as HTMLSelectElement | undefined
    expect(modelTypeSelect).toBeDefined()
    act(() => {
      if (!modelTypeSelect) return
      modelTypeSelect.value = 'image'
      modelTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const mediaProviderSelect = Array.from(container.querySelectorAll('select')).find(
      (select) =>
        select.querySelector('option[value="custom"]') &&
        select.querySelector('option[value="apimart"]') &&
        select.querySelector('option[value="xai"]'),
    ) as HTMLSelectElement | undefined
    act(() => {
      if (!mediaProviderSelect) return
      mediaProviderSelect.value = 'custom'
      mediaProviderSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const configureButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '配置自定义适配器',
    )
    expect(configureButton).toBeDefined()
    act(() => configureButton?.click())
    expect(container.textContent).toContain('① 路由与模型')
    expect(container.textContent).toContain('③ 鉴权与提交')
    expect(container.textContent).toContain('⑥ 参数定义')
    expect(container.textContent).toContain('配置自定义适配器')
  })

  it('syncs the parent call mode from an async custom adapter manifest', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const modelTypeSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="image"]'),
    ) as HTMLSelectElement | undefined
    act(() => {
      if (!modelTypeSelect) return
      modelTypeSelect.value = 'image'
      modelTypeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const mediaProviderSelect = Array.from(container.querySelectorAll('select')).find(
      (select) =>
        select.querySelector('option[value="custom"]') &&
        select.querySelector('option[value="apimart"]') &&
        select.querySelector('option[value="xai"]'),
    ) as HTMLSelectElement | undefined
    act(() => {
      if (!mediaProviderSelect) return
      mediaProviderSelect.value = 'custom'
      mediaProviderSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const configureButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '配置自定义适配器',
    )
    act(() => configureButton?.click())

    const presetSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="toapis-image"]'),
    ) as HTMLSelectElement | undefined
    expect(presetSelect).toBeDefined()
    act(() => {
      if (!presetSelect) return
      presetSelect.value = 'toapis-image'
      presetSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('检查并保存'),
    )
    expect(saveButton).toBeDefined()
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('async · 任务轮询')

    const editProtocolButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('编辑协议'),
    )
    expect(editProtocolButton).toBeDefined()
    act(() => editProtocolButton?.click())
    const echoedPresetSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="toapis-image"]'),
    ) as HTMLSelectElement | undefined
    expect(echoedPresetSelect?.value).toBe('toapis-image')
  })

  it('preserves Agnes media refs when saving a multimodal preset', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="agnes-ai" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-agnes',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: 'multimodal',
        defaultModel: 'agnes-2.0-flash',
        mediaProvider: 'agnes',
        mediaCapabilities: expect.arrayContaining([
          'image.generate',
          'image.edit',
          'video.generate',
        ]),
        mediaModelRefs: expect.arrayContaining([
          expect.objectContaining({ manifestId: 'agnes:agnes-image-2.0-flash' }),
          expect.objectContaining({ manifestId: 'agnes:agnes-video-v2.0' }),
        ]),
      }),
    )
  })

  it('defaults Coding Plan OpenAI presets to Responses', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="zhipu-glm-coding-plan-openai"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKindSelect = Array.from(container.querySelectorAll('select')).find(
      (select) =>
        select.querySelector('option[value="responses"]') != null &&
        select.querySelector('option[value="chat"]') != null,
    ) as HTMLSelectElement | undefined

    expect(apiKindSelect).toBeDefined()
    expect(apiKindSelect?.value).toBe('responses')
  })

  it('shows the actual request address only once for OpenAI protocol settings', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="volcengine-ark-openai"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).not.toContain('请求端点：')
    expect(container.querySelectorAll('.pv_endpoint_inline_hint')).toHaveLength(1)
    expect(container.querySelector('.pv_endpoint_inline_hint')?.textContent).toContain(
      '实际请求地址：',
    )
  })

  it('keeps unknown OpenAI-compatible endpoints on Chat Completions by default', () => {
    expect(resolveCodexApiKind('openai', 'https://api.compat.example/v1')).toBe('chat')
    expect(resolveCodexApiKind('openai', 'https://open.bigmodel.cn/api/coding/paas/v4')).toBe(
      'responses',
    )
  })

  it('switches preset endpoint when protocol format changes', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="volcengine-ark-anthropic"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const providerSelect = Array.from(container.querySelectorAll('select')).find(
      (select) =>
        select.querySelector('option[value="anthropic"]') != null &&
        select.querySelector('option[value="openai"]') != null,
    ) as HTMLSelectElement | undefined
    const endpointInputBefore = Array.from(container.querySelectorAll('input')).find(
      (input) => input.value === 'https://ark.cn-beijing.volces.com/api/coding',
    ) as HTMLInputElement | undefined

    expect(providerSelect).toBeDefined()
    expect(endpointInputBefore).toBeDefined()

    await act(async () => {
      if (!providerSelect) return
      providerSelect.value = 'openai'
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const endpointInputAfter = Array.from(container.querySelectorAll('input')).find(
      (input) => input.value === 'https://ark.cn-beijing.volces.com/api/coding/v3',
    ) as HTMLInputElement | undefined
    expect(endpointInputAfter).toBeDefined()
  })

  it('does not make every fetched model globally available by default', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const nameInput = container.querySelector(
      'input[placeholder="例：Anthropic · Claude"]',
    ) as HTMLInputElement | null
    expect(nameInput).not.toBeNull()
    act(() => {
      if (!nameInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        nameInput,
        'Fetch Only Default',
      )
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-fetch',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const fetchButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('获取模型'),
    )
    await act(async () => {
      fetchButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'model-a',
        modelIds: ['model-a'],
      }),
    )
  })

  it('auto fetches Volcengine OpenAI models after API key entry and selects the first model', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'auto-first' }, { id: 'auto-second' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="volcengine-ark-openai"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-volcengine-auto',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900))
    })

    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
        apiKey: 'sk-volcengine-auto',
      }),
    )

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        codexApiKind: 'responses',
        defaultModel: 'auto-first',
        modelIds: ['auto-first'],
      }),
    )
  })

  it('auto fetches any chat provider models once API key is ready', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'claude-auto-first' }, { id: 'claude-auto-second' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="anthropic-official"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-ant-auto-fetch',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 900))
    })

    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        apiEndpoint: 'https://api.anthropic.com',
        apiKey: 'sk-ant-auto-fetch',
      }),
    )

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        defaultModel: 'claude-auto-first',
        modelIds: ['claude-auto-first'],
      }),
    )
  })

  it('supports selecting a fetched default model and only saving explicitly enabled models', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-c' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const nameInput = container.querySelector(
      'input[placeholder="例：Anthropic · Claude"]',
    ) as HTMLInputElement | null
    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(nameInput).not.toBeNull()
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (nameInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          nameInput,
          'Selectable Default',
        )
        nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (apiKeyInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          apiKeyInput,
          'sk-select',
        )
        apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    const fetchButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('获取模型'),
    )
    await act(async () => {
      fetchButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    // 默认模型选择器已合并成 Input + chevron 触发器：先点开下拉，再点候选列表里的 model-b。
    const modelPickerTrigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('title') === '从已获取模型中选择默认模型',
    )
    expect(modelPickerTrigger).toBeDefined()
    act(() => modelPickerTrigger?.click())

    const modelBOption = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'model-b',
    )
    expect(modelBOption).toBeDefined()
    act(() => modelBOption?.click())

    const modelAButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('model-a'),
    )
    const modelCButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('model-c'),
    )
    expect(modelAButton).toBeDefined()
    expect(modelCButton).toBeDefined()
    act(() => {
      modelAButton?.click()
      modelCButton?.click()
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'model-b',
        modelIds: ['model-b', 'model-c'],
      }),
    )
  })

  it('preserves the typed default model when models are fetched manually', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [{ id: 'model-a' }, { id: 'model-b' }],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible onClose={() => undefined} />)
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const inputs = Array.from(container.querySelectorAll('input'))
    const nameInput = inputs.find((input) => input.placeholder === '例：Anthropic · Claude') as
      | HTMLInputElement
      | undefined
    const modelInput = inputs.find((input) => input.placeholder.includes('claude-sonnet')) as
      | HTMLInputElement
      | undefined
    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    expect(nameInput).toBeDefined()
    expect(modelInput).toBeDefined()
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (nameInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          nameInput,
          'Manual Refetch',
        )
        nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (modelInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          modelInput,
          'model-b',
        )
        modelInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (apiKeyInput) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          apiKeyInput,
          'sk-manual-refetch',
        )
        apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })

    const fetchButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('获取模型'),
    )
    await act(async () => {
      fetchButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(fetchModels).toHaveBeenCalledTimes(1)

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'model-b',
        modelIds: ['model-b'],
      }),
    )
  })

  // ─── 定时禁用时段：编辑回显 / 日期多选 / 删除行 / 新建随建落库 ───
  const scheduleProfile = {
    id: 'provider-schedule-e2e',
    name: 'Schedule Provider',
    provider: 'openai',
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5', 'gpt-5-mini'],
    apiEndpoint: 'https://api.openai.com/v1',
    supportsMillionContext: false,
    isDefault: false,
    enabled: true,
    keystoreRef: 'openai-provider-schedule-e2e',
    createdAt: '',
    updatedAt: '',
    modelSchedules: [
      { modelId: 'gpt-5-mini', enabled: true, days: [1], startMinute: 600, endMinute: 720 },
    ],
  }

  async function renderSchedulePanel() {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [scheduleProfile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-saved' })),
    )
    const updateProvider = vi.fn(async (_req: Record<string, unknown>) => ({
      profile: scheduleProfile,
    }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible profileId="provider-schedule-e2e" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    return { updateProvider, saveButton }
  }

  it('定时禁用：日期多选后保存 payload 反映新增日期', async () => {
    const { updateProvider, saveButton } = await renderSchedulePanel()

    const wed = Array.from(container.querySelectorAll('.pv_ms_day')).find(
      (button) => button.textContent === '三',
    )
    expect(wed).toBeDefined()
    await act(async () => {
      wed?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0].modelSchedules).toEqual([
      { modelId: 'gpt-5-mini', enabled: true, days: [1, 3], startMinute: 600, endMinute: 720 },
    ])
  })

  it('定时禁用：删除时段行后保存 payload 为空数组（清除全部）', async () => {
    const { updateProvider, saveButton } = await renderSchedulePanel()

    const remove = container.querySelector('.pv_ms_remove')
    expect(remove).not.toBeNull()
    await act(async () => {
      remove?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelectorAll('.pv_ms_row')).toHaveLength(0)

    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(updateProvider).toHaveBeenCalledTimes(1)
    expect(updateProvider.mock.calls[0]?.[0].modelSchedules).toEqual([])
  })

  it('定时禁用：新建 Provider 时时段随 create payload 落库', async () => {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [] })),
    )
    const createProvider = vi.fn(async (_request: ProviderCreateRequest) => ({ profile: null }))
    mocks.invokers.set('provider:create', createProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          initialPresetId="anthropic-official"
          onClose={() => undefined}
        />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement | null
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-new-key',
      )
      apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '添加时段',
    )
    expect(addButton).toBeDefined()
    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelectorAll('.pv_ms_row')).toHaveLength(1)

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(createProvider).toHaveBeenCalledTimes(1)
    expect(createProvider.mock.calls[0]?.[0].modelSchedules).toEqual([
      {
        modelId: 'claude-sonnet-4-20250514',
        enabled: true,
        days: [1, 2, 3, 4, 5],
        startMinute: 840,
        endMinute: 1080,
      },
    ])
  })
})

describe('resolveProviderCardKind', () => {
  // resolveProviderCardKind 只读取 id 与 modelType，构造最小 profile 即可
  const profile = (id: string, modelType?: string) =>
    ({ id, modelType }) as unknown as Parameters<typeof resolveProviderCardKind>[0]

  it('旧 auto-router 魔法 id 已无 router 分类，回落普通文本卡（旧伪 provider 下线）', () => {
    expect(resolveProviderCardKind(profile('claude-auto-router', 'image'))).toBe('image')
    expect(resolveProviderCardKind(profile('codex-auto-router'))).toBe('text')
  })

  it('providerType=auto-router → auto-router 分类（新版落库 router 行）', () => {
    const routerRow = {
      id: 'r1',
      providerType: 'auto-router',
      provider: 'auto-router',
    } as unknown as Parameters<typeof resolveProviderCardKind>[0]
    expect(resolveProviderCardKind(routerRow)).toBe('auto-router')
  })

  it('local-cli / local-codex-cli → cli（最高优先级，忽略 modelType）', () => {
    expect(resolveProviderCardKind(profile('local-cli', 'video'))).toBe('cli')
    expect(resolveProviderCardKind(profile('local-codex-cli'))).toBe('cli')
  })

  it('modelType=image → image', () => {
    expect(resolveProviderCardKind(profile('openai-image', 'image'))).toBe('image')
  })

  it('modelType=video → video', () => {
    expect(resolveProviderCardKind(profile('kling', 'video'))).toBe('video')
  })

  it('modelType=voice → voice', () => {
    expect(resolveProviderCardKind(profile('tts', 'voice'))).toBe('voice')
  })

  it('modelType=multimodal → text（对话模型归一为文本）', () => {
    expect(resolveProviderCardKind(profile('gpt-4o', 'multimodal'))).toBe('text')
  })

  it('modelType=text（历史遗留）→ text（normalizeLegacyModelType 归一为 multimodal 后回落 text）', () => {
    expect(resolveProviderCardKind(profile('legacy', 'text'))).toBe('text')
  })

  it('modelType 缺省 → text（默认）', () => {
    expect(resolveProviderCardKind(profile('custom'))).toBe('text')
  })

  it('判定优先级：cli 优先于 modelType 媒体维度', () => {
    expect(resolveProviderCardKind(profile('local-cli', 'image'))).toBe('cli')
  })
})

describe('canHealthCheckProviderCardKind', () => {
  it('图片和视频模型卡不提供健康检查', () => {
    expect(canHealthCheckProviderCardKind('image')).toBe(false)
    expect(canHealthCheckProviderCardKind('video')).toBe(false)
  })

  it('对话和语音模型卡仍保留健康检查', () => {
    expect(canHealthCheckProviderCardKind('text')).toBe(true)
    expect(canHealthCheckProviderCardKind('voice')).toBe(true)
  })
})

describe('sortProviderProfilesForCards', () => {
  const profile = (id: string, name: string, managed = false) =>
    ({ id, name, managed }) as unknown as Parameters<typeof sortProviderProfilesForCards>[0][number]

  it('keeps the Spark managed card first in default and name sorting', () => {
    const custom = profile('custom', 'A Provider')
    const official = profile('spark-platform-newapi', 'Spark 平台模型', true)
    const localCli = profile('local-cli', '本地 Claude CLI')

    expect(sortProviderProfilesForCards([custom, official, localCli], 'default')).toEqual([
      official,
      custom,
      localCli,
    ])
    expect(sortProviderProfilesForCards([custom, official, localCli], 'nameAsc')).toEqual([
      official,
      localCli,
      custom,
    ])
  })
})

describe('getMediaRequestPreviewUrl', () => {
  // 百炼 baseUrl 形如 https://dashscope.aliyuncs.com/api/v1/services/aigc；
  // 适配器（bailian-media.adapter.ts）在此 base 上拼接能力后缀。
  const BASE = 'https://dashscope.aliyuncs.com/api/v1/services/aigc'
  type MediaProvider = Parameters<typeof getMediaRequestPreviewUrl>[2]
  const preview = (modelType: 'image' | 'video', mediaProvider: MediaProvider) =>
    getMediaRequestPreviewUrl(
      BASE,
      { modelType, defaultModel: '', mediaCapabilities: [] },
      mediaProvider,
    )

  it('百炼图片预览走 DashScope 原生 multimodal-generation/generation（qwen / wan 共用）', () => {
    expect(preview('image', 'bailian')).toBe(`${BASE}/multimodal-generation/generation`)
  })

  it('百炼视频预览走 video-generation/video-synthesis', () => {
    expect(preview('video', 'bailian')).toBe(`${BASE}/video-generation/video-synthesis`)
  })

  it('MiniMax 按模型预览真实的视频 endpoint，并兼容 BaseURL 已带版本后缀', () => {
    expect(
      getMediaRequestPreviewUrl(
        'http://127.0.0.1:13005',
        { modelType: 'video', defaultModel: 'MiniMax-H3', mediaCapabilities: ['video.generate'] },
        'minimax-hailuo',
      ),
    ).toBe('http://127.0.0.1:13005/v2/video_generation')
    expect(
      getMediaRequestPreviewUrl(
        'http://127.0.0.1:13005/v2',
        { modelType: 'video', defaultModel: 'MiniMax-H3', mediaCapabilities: ['video.generate'] },
        'minimax-hailuo',
      ),
    ).toBe('http://127.0.0.1:13005/v2/video_generation')
    expect(
      getMediaRequestPreviewUrl(
        'http://127.0.0.1:13005',
        {
          modelType: 'video',
          defaultModel: 'MiniMax-Hailuo-2.3',
          mediaCapabilities: ['video.generate'],
        },
        'minimax-hailuo',
      ),
    ).toBe('http://127.0.0.1:13005/v1/video_generation')
    expect(
      getMediaRequestPreviewUrl(
        'http://127.0.0.1:13005',
        { modelType: 'video', defaultModel: 'video-agent', mediaCapabilities: ['video.generate'] },
        'minimax-hailuo',
      ),
    ).toBe('http://127.0.0.1:13005/v1/video_template_generation')
  })

  it('MiniMax 图片预览走 /v1/image_generation', () => {
    expect(
      getMediaRequestPreviewUrl(
        'http://127.0.0.1:13005',
        { modelType: 'image', defaultModel: 'image-01', mediaCapabilities: ['image.generate'] },
        'minimax-hailuo',
      ),
    ).toBe('http://127.0.0.1:13005/v1/image_generation')
  })

  it('回归：apimart 图片仍走 OpenAI 兼容 /images/generations', () => {
    expect(preview('image', 'apimart')).toBe(`${BASE}/images/generations`)
  })

  it('回归：xai 视频仍走 /videos/generations', () => {
    expect(preview('video', 'xai')).toBe(`${BASE}/videos/generations`)
  })

  it('回归：google 图片仍走 /interactions', () => {
    expect(preview('image', 'google-generative-ai')).toBe(`${BASE}/interactions`)
  })

  it('回归：volcengine-ark 视频仍走 /contents/generations/tasks', () => {
    expect(preview('video', 'volcengine-ark')).toBe(`${BASE}/contents/generations/tasks`)
  })

  it('回归：agnes 视频仍走 /videos', () => {
    expect(preview('video', 'agnes')).toBe(`${BASE}/videos`)
  })

  it('回归：midjourney 图片仍走 /imagine', () => {
    expect(preview('image', 'midjourney')).toBe(`${BASE}/imagine`)
  })
})

describe('ProviderEditPanel spark executor switch', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    mocks.invokers.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  const renderEditPanel = async (profile: Record<string, unknown>) => {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-test' })),
    )
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible profileId={String(profile.id)} onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    return { updateProvider, saveButton }
  }

  const findSparkSwitch = () => {
    const switches = Array.from(container.querySelectorAll('button[role="switch"]'))
    // 执行引擎开关是表单中唯一「执行引擎」标签后的 Switch；按相邻标签文本定位
    const labels = Array.from(container.querySelectorAll('label.pv_form_label'))
    const executorLabel = labels.find((label) => label.textContent?.includes('执行引擎'))
    if (executorLabel == null) return null
    return (
      switches.find((button) => button.closest('div')?.previousElementSibling === executorLabel) ??
      null
    )
  }

  it('disables the switch with a reason for chat-only openai providers', async () => {
    const { updateProvider, saveButton } = await renderEditPanel({
      id: 'provider-spark-chat',
      name: 'Chat Only Provider',
      provider: 'openai',
      defaultModel: 'gpt-5',
      modelIds: ['gpt-5'],
      codexApiKind: 'chat',
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: '',
      createdAt: '',
    })

    const sparkSwitch = findSparkSwitch()
    expect(sparkSwitch).not.toBeNull()
    expect(sparkSwitch?.hasAttribute('disabled')).toBe(true)
    expect(container.textContent).toContain(
      'Chat Completions 不支持 Spark 执行器，请切换至 Responses API',
    )
    const hint = container.querySelector('.pv_spark_executor_hint')
    expect(hint?.parentElement?.classList.contains('pv_spark_executor_control')).toBe(true)
    expect(hint?.parentElement?.nextElementSibling?.textContent?.includes('API Key')).toBe(true)

    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    // 置灰态保存时强制下发 false，保持落库数据一致
    expect(updateProvider).toHaveBeenCalled()
    expect(updateProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ useSparkExecutor: false }),
    )
  })

  it('saves useSparkExecutor=true after enabling on an anthropic provider', async () => {
    const profile = {
      id: 'provider-spark-anthropic',
      name: 'Anthropic Provider',
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-5',
      modelIds: ['claude-sonnet-5'],
      supportsMillionContext: false,
      isDefault: false,
      enabled: true,
      keystoreRef: '',
      createdAt: '',
    }
    const { updateProvider, saveButton } = await renderEditPanel(profile)

    const sparkSwitch = findSparkSwitch()
    expect(sparkSwitch).not.toBeNull()
    expect(sparkSwitch?.hasAttribute('disabled')).toBe(false)
    expect(sparkSwitch?.getAttribute('aria-checked')).toBe('false')

    await act(async () => {
      sparkSwitch?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(sparkSwitch?.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(updateProvider).toHaveBeenCalled()
    expect(updateProvider.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ useSparkExecutor: true }),
    )
  })
})

describe('ProvidersView 卡片筛选缓存', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  /** 仅覆盖卡片渲染 + 筛选所需字段：默认模型 / 模型列表 / 媒体字段缺一不可（渲染期会直接取用）。 */
  const cardProfiles = [
    {
      id: 'provider-alpha',
      name: 'Alpha Chat',
      provider: 'openai',
      defaultModel: 'gpt-5',
      modelIds: [],
      mediaModelRefs: [],
      modelType: 'multimodal',
      enabled: true,
    },
    {
      id: 'provider-beta',
      name: 'Beta Image',
      provider: 'openai',
      defaultModel: 'gpt-image-1',
      modelIds: [],
      mediaModelRefs: [],
      modelType: 'image',
      enabled: true,
    },
  ]

  beforeEach(() => {
    mocks.invokers.clear()
    window.localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: cardProfiles })),
    )
    mocks.invokers.set(
      'model:list',
      vi.fn(async () => ({ models: [] })),
    )
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
    window.localStorage.clear()
  })

  /**
   * 挂载视图并拉一次列表。
   * 初始加载由 usePlatformModelCatalogRefresh 触发，而它在测试里被 mock 成空实现，
   * 所以这里显式点击「刷新」按钮把 provider:list 结果灌进视图。
   */
  const mountView = async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<ProvidersView />)
    })
    const refreshButton = container.querySelector('button[aria-label="刷新"]')
    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }

  const unmountView = async () => {
    if (root) await act(async () => root?.unmount())
    root = null
  }

  const findSelectByOptionLabel = (label: string): HTMLSelectElement | null =>
    Array.from(container.querySelectorAll('select')).find((select) =>
      Array.from(select.options).some((option) => option.textContent?.trim() === label),
    ) ?? null

  const setNativeValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    setter?.call(element, value)
  }

  it('搜索 / 筛选 / 排序选择会被缓存，重新进入页面时恢复', async () => {
    await mountView()

    expect(container.querySelectorAll('.pv_card')).toHaveLength(2)
    const enabledSelect = findSelectByOptionLabel('已启用')
    const sortSelect = findSelectByOptionLabel('名称 A→Z')
    expect(container.querySelector('.pv_filters_search')).not.toBeNull()
    expect(enabledSelect).not.toBeNull()
    expect(sortSelect).not.toBeNull()

    await act(async () => {
      const searchInput = container.querySelector<HTMLInputElement>('.pv_filters_search')
      if (searchInput) {
        setNativeValue(searchInput, 'alpha')
        searchInput.dispatchEvent(new Event('input', { bubbles: true }))
      }
      if (enabledSelect) {
        setNativeValue(enabledSelect, 'disabled')
        enabledSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
      if (sortSelect) {
        setNativeValue(sortSelect, 'nameAsc')
        sortSelect.dispatchEvent(new Event('change', { bubbles: true }))
      }
    })

    expect(container.querySelector<HTMLInputElement>('.pv_filters_search')?.value).toBe('alpha')
    // 两张卡都是启用状态，「已禁用」筛选命中 0 张
    expect(container.querySelectorAll('.pv_card')).toHaveLength(0)
    expect(
      JSON.parse(window.localStorage.getItem('spark-agent:provider-card-filters') ?? '{}'),
    ).toEqual({ search: 'alpha', kind: 'all', enabled: 'disabled', sortBy: 'nameAsc' })

    // 模拟切换导航后回到 Providers 页面：组件卸载后重新挂载
    await unmountView()
    await mountView()

    expect(container.querySelector<HTMLInputElement>('.pv_filters_search')?.value).toBe('alpha')
    expect(findSelectByOptionLabel('已启用')?.value).toBe('disabled')
    expect(findSelectByOptionLabel('名称 A→Z')?.value).toBe('nameAsc')
    expect(container.querySelectorAll('.pv_card')).toHaveLength(0)
  })

  it('清空筛选关键字后缓存同步回落默认值', async () => {
    await mountView()

    const typeIntoSearch = async (value: string) => {
      await act(async () => {
        const searchInput = container.querySelector<HTMLInputElement>('.pv_filters_search')
        if (searchInput) {
          setNativeValue(searchInput, value)
          searchInput.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })
    }

    await typeIntoSearch('alpha')
    expect(container.querySelectorAll('.pv_card')).toHaveLength(1)

    await typeIntoSearch('')
    expect(container.querySelectorAll('.pv_card')).toHaveLength(2)
    expect(
      JSON.parse(window.localStorage.getItem('spark-agent:provider-card-filters') ?? '{}'),
    ).toEqual({ search: '', kind: 'all', enabled: 'all', sortBy: 'default' })
  })
})

describe('ProviderEditPanel 渠道动态音色候选', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  /**
   * 智谱 GLM-TTS 摘要：目录版只有静态系统音色；profile 版带「同步 / 复刻」写入的候选
   * 与可读名（主进程 mergeDynamicParamOptions 的产物）。
   */
  const glmTtsSummary = (voiceExamples: string[]) => ({
    manifestId: 'zhipu:glm-tts',
    providerKind: 'zhipu',
    modelId: 'glm-tts',
    effectiveModelId: 'glm-tts',
    displayName: 'GLM-TTS',
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: {},
        output: {},
        defaults: { voice: 'tongtong' },
        paramSchema: {
          type: 'object',
          properties: {
            voice: {
              type: 'string',
              default: 'tongtong',
              examples: voiceExamples,
              'x-allow-custom': true,
              ...(voiceExamples.includes('my_cloned_voice')
                ? { 'x-template-labels': { my_cloned_voice: '我的复刻音色' } }
                : {}),
            },
          },
        },
      },
    ],
    sourceUrls: [],
    enabled: true,
  })

  const voiceProfile = {
    id: 'provider-zhipu-voice',
    name: '智谱语音',
    provider: 'openai',
    modelType: 'voice',
    defaultModel: 'glm-tts',
    modelIds: ['glm-tts'],
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    mediaProvider: 'zhipu',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaModelRefs: [{ manifestId: 'zhipu:glm-tts', modelId: 'glm-tts', enabled: true }],
    supportsMillionContext: false,
    isDefault: false,
    enabled: true,
    keystoreRef: 'zhipu-provider-voice',
    createdAt: '',
    updatedAt: '',
  }

  beforeEach(() => {
    mocks.invokers.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('把渠道同步 / 复刻的音色补进「参数默认值 → 音色」候选', async () => {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [voiceProfile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-zhipu' })),
    )
    const listMediaModels = vi.fn(async (req: { catalogOnly?: boolean }) =>
      req.catalogOnly === true
        ? { models: [glmTtsSummary(['tongtong', 'chuichui'])] }
        : { models: [glmTtsSummary(['tongtong', 'chuichui', 'my_cloned_voice'])] },
    )
    mocks.invokers.set('canvas:media-models:list', listMediaModels)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible profileId="provider-zhipu-voice" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    // 目录路径不带渠道上下文，动态候选只能来自按 profile 解析的那一次拉取。
    expect(listMediaModels).toHaveBeenCalledWith(
      expect.objectContaining({ providerProfileId: 'provider-zhipu-voice' }),
    )

    const clonedOption = container.querySelector('[data-option-value="my_cloned_voice"]')
    expect(clonedOption).not.toBeNull()
    expect(clonedOption?.textContent).toBe('我的复刻音色')
    // 静态系统音色仍在候选里，没有被动态列表整体替换。
    expect(container.querySelector('[data-option-value="tongtong"]')).not.toBeNull()
  })
})

describe('ProviderEditPanel 自定义语音模型', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const customVoiceProfile = {
    id: 'provider-custom-voice',
    name: '自建语音',
    provider: 'openai',
    modelType: 'voice',
    defaultModel: '',
    modelIds: [],
    apiEndpoint: 'http://127.0.0.1:8000/v1',
    mediaProvider: 'custom',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaModelRefs: [],
    supportsMillionContext: false,
    isDefault: false,
    enabled: true,
    keystoreRef: 'custom-provider-voice',
    createdAt: '',
    updatedAt: '',
  }

  async function renderPanel(profileId: string, profile: Record<string, unknown>) {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-voice-key' })),
    )
    // 保存用的 spy 必须在 render 之前注册：组件在每次 render 时取当前 invoke，
    // 渲染后再替换会让点击「保存」沿用旧的桩函数（调用不会被记录）。
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)
    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible profileId={profileId} onClose={() => undefined} />)
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    return { updateProvider }
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  beforeEach(() => {
    mocks.invokers.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('offers the manual custom model input for voice channels', async () => {
    const { updateProvider } = await renderPanel('provider-custom-voice', customVoiceProfile)

    // 回归：语音渠道此前不渲染该区块，用户无处填写自定义模型名。
    expect(container.textContent).toContain('自定义模型 / 适配器')

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="输入模型 ID 后按 Enter 添加"]',
    )
    expect(input).not.toBeNull()
    act(() => {
      setInputValue(input!, 'my-tts-v1')
    })
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '添加',
    )
    expect(addButton).toBeDefined()

    await act(async () => {
      addButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const request = updateProvider.mock.calls[0]?.[0] as
      | { mediaModelRefs?: Array<Record<string, unknown>> }
      | undefined
    const refs = request?.mediaModelRefs ?? []
    expect(refs).toHaveLength(1)
    expect(refs[0]?.['modelId']).toBe('my-tts-v1')
    const manifest = refs[0]?.['manifest'] as { capabilities?: Array<{ id: string }> } | undefined
    expect(manifest?.capabilities?.map((capability) => capability.id)).toEqual(['audio.speech'])
  })

  it('MiniMax 语音渠道可同步音色目录（复刻入口仍仅智谱）', async () => {
    const profile = {
      ...customVoiceProfile,
      id: 'provider-minimax-voice',
      name: 'MiniMax 语音',
      mediaProvider: 'minimax-hailuo',
      mediaModelRefs: [
        { manifestId: 'minimax:speech-2.8-hd', modelId: 'speech-2.8-hd', enabled: true },
      ],
      defaultModel: 'speech-2.8-hd',
      modelIds: ['speech-2.8-hd'],
      keystoreRef: 'minimax-provider-voice',
    }
    await renderPanel('provider-minimax-voice', profile)

    expect(container.textContent).toContain('音色目录')
    expect(container.textContent).toContain('同步音色')
    expect(container.textContent).not.toContain('音色复刻')
  })

  it('adds a ref for a hand-typed default model instead of silently rewriting it', async () => {
    const profile = { ...customVoiceProfile, defaultModel: 'my-tts-v2', modelIds: ['my-tts-v2'] }
    const { updateProvider } = await renderPanel('provider-custom-voice', profile)

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const request = updateProvider.mock.calls[0]?.[0] as
      | { defaultModel?: string; mediaModelRefs?: Array<Record<string, unknown>> }
      | undefined
    // 手填的默认模型必须原样保留，并被补进模型清单（否则主进程解析不到、快速创作选不到）。
    expect(request?.defaultModel).toBe('my-tts-v2')
    const refs = request?.mediaModelRefs ?? []
    expect(refs).toHaveLength(1)
    expect(refs[0]?.['modelId']).toBe('my-tts-v2')
    expect(refs[0]?.['manifest']).toBeDefined()
  })
})

/**
 * 智谱音色复刻弹窗的回归用例。
 *
 * 独立成块、自带夹具：这块最初是追加在上方「自定义语音模型」describe 里的，
 * 但两者归属与夹具来源不同（那份是渠道泛化的改造），耦合会让两边都难以单独演进。
 *
 * 覆盖四条踩过的坑：打开弹窗不预取导致列表永远为空、删除厂商侧音色无二次确认、
 * 换渠道后残留上一家的私有音色、以及输入超协议上限时直出 zod 英文报错。
 */
describe('ProviderEditPanel 音色复刻闭环', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  const ZHIPU_VOICE_PROFILE_ID = 'provider-zhipu-voice'
  const zhipuVoiceProfile = {
    id: ZHIPU_VOICE_PROFILE_ID,
    name: '智谱语音',
    provider: 'openai',
    modelType: 'voice',
    defaultModel: 'glm-tts',
    modelIds: ['glm-tts', 'glm-asr-2512'],
    apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    mediaProvider: 'zhipu',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech', 'audio.transcription'],
    mediaModelRefs: [
      { manifestId: 'zhipu:glm-tts', modelId: 'glm-tts', enabled: true },
      { manifestId: 'zhipu:glm-asr-2512', modelId: 'glm-asr-2512', enabled: true },
    ],
    supportsMillionContext: false,
    isDefault: false,
    enabled: true,
    keystoreRef: 'zhipu-provider-voice',
  }

  async function renderPanel(profileId: string, profile: Record<string, unknown>) {
    mocks.invokers.set(
      'provider:list',
      vi.fn(async () => ({ profiles: [profile] })),
    )
    mocks.invokers.set(
      'provider:get-api-key',
      vi.fn(async () => ({ apiKey: 'sk-voice-key' })),
    )
    mocks.invokers.set(
      'provider:update',
      vi.fn(async () => ({ profile })),
    )
    await act(async () => {
      root = createRoot(container)
      root.render(<ProviderEditPanel visible profileId={profileId} onClose={() => undefined} />)
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
  }

  /** 打开音色复刻弹窗：点击入口，并让预取请求落地。 */
  async function openClonePanel() {
    const openButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '复刻音色',
    )
    if (!openButton) throw new Error('未找到「复刻音色」入口')
    await act(async () => {
      openButton.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
  }

  function syncVoicesResponse(privateVoices: Array<{ value: string; label?: string }>) {
    return {
      providerId: ZHIPU_VOICE_PROFILE_ID,
      options: privateVoices,
      privateVoices,
      officialCount: 7,
      privateCount: privateVoices.length,
      manifestId: 'zhipu:glm-tts',
      paramName: 'voice',
    }
  }

  beforeEach(() => {
    mocks.invokers.clear()
    mocks.requestConfirm.mockReset()
    mocks.requestConfirm.mockImplementation(async () => false)
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('打开复刻弹窗即预取已复刻音色并列出，无需先点同步', async () => {
    const syncVoices = vi.fn(async () =>
      syncVoicesResponse([{ value: 'voice_clone_001', label: '我的音色' }]),
    )
    mocks.invokers.set('provider:media:sync-voices', syncVoices)
    await renderPanel(ZHIPU_VOICE_PROFILE_ID, zhipuVoiceProfile)
    await openClonePanel()

    // 入口承诺「可管理已复刻音色」，因此打开就得有内容，不能等用户先点同步。
    expect(syncVoices).toHaveBeenCalledWith({ providerId: ZHIPU_VOICE_PROFILE_ID })
    expect(container.textContent).toContain('已复刻音色')
    expect(container.textContent).toContain('我的音色')
  })

  it('没有复刻音色时给出空态文案而不是整块消失', async () => {
    mocks.invokers.set(
      'provider:media:sync-voices',
      vi.fn(async () => syncVoicesResponse([])),
    )
    await renderPanel(ZHIPU_VOICE_PROFILE_ID, zhipuVoiceProfile)
    await openClonePanel()

    expect(container.textContent).toContain('已复刻音色')
    expect(container.textContent).toContain('暂无复刻音色')
  })

  it('删除复刻音色需二次确认：取消则不调用删除通道', async () => {
    mocks.invokers.set(
      'provider:media:sync-voices',
      vi.fn(async () => syncVoicesResponse([{ value: 'voice_clone_001', label: '我的音色' }])),
    )
    const deleteVoice = vi.fn(async () => syncVoicesResponse([]))
    mocks.invokers.set('provider:media:delete-voice', deleteVoice)
    // 取消：requestConfirm 默认解析为 false（见 beforeEach）
    await renderPanel(ZHIPU_VOICE_PROFILE_ID, zhipuVoiceProfile)
    await openClonePanel()

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="删除音色"]',
    )
    expect(deleteButton).not.toBeNull()
    await act(async () => {
      deleteButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(mocks.requestConfirm).toHaveBeenCalled()
    expect(deleteVoice).not.toHaveBeenCalled()
    expect(container.textContent).toContain('我的音色')
  })

  it('确认后删除并采纳返回的候选快照', async () => {
    mocks.invokers.set(
      'provider:media:sync-voices',
      vi.fn(async () => syncVoicesResponse([{ value: 'voice_clone_001', label: '我的音色' }])),
    )
    const deleteVoice = vi.fn(async () => syncVoicesResponse([]))
    mocks.invokers.set('provider:media:delete-voice', deleteVoice)
    mocks.requestConfirm.mockResolvedValueOnce(true)
    await renderPanel(ZHIPU_VOICE_PROFILE_ID, zhipuVoiceProfile)
    await openClonePanel()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label^="删除音色"]')?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(deleteVoice).toHaveBeenCalledWith({
      providerId: ZHIPU_VOICE_PROFILE_ID,
      voice: 'voice_clone_001',
    })
    expect(container.textContent).toContain('暂无复刻音色')
  })

  it('未选文件或未填名称时「开始复刻」保持禁用，输入框带协议上限', async () => {
    mocks.invokers.set(
      'provider:media:sync-voices',
      vi.fn(async () => syncVoicesResponse([])),
    )
    await renderPanel(ZHIPU_VOICE_PROFILE_ID, zhipuVoiceProfile)
    await openClonePanel()

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '开始复刻',
    )
    expect(submit?.disabled).toBe(true)

    // maxLength 与协议上限对齐（provider-media-voices.ts: 120 / 2000 / 400），
    // 否则超限会走 zod 分支、用户看到英文内部报错。
    const limits = Array.from(container.querySelectorAll('input'))
      .map((input) => input.maxLength)
      .filter((value) => Number.isFinite(value) && value > 0)
    expect(limits).toEqual(expect.arrayContaining([120, 2000, 400]))
  })
})

// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  Switch: () => <button type="button" role="switch" />,
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

vi.mock('../components/ChipList', () => ({
  ChipList: () => <div data-testid="chip-list" />,
}))

vi.mock('../components/Toast', () => ({
  useToast: () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }),
}))

vi.mock('../AppContext', () => ({
  useApp: () => ({
    requestConfirm: vi.fn(),
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
    const listModels = vi.fn(async () => ({ models: [] }))
    mocks.invokers.set('provider:list', listProviders)
    mocks.invokers.set('model:list', listModels)

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
    expect(listModels).toHaveBeenCalledWith({})
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

    expect(container.textContent).toContain('高级设置')
    expect(container.textContent).toContain('模板已自动配置')
    expect(container.textContent).not.toContain('平台适配器')
    expect(container.textContent).not.toContain('生图接口来源')

    const toggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('高级设置'),
    )
    expect(toggle).toBeDefined()

    act(() => toggle?.click())

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

    const advancedToggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('高级设置'),
    )
    act(() => advancedToggle?.click())

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

    const advancedToggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('高级设置'),
    )
    act(() => advancedToggle?.click())

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
    mocks.invokers.set('provider:get-api-key', vi.fn(async () => ({ apiKey: 'sk-saved' })))
    const updateProvider = vi.fn(async (_req: Record<string, unknown>) => ({
      profile: scheduleProfile,
    }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          profileId="provider-schedule-e2e"
          onClose={() => undefined}
        />,
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
    mocks.invokers.set('provider:list', vi.fn(async () => ({ profiles: [] })))
    const createProvider = vi.fn(async () => ({ profile: null }))
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

  it('claude-auto-router → router（最高优先级，忽略 modelType）', () => {
    expect(resolveProviderCardKind(profile('claude-auto-router', 'image'))).toBe('router')
  })

  it('codex-auto-router → router', () => {
    expect(resolveProviderCardKind(profile('codex-auto-router'))).toBe('router')
  })

  it('local-cli / local-codex-cli → cli（仅次于 router，忽略 modelType）', () => {
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

  it('判定优先级：router 高于 cli（虽不会同时为真，但确保顺序稳定）', () => {
    // auto-router 的 id 永远不等于 local-cli，这里只是回归保护
    expect(resolveProviderCardKind(profile('claude-auto-router'))).toBe('router')
    expect(resolveProviderCardKind(profile('local-cli'))).toBe('cli')
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

  it('自动路由卡仍不提供健康检查', () => {
    expect(canHealthCheckProviderCardKind('router')).toBe(false)
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

// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ProviderEditPanel,
  resolveCodexApiKind,
  resolveProviderCardKind,
  sortProviderProfilesForCards,
} from './ProvidersView'
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
  const Drawer = ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  )
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
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
  ProviderLogo: ({ icon, vendor }: { icon?: { id: string; style?: string } | null; vendor?: { id?: string } | null }) => (
    <span data-testid="provider-logo">{icon ? `${icon.id}:${icon.style ?? 'avatar'}` : vendor?.id}</span>
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
    mocks.invokers.set('provider:list', vi.fn(async () => ({ profiles: [profile] })))
    const getApiKey = vi.fn(async () => ({ apiKey: 'sk-saved-plaintext' }))
    mocks.invokers.set('provider:get-api-key', getApiKey)
    const updateProvider = vi.fn(async (_request: Record<string, unknown>) => ({ profile }))
    mocks.invokers.set('provider:update', updateProvider)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel
          visible
          profileId="provider-key-echo"
          onClose={() => undefined}
        />,
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
    expect(updateProvider.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      apiKey: 'sk-user-updated',
    }))
  })

  it('saves a manually selected provider icon and keeps it while other fields change', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="anthropic-official" onClose={() => undefined} />,
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      providerIcon: { id: 'deepseek', style: 'mono' },
    }))
  })

  it('replaces a manually selected icon when the provider template changes', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="anthropic-official" onClose={() => undefined} />,
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
    const openAiButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.trim() === 'OpenAI',
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

  it('keeps template-derived media controls collapsed until requested', async () => {
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

    expect(container.textContent).toContain('平台适配器')
    expect(container.textContent).toContain('生图接口来源')
  })

  it('maps Volcengine Seedream template to Seedream image source before advanced settings are opened', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="volcengine-seedream-image" onClose={() => undefined} />,
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      modelType: 'image',
      imageProvider: 'seeddance',
      imageApiType: 'sync',
      mediaProvider: 'volcengine-ark',
      mediaApiType: 'sync',
    }))
  })

  it('creates an editable manifest when a custom image model is added', async () => {
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

    const adapterSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="volcengine-ark"]'),
    )
    expect(adapterSelect).toBeDefined()
    act(() => {
      if (!adapterSelect) return
      adapterSelect.value = 'custom'
      adapterSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const modelInput = container.querySelector(
      'input[placeholder*="nano-banana"]',
    ) as HTMLInputElement | null
    expect(modelInput).not.toBeNull()
    act(() => {
      if (!modelInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        modelInput,
        'studio-image-v1',
      )
      modelInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const addButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '添加',
    )
    act(() => addButton?.click())

    expect(container.textContent).toContain('协议已配置')
    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('编辑协议'),
    )
    act(() => editButton?.click())

    const editor = container.querySelector(
      'textarea[aria-label="自定义模型 Manifest JSON"]',
    ) as HTMLTextAreaElement | null
    expect(editor?.value).toContain('"endpoint": "/images/generations"')
    expect(editor?.value).toContain('"image.generate"')

    const saveManifestButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('检查并保存'),
    )
    act(() => saveManifestButton?.click())

    const apiKeyInput = container.querySelector(
      'input[placeholder="媒体平台 API Key"]',
    ) as HTMLInputElement | null
    expect(apiKeyInput).not.toBeNull()
    act(() => {
      if (!apiKeyInput) return
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        apiKeyInput,
        'sk-studio',
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      mediaModelRefs: expect.arrayContaining([
        expect.objectContaining({
          manifest: expect.objectContaining({
            id: 'custom:studio-image-v1',
            invocation: expect.objectContaining({ endpoint: '/images/generations' }),
          }),
        }),
      ]),
    }))
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

    const apiKeyInput = container.querySelector(
      'input[type="password"]',
    ) as HTMLInputElement | null
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
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
    }))
  })

  it('defaults Coding Plan OpenAI presets to Responses', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="zhipu-glm-coding-plan-openai" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const apiKindSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="responses"]') != null
        && select.querySelector('option[value="chat"]') != null,
    ) as HTMLSelectElement | undefined

    expect(apiKindSelect).toBeDefined()
    expect(apiKindSelect?.value).toBe('responses')
  })

  it('keeps unknown OpenAI-compatible endpoints on Chat Completions by default', () => {
    expect(resolveCodexApiKind('openai', 'https://api.compat.example/v1')).toBe('chat')
    expect(resolveCodexApiKind('openai', 'https://open.bigmodel.cn/api/coding/paas/v4')).toBe('responses')
  })

  it('switches preset endpoint when protocol format changes', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="volcengine-ark-anthropic" onClose={() => undefined} />,
      )
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const providerSelect = Array.from(container.querySelectorAll('select')).find((select) =>
      select.querySelector('option[value="anthropic"]') != null
        && select.querySelector('option[value="openai"]') != null,
    ) as HTMLSelectElement | undefined
    const endpointInputBefore = Array.from(container.querySelectorAll('input')).find((input) =>
      input.value === 'https://ark.cn-beijing.volces.com/api/coding',
    ) as HTMLInputElement | undefined

    expect(providerSelect).toBeDefined()
    expect(endpointInputBefore).toBeDefined()

    await act(async () => {
      if (!providerSelect) return
      providerSelect.value = 'openai'
      providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const endpointInputAfter = Array.from(container.querySelectorAll('input')).find((input) =>
      input.value === 'https://ark.cn-beijing.volces.com/api/coding/v3',
    ) as HTMLInputElement | undefined
    expect(endpointInputAfter).toBeDefined()
  })

  it('does not make every fetched model globally available by default', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [
        { id: 'model-a' },
        { id: 'model-b' },
        { id: 'model-c' },
      ],
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: 'model-a',
      modelIds: ['model-a'],
    }))
  })

  it('auto fetches Volcengine OpenAI models after API key entry and selects the first model', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [
        { id: 'auto-first' },
        { id: 'auto-second' },
      ],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="volcengine-ark-openai" onClose={() => undefined} />,
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

    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      apiKey: 'sk-volcengine-auto',
    }))

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      codexApiKind: 'responses',
      defaultModel: 'auto-first',
      modelIds: ['auto-first'],
    }))
  })

  it('auto fetches any chat provider models once API key is ready', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [
        { id: 'claude-auto-first' },
        { id: 'claude-auto-second' },
      ],
    }))
    mocks.invokers.set('provider:fetch-models', fetchModels)

    await act(async () => {
      root = createRoot(container)
      root.render(
        <ProviderEditPanel visible initialPresetId="anthropic-official" onClose={() => undefined} />,
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

    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      apiEndpoint: 'https://api.anthropic.com',
      apiKey: 'sk-ant-auto-fetch',
    }))

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.click()
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    const createProvider = mocks.invokers.get('provider:create')
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      defaultModel: 'claude-auto-first',
      modelIds: ['claude-auto-first'],
    }))
  })

  it('supports selecting a fetched default model and only saving explicitly enabled models', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [
        { id: 'model-a' },
        { id: 'model-b' },
        { id: 'model-c' },
      ],
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: 'model-b',
      modelIds: ['model-b', 'model-c'],
    }))
  })

  it('preserves the typed default model when models are fetched manually', async () => {
    const fetchModels = vi.fn(async () => ({
      models: [
        { id: 'model-a' },
        { id: 'model-b' },
      ],
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
    const nameInput = inputs.find((input) =>
      input.placeholder === '例：Anthropic · Claude',
    ) as HTMLInputElement | undefined
    const modelInput = inputs.find((input) =>
      input.placeholder.includes('claude-sonnet'),
    ) as HTMLInputElement | undefined
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
    expect(createProvider).toHaveBeenCalledWith(expect.objectContaining({
      defaultModel: 'model-b',
      modelIds: ['model-b'],
    }))
  })
})

describe('resolveProviderCardKind', () => {
  // resolveProviderCardKind 只读取 id 与 modelType，构造最小 profile 即可
  const profile = (id: string, modelType?: string) =>
    ({ id, modelType } as unknown as Parameters<typeof resolveProviderCardKind>[0])

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
    ({ id, name, managed } as unknown as Parameters<typeof sortProviderProfilesForCards>[0][number])

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

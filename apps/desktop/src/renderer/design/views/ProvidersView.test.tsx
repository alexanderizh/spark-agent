// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderEditPanel } from './ProvidersView'
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
  ProviderLogo: () => <span data-testid="provider-logo" />,
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
})

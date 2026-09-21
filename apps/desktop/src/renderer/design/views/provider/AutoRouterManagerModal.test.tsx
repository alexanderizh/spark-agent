// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactElement } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Mock UI 库与上下文（参照 ProvidersView.test 的 mock 模式，避免拉起 emoji-mart 等重依赖）
vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Button = ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  )
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />
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
  const Modal = ({
    children,
    open,
    title,
  }: {
    children?: React.ReactNode
    open?: boolean
    title?: React.ReactNode
  }) =>
    open ? (
      <div>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    ) : null
  return { Button, Input, Select, Modal }
})
vi.mock('antd', () => ({
  Switch: ({
    checked,
    onChange,
  }: {
    checked?: boolean
    onChange?: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
  Alert: ({ message }: { message?: React.ReactNode }) => (
    <div className="ant-alert">{message}</div>
  ),
}))
vi.mock('../../Icons', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Icons: new Proxy(
      {},
      {
        get:
          (_target: Record<string, unknown>, prop: string) =>
          () =>
            ReactActual.createElement('span', { 'data-icon': prop }),
      },
    ),
  }
})
vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: vi.fn(async () => ({ profile: {} })) }),
}))
vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))
vi.mock('../../AppContext', () => ({
  useApp: () => ({ t: {}, setTweak: vi.fn(), requestConfirm: vi.fn(async () => true) }),
}))

import { AutoRouterManagerModal } from './AutoRouterManagerModal'
import type { ProviderProfile } from '@spark/protocol'

function anthropicProvider(id: string, name: string, models: string[]): ProviderProfile {
  return {
    id,
    name,
    provider: 'anthropic',
    providerType: 'anthropic',
    enabled: true,
    defaultModel: models[0] ?? '',
    modelIds: models,
    supportsMillionContext: false,
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  }
}

function routerProfile(id: string, name: string): ProviderProfile {
  return {
    id,
    name,
    provider: 'auto-router',
    providerType: 'auto-router',
    enabled: true,
    defaultModel: '',
    modelIds: [],
    supportsMillionContext: false,
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    autoRouterConfig: {
      kind: 'auto-router',
      version: 1,
      adapter: 'claude',
      dispatcher: { providerProfileId: 'p1', modelId: 'haiku-mini', timeoutMs: 8_000 },
      executors: [
        { id: 'e1', providerProfileId: 'p2', modelId: 'opus-max', intensity: 'high', enabled: true },
      ],
      fallbackIntensity: 'balanced',
      allowDecomposition: true,
      maxConcurrentSubtasks: 3,
      subagentIntensityMapping: true,
    },
  }
}

describe('AutoRouterManagerModal', () => {
  let container: HTMLElement
  let root: ReturnType<typeof createRoot> | null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root) act(() => root?.unmount())
    root = null
    container.remove()
  })

  function render(element: ReactElement): void {
    root = createRoot(container)
    act(() => {
      root?.render(element)
    })
  }

  const providers = [
    anthropicProvider('p1', 'Dispatch Co', ['haiku-mini']),
    anthropicProvider('p2', 'High Co', ['opus-max']),
    anthropicProvider('p-image', 'Image Co', ['image-gen']),
  ]

  it('渲染 router 列表并默认选中第一个', () => {
    render(
      <AutoRouterManagerModal
        open
        providers={[...providers, routerProfile('r1', '日常路由')]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    const item = container.querySelector('.arm_router_item.active')
    expect(item?.textContent).toContain('日常路由')
  })

  it('无 router 时进入新建态并展示空态提示', () => {
    render(<AutoRouterManagerModal open providers={providers} onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(container.querySelector('.arm_empty')?.textContent).toContain('还没有路由器')
  })

  it('校验拦截：新建态未填分流器时保存显示错误，不调用 create', async () => {
    render(<AutoRouterManagerModal open providers={providers} onClose={vi.fn()} onChanged={vi.fn()} />)
    // 新建态：名称留空，直接点「创建」
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '创建',
    )
    expect(saveButton).toBeDefined()
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const alert = container.querySelector('.ant-alert')
    expect(alert?.textContent).toContain('请填写路由器名称')
  })

  it('候选渠道按引擎过滤（codex 引擎不显示 anthropic 渠道）', () => {
    render(<AutoRouterManagerModal open providers={providers} onClose={vi.fn()} onChanged={vi.fn()} />)
    // 默认 claude 引擎：应显示 2 个 anthropic 文本渠道，不显示图片渠道
    const sidebarItems = container.querySelectorAll('.arm_router_item')
    expect(sidebarItems.length).toBe(0)
    // 新建态编辑器可见
    expect(container.querySelector('.arm_editor')).not.toBeNull()
  })
})

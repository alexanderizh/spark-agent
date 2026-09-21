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
    footer,
  }: {
    children?: React.ReactNode
    open?: boolean
    title?: React.ReactNode
    footer?: React.ReactNode
  }) =>
    open ? (
      <div>
        <div className="modal-title">{title}</div>
        {children}
        {footer}
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
const { invokeCalls } = vi.hoisted(() => ({
  invokeCalls: [] as Array<{ channel: string; payload: unknown }>,
}))
vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke: vi.fn(async (payload: unknown) => {
      invokeCalls.push({ channel, payload })
      return { profile: {} }
    }),
  }),
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
    invokeCalls.length = 0
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

  it('执行器推理强度：默认「跟随会话」，修改后保存写入 config（新字段闭环）', async () => {
    render(
      <AutoRouterManagerModal
        open
        providers={[...providers, routerProfile('r1', '日常路由')]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    // fixture 的 e1 未配置 reasoningEffort → 推理强度下拉应为「跟随会话」（哨兵空串）
    const executorSelects = Array.from(
      container.querySelectorAll('.arm_executor_row select'),
    ) as HTMLSelectElement[]
    // 执行器行共 4 个下拉：渠道 / 模型 / 强度档位 / 推理强度
    expect(executorSelects.length).toBe(4)
    const effortSelect = executorSelects[3]!
    expect(effortSelect.value).toBe('')
    // 修改为 xhigh
    await act(async () => {
      effortSelect.value = 'xhigh'
      effortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(effortSelect.value).toBe('xhigh')
    // 保存 → update IPC 的 config 携带推理强度
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    expect(saveButton).toBeDefined()
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const call = invokeCalls.find((entry) => entry.channel === 'provider:auto-router:update')
    expect(call).toBeDefined()
    const config = (call!.payload as { config: { executors: Array<{ reasoningEffort?: string | null }> } })
      .config
    expect(config.executors[0]?.reasoningEffort).toBe('xhigh')
  })

  it('执行器推理强度改回「跟随会话」→ 保存落库为 null（不跟随旧值）', async () => {
    const fixture = routerProfile('r1', '日常路由')
    fixture.autoRouterConfig!.executors[0]!.reasoningEffort = 'max'
    render(
      <AutoRouterManagerModal
        open
        providers={[...providers, fixture]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    )
    const effortSelect = Array.from(
      container.querySelectorAll('.arm_executor_row select'),
    )[3] as HTMLSelectElement
    // 回显已配置的 max
    expect(effortSelect.value).toBe('max')
    await act(async () => {
      effortSelect.value = ''
      effortSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '保存',
    )
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const call = invokeCalls.find((entry) => entry.channel === 'provider:auto-router:update')
    const config = (call!.payload as { config: { executors: Array<{ reasoningEffort?: string | null }> } })
      .config
    expect(config.executors[0]?.reasoningEffort).toBeNull()
  })
})

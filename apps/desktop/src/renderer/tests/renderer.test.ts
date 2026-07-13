// @vitest-environment jsdom

/**
 * Renderer 测试 — 验证 React 组件渲染
 *
 * 使用 jsdom 环境模拟浏览器 DOM，
 * 验证核心组件能正确渲染和响应交互。
 */

import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToastProvider } from '../design/components/Toast'
import type { UIMessage } from '../design/services/event-mapper'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui/es/base-ui/Toast/imperative', () => {
  const makeToast = () => ({ id: 'toast-mock', close: vi.fn(), update: vi.fn() })
  return {
    ToastHost: () => null,
    toast: {
      dismiss: vi.fn(),
      error: vi.fn(makeToast),
      info: vi.fn(makeToast),
      success: vi.fn(makeToast),
      warning: vi.fn(makeToast),
    },
  }
})

const makeLobeIconMock = (name: string) => {
  const Icon = ({ size }: { size?: number }) =>
    React.createElement('span', {
      'data-lobe-icon': name,
      style: { width: size, height: size },
    })
  Icon.Avatar = Icon
  Icon.Combine = Icon
  return Icon
}

const LOBE_ICON_TEST_NAMES = [
  'Alibaba',
  'Anthropic',
  'Azure',
  'Baidu',
  'Bailian',
  'Bedrock',
  'Bfl',
  'ChatGLM',
  'Claude',
  'ClaudeCode',
  'Codex',
  'Cohere',
  'Dalle',
  'DeepSeek',
  'ElevenLabs',
  'Flux',
  'Github',
  'Gemini',
  'Google',
  'Grok',
  'Hailuo',
  'HuggingFace',
  'HuaweiCloud',
  'Ideogram',
  'IFlyTekCloud',
  'Infinigence',
  'Kling',
  'Kimi',
  'Meta',
  'Midjourney',
  'Minimax',
  'Mistral',
  'Moonshot',
  'NewAPI',
  'Ollama',
  'OpenAI',
  'OpenRouter',
  'Perplexity',
  'Pika',
  'PixVerse',
  'Qwen',
  'Replicate',
  'Runway',
  'SiliconCloud',
  'Stability',
  'StateCloud',
  'Suno',
  'Tencent',
  'TencentCloud',
  'Together',
  'Trae',
  'Udio',
  'Volcengine',
  'XAI',
  'XiaomiMiMo',
  'Zhipu',
  'Amp',
  'Antigravity',
  'Cline',
  'CodeBuddy',
  'Copilot',
  'Cursor',
  'Devin',
  'GithubCopilot',
  'KiloCode',
  'Kiro',
  'OpenCode',
  'Qoder',
  'Replit',
  'RooCode',
  'Windsurf',
]

vi.mock('@lobehub/icons/es/icons', () => {
  return {
    __esModule: true,
    ...Object.fromEntries(LOBE_ICON_TEST_NAMES.map((name) => [name, makeLobeIconMock(name)])),
  }
})

vi.mock('@lobehub/icons', () => {
  return {
    __esModule: true,
    getLobeIconCDN: vi.fn(() => ''),
    toc: [],
    ...Object.fromEntries(LOBE_ICON_TEST_NAMES.map((name) => [name, makeLobeIconMock(name)])),
  }
})

vi.mock('@lobehub/icons/es/features', () => ({
  modelMappings: [],
  providerMappings: [],
}))

vi.mock('@lobehub/icons/es/features/modelConfig', () => ({
  modelMappings: [],
}))

vi.mock('@lobehub/icons/es/features/providerConfig', () => ({
  providerMappings: [],
}))

// Mock React Router 的 BrowserRouter
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    BrowserRouter: ({ children }: { children: React.ReactNode }) => children,
  }
})

describe('ChatView /copy helpers', () => {
  it('serializes the last assistant message to Markdown', async () => {
    const { getLastAssistantMessageMarkdown, isLocalCopySlashCommand } =
      await import('../design/views/chat-copy')
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'copy what?', isStreaming: false }],
        usage: null,
        eventIds: [],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'First answer', isStreaming: false }],
        usage: null,
        eventIds: [],
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        status: 'completed',
        blocks: [{ kind: 'text', content: '## Latest\n\nUse this.', isStreaming: false }],
        usage: null,
        eventIds: [],
      },
    ]

    expect(isLocalCopySlashCommand('/copy')).toBe(true)
    expect(isLocalCopySlashCommand('/copy please')).toBe(true)
    expect(getLastAssistantMessageMarkdown(messages)).toBe('## Latest\n\nUse this.')
  })

  it('returns null when there is no assistant message to copy', async () => {
    const { getLastAssistantMessageMarkdown } = await import('../design/views/chat-copy')
    const messages: UIMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        status: 'completed',
        blocks: [{ kind: 'text', content: 'hello', isStreaming: false }],
        usage: null,
        eventIds: [],
      },
    ]

    expect(getLastAssistantMessageMarkdown(messages)).toBeNull()
  })
})

describe('Renderer Smoke Tests', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  function expectRunningTaskTag() {
    const runningTag = container.querySelector('.agent-task-running-tag')
    expect(runningTag).not.toBeNull()
    expect(runningTag?.textContent).toContain('执行任务中')
  }

  function mockLobeUiForChatView() {
    vi.doMock('@lobehub/ui', () => {
      type MockProps = Record<string, unknown> & { children?: React.ReactNode }
      const asNode = (value: unknown): React.ReactNode =>
        React.isValidElement(value) ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value == null
          ? value
          : null
      const makeComponent =
        (tag: string) =>
        ({ children, ...props }: MockProps) =>
          React.createElement(tag, props, children)
      const makeInput =
        (type = 'text') =>
        ({ value, checked, onChange, placeholder, className }: MockProps) =>
          React.createElement('input', {
            type,
            value: typeof value === 'string' || typeof value === 'number' ? value : undefined,
            checked: typeof checked === 'boolean' ? checked : undefined,
            placeholder: typeof placeholder === 'string' ? placeholder : undefined,
            className: typeof className === 'string' ? className : undefined,
            onChange,
          })
      const SelectMock = ({ value, options, onChange, children, className }: MockProps) => {
        const ref = React.useRef<HTMLSelectElement | null>(null)
        const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) =>
          typeof onChange === 'function' ? onChange(event.target.value) : undefined
        const setRef = (node: HTMLSelectElement | null) => {
          ref.current = node
          if (node == null || typeof onChange !== 'function') return
          ;(
            node as HTMLSelectElement & { __mockSelectChange?: (value: string) => void }
          ).__mockSelectChange = (next) => onChange(next)
        }
        React.useEffect(() => {
          const node = ref.current
          if (node == null || typeof onChange !== 'function') return undefined
          const handleNativeChange = () => onChange(node.value)
          node.addEventListener('change', handleNativeChange)
          node.addEventListener('input', handleNativeChange)
          return () => {
            delete (node as HTMLSelectElement & { __mockSelectChange?: (value: string) => void })
              .__mockSelectChange
            node.removeEventListener('change', handleNativeChange)
            node.removeEventListener('input', handleNativeChange)
          }
        }, [onChange])
        return React.createElement(
          'select',
          {
            ref: setRef,
            value: typeof value === 'string' || typeof value === 'number' ? value : '',
            className: typeof className === 'string' ? className : undefined,
            onChange: handleChange,
            onInput: handleChange,
          },
          Array.isArray(options)
            ? options.map((option) => {
                const item = option as { label?: React.ReactNode; value?: string | number }
                return React.createElement(
                  'option',
                  { key: String(item.value), value: item.value },
                  item.label ?? item.value,
                )
              })
            : children,
        )
      }
      const ButtonMock = ({
        children,
        icon,
        onClick,
        disabled,
        className,
        type,
        title,
        'aria-label': ariaLabel,
      }: MockProps) => {
        const variantClass = type === 'primary' ? 'btn primary' : type === 'text' ? 'btn' : ''
        return React.createElement(
          'button',
          {
            type: 'button',
            disabled: disabled === true,
            className: [typeof className === 'string' ? className : '', variantClass]
              .filter(Boolean)
              .join(' '),
            title: typeof title === 'string' ? title : undefined,
            'aria-label': typeof ariaLabel === 'string' ? ariaLabel : undefined,
            onClick,
          },
          asNode(icon),
          children,
        )
      }
      const DrawerMock = ({ children, footer }: MockProps) =>
        React.createElement(
          'div',
          null,
          children,
          footer != null
            ? React.createElement('div', { className: 'slide-panel-foot' }, asNode(footer))
            : null,
        )
      const DropdownMock = ({ children, popupRender, open, onOpenChange }: MockProps) =>
        React.createElement(
          'div',
          {
            onClick: () => {
              if (open !== true && typeof onOpenChange === 'function') onOpenChange(true)
            },
          },
          children,
          open === true && typeof popupRender === 'function' ? popupRender() : null,
        )
      const PopoverMock = ({ children, content }: MockProps) =>
        React.createElement('div', null, children, asNode(content))
      const ModalMock = ({ children, footer }: MockProps) =>
        React.createElement('div', null, children, asNode(footer))
      const TooltipMock = ({ children, title }: MockProps) =>
        React.createElement('span', null, children, asNode(title))
      const components: Record<string, unknown> = {
        __esModule: true,
        ActionIcon: ButtonMock,
        Alert: ({ message, children }: MockProps) =>
          React.createElement('div', null, asNode(message), children),
        Button: ButtonMock,
        Checkbox: makeInput('checkbox'),
        Drawer: DrawerMock,
        Dropdown: DropdownMock,
        Empty: makeComponent('div'),
        Input: makeInput(),
        InputNumber: makeInput('number'),
        InputPassword: makeInput('password'),
        Modal: ModalMock,
        Popover: PopoverMock,
        SearchBar: makeInput(),
        Segmented: makeComponent('div'),
        Select: SelectMock,
        Tag: makeComponent('span'),
        TextArea: ({ value, onChange, placeholder, className }: MockProps) =>
          React.createElement('textarea', {
            value: typeof value === 'string' || typeof value === 'number' ? value : undefined,
            placeholder: typeof placeholder === 'string' ? placeholder : undefined,
            className: typeof className === 'string' ? className : undefined,
            onChange,
          }),
        Tooltip: TooltipMock,
      }
      return new Proxy(components, {
        get(target, prop: string | symbol) {
          if (prop === 'then') return undefined
          if (prop in target) return target[prop as keyof typeof target]
          return makeComponent('div')
        },
      })
    })
  }

  function mockAppContextForChatView() {
    vi.doMock('../design/AppContext', () => ({
      AppProvider: ({ children }: { children: React.ReactNode }) => children,
      PRIMARIES: {},
      useApp: () => ({
        t: { sidebarHidden: false },
        requestConfirm: vi.fn(async () => false),
        requestPrompt: vi.fn(async () => null),
        setTweak: vi.fn(),
      }),
    }))
    vi.doMock('../design/auth/AuthContext', () => ({
      AuthProvider: ({ children }: { children: React.ReactNode }) => children,
      useAuth: () => ({ isAuthenticated: false, user: null }),
    }))
  }

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)

    class ResizeObserverMock {
      observe = vi.fn()
      disconnect = vi.fn()
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal('spark', {
      invoke: vi.fn(),
      on: vi.fn(() => vi.fn()),
    })
  })

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
      root = null
    }
    container.remove()
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('saves the OpenAI Responses API kind from the provider edit panel', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'provider:create') {
        return {
          profile: {
            id: 'provider-1',
            name: 'OpenAI Codex',
            provider: 'openai',
            defaultModel: 'gpt-5-codex',
            modelIds: ['gpt-5-codex'],
            apiEndpoint: 'https://api.openai.com/v1',
            keystoreRef: 'openai-provider-1',
            isDefault: false,
            createdAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:update') return { profile: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'canvas:media-models:list') return { models: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    mockLobeUiForChatView()
    const { ProviderEditPanel } = await import('../design/views/SettingsView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      expect(setter).toBeDefined()
      if (setter == null) throw new Error('HTMLInputElement value setter unavailable')
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const setSelectValue = (select: HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      expect(setter).toBeDefined()
      if (setter == null) throw new Error('HTMLSelectElement value setter unavailable')
      setter.call(select, value)
      ;(
        select as HTMLSelectElement & { __mockSelectChange?: (value: string) => void }
      ).__mockSelectChange?.(value)
      select.dispatchEvent(new Event('input', { bubbles: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }

    act(() => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(ProviderEditPanel, {
            initialPresetId: 'openai-official',
            onClose: vi.fn(),
          }),
        ),
      )
    })

    let selects = container.querySelectorAll<HTMLSelectElement>('select')
    await vi.waitFor(() => {
      selects = container.querySelectorAll<HTMLSelectElement>('select')
      const codexSelect = Array.from(selects).find((select) =>
        Array.from(select.options).some((option) => option.value === 'responses'),
      )
      expect(codexSelect).toBeDefined()
    })

    selects = container.querySelectorAll<HTMLSelectElement>('select')
    expect(selects.length).toBeGreaterThanOrEqual(4)

    await act(async () => {
      const codexKindSelect = Array.from(selects).find((select) =>
        Array.from(select.options).some((option) => option.value === 'responses'),
      )
      expect(codexKindSelect).toBeDefined()
      if (codexKindSelect == null) throw new Error('Codex API kind select missing')
      setSelectValue(codexKindSelect, 'responses')
    })

    const inputs = container.querySelectorAll<HTMLInputElement>('input')
    await act(async () => {
      const inputList = Array.from(inputs)
      const nameInput = inputList.find((input) => input.placeholder.includes('Anthropic'))
      const modelInput = inputList.find((input) => input.placeholder.includes('claude-sonnet'))
      const apiKeyInput = inputList.find(
        (input) =>
          input.placeholder.includes('sk-ant') ||
          input.placeholder.toLowerCase().includes('api key'),
      )
      const saveButton = container.querySelector<HTMLButtonElement>(
        '.slide-panel-foot .btn.primary',
      )
      expect(nameInput).toBeDefined()
      expect(modelInput).toBeDefined()
      expect(apiKeyInput).toBeDefined()
      expect(saveButton).not.toBeNull()
      if (nameInput == null || modelInput == null || apiKeyInput == null || saveButton == null) {
        throw new Error('Provider form controls missing')
      }
      setInputValue(nameInput, 'OpenAI Codex')
      setInputValue(modelInput, 'gpt-5-codex')
      setInputValue(apiKeyInput, 'sk-openai')
      saveButton.click()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith(
      'provider:create',
      expect.objectContaining({
        provider: 'openai',
        defaultModel: 'gpt-5-codex',
        codexApiKind: 'responses',
      }),
    )
  })

  it('persists the settings permission mode to the shared composer preference', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'permission:list-profiles') {
        return {
          profiles: [
            {
              id: 'project-standard',
              name: 'Project Standard',
              sandboxLevel: 2,
              rules: [],
            },
          ],
          activeProfileId: 'project-standard',
        }
      }
      if (channel === 'permission:set-active-profile')
        return { activeProfileId: 'project-standard' }
      if (channel === 'permission:update-sandbox') return {}
      if (channel === 'permission:update-rule') return {}
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { PermissionsSection } = await import('../design/views/SettingsView')
    act(() => {
      root = createRoot(container)
      root.render(React.createElement(PermissionsSection))
    })

    await act(async () => {
      await Promise.resolve()
    })

    const bypass = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.runtime-permission-option'),
    ).find((button) => button.textContent?.includes('Bypass permissions'))
    expect(bypass).toBeDefined()

    act(() => {
      bypass!.click()
    })

    const stored = JSON.parse(localStorage.getItem('spark-agent:composer-prefs') ?? '{}')
    expect(stored).toEqual(
      expect.objectContaining({
        adapter: 'claude-sdk',
        permissionMode: 'claude-bypass',
      }),
    )
    expect(invoke).toHaveBeenCalledWith('settings:set', {
      category: 'runtime-permissions',
      key: 'defaults',
      value: expect.objectContaining({
        adapter: 'claude-sdk',
        permissionMode: 'claude-bypass',
      }),
    })
    expect(container.textContent).toContain('当前默认策略会跳过人工审批')
  })

  it('omits blank optional runtime fields when creating a project session', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000101'
    const providerId = '00000000-0000-4000-8000-000000000201'
    const createRequests: Array<Record<string, unknown> | undefined> = []
    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: workspaceId,
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: providerId,
              name: 'Claude CLI',
              provider: 'anthropic',
              defaultModel: 'claude-sonnet-4-20250514',
              modelIds: ['claude-sonnet-4-20250514'],
              apiEndpoint: null,
              keystoreRef: null,
              isDefault: true,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') {
        return {
          agents: [
            {
              id: 'platform-manager-agent',
              name: 'Platform Manager',
              description: '',
              builtIn: true,
              enabled: true,
              isDefault: true,
              providerProfileId: providerId,
              modelId: '',
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-auto-edits',
              reasoningEffort: 'medium',
              prompt: '',
              ruleIds: [],
              skillIds: [],
              disabledSkillIds: [],
              mcpServerIds: [],
              hookConfig: {},
              workflowId: null,
              metadata: {},
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'session:create') {
        createRequests.push(request)
        return { sessionId: 'session-created', createdAt: '2026-05-27T00:00:00.000Z' }
      }
      if (channel === 'settings:set') return { ok: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({
        modelId: '',
        agentId: '',
        providerProfileId: providerId,
      }),
    )
    vi.doMock('../design/AppContext', () => ({
      useApp: () => ({
        requestConfirm: vi.fn(),
        requestPrompt: vi.fn(),
      }),
    }))

    const { SessionSidebarProvider, useSessionSidebar } =
      await import('../design/SessionSidebarContext')
    vi.doUnmock('../design/AppContext')
    const latestCtxRef: { current: ReturnType<typeof useSessionSidebar> | null } = { current: null }
    function CaptureSessionSidebarContext() {
      latestCtxRef.current = useSessionSidebar()
      return null
    }

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            SessionSidebarProvider,
            null,
            React.createElement(CaptureSessionSidebarContext),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(latestCtxRef.current?.workspaces).toHaveLength(1)
    expect(latestCtxRef.current?.providers).toHaveLength(1)
    expect(latestCtxRef.current?.agents).toHaveLength(1)

    await act(async () => {
      await latestCtxRef.current?.handleNewSession(workspaceId)
    })

    expect(createRequests).toHaveLength(1)
    expect(latestCtxRef.current?.activeSessionId).toBe('session-created')
    expect(createRequests[0]).toEqual(
      expect.objectContaining({
        providerProfileId: providerId,
        workspaceId,
        agentId: 'platform-manager-agent',
      }),
    )
    expect(createRequests[0]).not.toHaveProperty('modelId')
  })

  it('renders the floating sidebar panel with navigation items', async () => {
    const { App } = await import('../App')

    act(() => {
      root = createRoot(container)
      root.render(React.createElement(App))
    })

    // Sidebar is always visible (non-collapsible floating panel)
    const sidebar = container.querySelector('.floating-sidebar')
    expect(sidebar).not.toBeNull()

    // Navigation items are always present with labels
    const navLabels = sidebar?.querySelectorAll('.nav-label')
    expect(navLabels?.length).toBeGreaterThan(0)

    // "新建任务" (new task) button is present in the sidebar nav
    const newTaskBtn = Array.from(sidebar?.querySelectorAll('.nav-label') ?? []).find(
      (el) => el.textContent === '新建任务',
    )
    expect(newTaskBtn).toBeDefined()

    act(() => {
      root!.unmount()
    })
  })

  it('shows running sessions in the list and allows stopping the active session', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:cancel') return { cancelled: true }
      throw new Error(`Unhandled channel ${channel}`)
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    vi.doMock('@lobehub/ui', () => {
      const toastStore: Array<{
        id: string
        description?: React.ReactNode
        actions?: Array<{ label: React.ReactNode; onClick?: () => void }>
      }> = []
      let toastId = 0
      const addToast = (
        optionsOrMessage:
          | string
          | {
              description?: React.ReactNode
              actions?: Array<{ label: React.ReactNode; onClick?: () => void }>
            },
      ) => {
        const toast = {
          id: `toast-${++toastId}`,
          ...(typeof optionsOrMessage === 'string'
            ? { description: optionsOrMessage }
            : optionsOrMessage),
        }
        toastStore.push(toast)
        return { id: toast.id, close: vi.fn(), update: vi.fn() }
      }
      const makeComponent =
        (tag: string) =>
        ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
          React.createElement(tag, props, children)
      const components: Record<string, unknown> = {
        __esModule: true,
        Button: makeComponent('button'),
        Checkbox: makeComponent('input'),
        Dropdown: makeComponent('div'),
        Empty: makeComponent('div'),
        Input: makeComponent('input'),
        Modal: makeComponent('div'),
        Popover: makeComponent('div'),
        SearchBar: makeComponent('input'),
        Select: makeComponent('select'),
        Tag: makeComponent('span'),
        TextArea: makeComponent('textarea'),
        Tooltip: makeComponent('span'),
        ToastHost: () =>
          React.createElement(
            'div',
            { 'data-testid': 'toast-host' },
            toastStore.map((toast) =>
              React.createElement(
                'div',
                { key: toast.id, role: 'alert' },
                toast.description,
                toast.actions?.map((action, index) =>
                  React.createElement(
                    'button',
                    { key: index, onClick: action.onClick },
                    action.label,
                  ),
                ),
              ),
            ),
          ),
        toast: {
          dismiss: vi.fn(),
          error: addToast,
          info: addToast,
          success: addToast,
          warning: addToast,
        },
      }
      return new Proxy(components, {
        get(target, prop: string | symbol) {
          if (prop === 'then') return undefined
          if (prop in target) return target[prop as keyof typeof target]
          return makeComponent('div')
        },
      })
    })
    vi.doMock('@lobehub/icons', () => ({
      __esModule: true,
      ...Object.fromEntries(
        [
          'Amp',
          'Alibaba',
          'Antigravity',
          'Anthropic',
          'Baidu',
          'Bailian',
          'Claude',
          'ClaudeCode',
          'Cline',
          'CodeBuddy',
          'Codex',
          'Copilot',
          'Cursor',
          'DeepSeek',
          'Devin',
          'GithubCopilot',
          'Github',
          'Google',
          'HuaweiCloud',
          'IFlyTekCloud',
          'Infinigence',
          'KiloCode',
          'Kling',
          'Kiro',
          'Minimax',
          'Moonshot',
          'NewAPI',
          'Ollama',
          'OpenCode',
          'OpenAI',
          'OpenRouter',
          'Qoder',
          'Qwen',
          'Replit',
          'RooCode',
          'SiliconCloud',
          'StateCloud',
          'TencentCloud',
          'Trae',
          'Volcengine',
          'Windsurf',
          'XiaomiMiMo',
          'Zhipu',
        ].map((name) => {
          const Icon = ({ size }: { size?: number }) =>
            React.createElement('span', {
              'data-lobe-icon': name,
              style: { width: size, height: size },
            })
          Icon.Avatar = Icon
          return [name, Icon]
        }),
      ),
    }))
    vi.doMock('../design/AppContext', () => ({
      AppProvider: ({ children }: { children: React.ReactNode }) => children,
      PRIMARIES: {},
      useApp: () => ({
        t: {},
        requestConfirm: vi.fn(async () => false),
        requestPrompt: vi.fn(async () => null),
      }),
    }))
    vi.doMock('../design/auth/AuthContext', () => ({
      AuthProvider: ({ children }: { children: React.ReactNode }) => children,
      useAuth: () => ({ isAuthenticated: false, user: null }),
    }))

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.session-running-badge')).not.toBeNull()
      expect(
        container.querySelector('.session-running-badge .session-running-spinner.spin'),
      ).not.toBeNull()
    })

    const item = container.querySelector<HTMLElement>('.chat-item-compact')
    expect(item).not.toBeNull()

    await act(async () => {
      item?.click()
    })

    let stopButton: HTMLButtonElement | null = null
    await vi.waitFor(() => {
      stopButton = container.querySelector<HTMLButtonElement>('[title="停止会话"]')
      expect(stopButton).not.toBeNull()
    })

    await act(async () => {
      stopButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('session:cancel', { sessionId: 'session-1' })
  })

  it('does not retry session history endlessly when the initial load fails', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyRequests: Array<Record<string, unknown> | undefined> = []
    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Broken history',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'session:get-history') {
        historyRequests.push(request)
        throw new Error('history unavailable')
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    try {
      vi.doMock('@lobehub/ui', () => {
        const toastStore: Array<{
          id: string
          description?: React.ReactNode
          actions?: Array<{ label: React.ReactNode; onClick?: () => void }>
        }> = []
        let toastId = 0
        const addToast = (
          optionsOrMessage:
            | string
            | {
                description?: React.ReactNode
                actions?: Array<{ label: React.ReactNode; onClick?: () => void }>
              },
        ) => {
          const toast = {
            id: `toast-${++toastId}`,
            ...(typeof optionsOrMessage === 'string'
              ? { description: optionsOrMessage }
              : optionsOrMessage),
          }
          toastStore.push(toast)
          return { id: toast.id, close: vi.fn(), update: vi.fn() }
        }
        const makeComponent =
          (tag: string) =>
          ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) =>
            React.createElement(tag, props, children)
        const components: Record<string, unknown> = {
          __esModule: true,
          Button: makeComponent('button'),
          Checkbox: makeComponent('input'),
          Dropdown: makeComponent('div'),
          Empty: makeComponent('div'),
          Input: makeComponent('input'),
          Modal: makeComponent('div'),
          SearchBar: makeComponent('input'),
          Select: makeComponent('select'),
          Tag: makeComponent('span'),
          TextArea: makeComponent('textarea'),
          Tooltip: makeComponent('span'),
          ToastHost: () =>
            React.createElement(
              'div',
              { 'data-testid': 'toast-host' },
              toastStore.map((toast) =>
                React.createElement(
                  'div',
                  { key: toast.id, role: 'alert' },
                  toast.description,
                  toast.actions?.map((action, index) =>
                    React.createElement(
                      'button',
                      { key: index, onClick: action.onClick },
                      action.label,
                    ),
                  ),
                ),
              ),
            ),
          toast: {
            dismiss: vi.fn(),
            error: addToast,
            info: addToast,
            success: addToast,
            warning: addToast,
          },
        }
        return new Proxy(components, {
          get(target, prop: string | symbol) {
            if (prop === 'then') return undefined
            if (prop in target) return target[prop as keyof typeof target]
            return makeComponent('div')
          },
        })
      })
      vi.doMock('@lobehub/icons', () => ({
        __esModule: true,
        ...Object.fromEntries(
          [
            'Amp',
            'Alibaba',
            'Antigravity',
            'Anthropic',
            'Baidu',
            'Bailian',
            'Claude',
            'ClaudeCode',
            'Cline',
            'CodeBuddy',
            'Codex',
            'Copilot',
            'Cursor',
            'DeepSeek',
            'Devin',
            'GithubCopilot',
            'Github',
            'Google',
            'HuaweiCloud',
            'IFlyTekCloud',
            'Infinigence',
            'KiloCode',
            'Kling',
            'Kiro',
            'Minimax',
            'Moonshot',
            'NewAPI',
            'Ollama',
            'OpenCode',
            'OpenAI',
            'OpenRouter',
            'Qoder',
            'Qwen',
            'Replit',
            'RooCode',
            'SiliconCloud',
            'StateCloud',
            'TencentCloud',
            'Trae',
            'Volcengine',
            'Windsurf',
            'XiaomiMiMo',
            'Zhipu',
          ].map((name) => {
            const Icon = ({ size }: { size?: number }) =>
              React.createElement('span', {
                'data-lobe-icon': name,
                style: { width: size, height: size },
              })
            Icon.Avatar = Icon
            return [name, Icon]
          }),
        ),
      }))
      vi.doMock('../design/AppContext', () => ({
        AppProvider: ({ children }: { children: React.ReactNode }) => children,
        useApp: () => ({
          t: {},
          requestConfirm: vi.fn(async () => false),
          requestPrompt: vi.fn(async () => null),
        }),
      }))
      const { ChatView } = await import('../design/views/ChatView')

      await act(async () => {
        root = createRoot(container)
        root.render(
          React.createElement(
            ToastProvider,
            null,
            React.createElement(
              (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
              null,
              React.createElement(ChatView),
            ),
          ),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await vi.waitFor(() => {
        expect(historyRequests).toHaveLength(1)
      })

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })

      expect(historyRequests).toHaveLength(1)
      expect(historyRequests[0]).toEqual(
        expect.objectContaining({
          sessionId: 'session-1',
          limit: 80,
        }),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('shows a running indicator at the bottom of a streaming agent message with content', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyEvents = [
      {
        id: 'assistant-1',
        type: 'assistant_message',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:00.000Z',
        seq: 1,
        mode: 'delta',
        content: '正在处理项目文件',
        provider: 'codex',
        isFinal: false,
      },
      {
        id: 'status-1',
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:01.000Z',
        seq: 2,
        status: 'thinking',
      },
    ]
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: historyEvents, hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('正在处理项目文件')
    })
    expectRunningTaskTag()
  })

  it('keeps the running task tag while a non-streaming thinking block is still active', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyEvents = [
      {
        id: 'thinking-1',
        type: 'agent_thinking',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:00.000Z',
        seq: 1,
        mode: 'complete',
        content: '我正在检查代码结构',
      },
      {
        id: 'status-1',
        type: 'agent_status',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:01.000Z',
        seq: 2,
        status: 'thinking',
      },
    ]
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: historyEvents, hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('我正在检查代码结构')
    })
    expectRunningTaskTag()
  })

  it('restores the running indicator before the first agent status is persisted', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const historyEvents = [
      {
        id: 'user-1',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:00.000Z',
        seq: 1,
        content: '当前有没有未提交的代码',
      },
    ]
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: historyEvents, hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('当前有没有未提交的代码')
    })
    expectRunningTaskTag()
  })

  it('clears the composer queue loading state from queue snapshots even when the session list is stale', async () => {
    const streamHandlers = new Map<string, Array<(payload: unknown) => void>>()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: true, queuedTurns: [] }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') return { workspace: null }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        streamHandlers.set(channel, [...(streamHandlers.get(channel) ?? []), handler])
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.chat-item-compact')).not.toBeNull()
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.chat-item-compact')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('执行中')
    })

    await act(async () => {
      const snapshot = {
        sessionId: 'session-1',
        running: false,
        queuedTurns: [],
      }
      for (const handler of streamHandlers.get('stream:session:queue-changed') ?? []) {
        handler(snapshot)
      }
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.composer-queue-item.active')).toBeNull()
      expect(container.querySelector('.session-running-badge')).toBeNull()
      expect(container.querySelector('.session-running-spinner.spin')).toBeNull()
    })
    expect(container.textContent).not.toContain('正在执行当前任务')
  })

  it('falls back to terminal agent status events to clear stale running badges', async () => {
    const streamHandlers = new Map<string, Array<(payload: unknown) => void>>()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running task',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: true, queuedTurns: [] }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') return { workspace: null }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, handler: (payload: unknown) => void) => {
        streamHandlers.set(channel, [...(streamHandlers.get(channel) ?? []), handler])
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(
        container.querySelector('.session-running-badge .session-running-spinner.spin'),
      ).not.toBeNull()
    })

    await act(async () => {
      const event = {
        type: 'agent_status',
        sessionId: 'session-1',
        status: 'completed',
      }
      for (const handler of streamHandlers.get('stream:session:agent-event') ?? []) {
        handler(event)
      }
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.session-running-badge')).toBeNull()
      expect(container.querySelector('.session-running-spinner.spin')).toBeNull()
    })
  })

  it('uses different project icons for expanded and collapsed sidebar groups', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    let projectHead: HTMLElement | null = null
    await vi.waitFor(() => {
      projectHead = container.querySelector('.proj-head')
      expect(projectHead).not.toBeNull()
    })

    const expandedIconPath = projectHead!.querySelector('.proj-folder-icon path')?.getAttribute('d')
    expect(expandedIconPath).toBeTruthy()

    await act(async () => {
      projectHead!.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const collapsedIconPath = projectHead!
      .querySelector('.proj-folder-icon path')
      ?.getAttribute('d')
    expect(collapsedIconPath).toBeTruthy()
    expect(collapsedIconPath).not.toBe(expandedIconPath)
  })

  it('renders project controls in a pinned toolbar and collapses all project groups', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Build toolbar',
              status: 'idle',
              workspaceIds: ['workspace-1'],
              archivedAt: null,
              pinnedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'terminal:list-active') return { sessions: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')
    const { SidebarSessionList } = await import('../design/SidebarSessionList')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(SidebarSessionList)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    let toolbar: HTMLElement | null = null
    await vi.waitFor(() => {
      toolbar = container.querySelector('.sidebar-project-toolbar')
      expect(toolbar).not.toBeNull()
      expect(toolbar?.textContent).toContain('项目')
      expect(container.querySelector('.proj-session')).not.toBeNull()
    })

    const toolbarNode = container.querySelector<HTMLElement>('.sidebar-project-toolbar')
    if (toolbarNode == null) throw new Error('Project toolbar did not render')
    const chatListNode = container.querySelector<HTMLElement>('.chat-list')
    expect(chatListNode?.contains(toolbarNode)).toBe(false)
    const addButton = toolbarNode.querySelector<HTMLButtonElement>('[title="添加项目"]')
    expect(addButton).not.toBeNull()
    if (addButton == null) throw new Error('Add project button did not render')

    await act(async () => {
      addButton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('创建项目')

    const collapseButton = toolbarNode.querySelector<HTMLButtonElement>('[title="折叠所有项目"]')
    expect(collapseButton).not.toBeNull()
    if (collapseButton == null) throw new Error('Collapse all projects button did not render')

    await act(async () => {
      collapseButton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('.proj-session')).toBeNull()
  })

  it('hides other project groups when filtering by a single project', async () => {
    localStorage.setItem(
      'spark-agent:sidebar-filter',
      JSON.stringify({
        status: 'active',
        projectId: 'workspace-1',
        lastActivity: 'all',
        groupBy: 'project',
      }),
    )

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Selected Project',
              rootPath: '/tmp/selected-project',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
            {
              id: 'workspace-2',
              name: 'Other Project',
              rootPath: '/tmp/other-project',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 2,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Selected session',
              status: 'idle',
              workspaceIds: ['workspace-1'],
              archivedAt: null,
              pinnedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'terminal:list-active') return { sessions: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')
    const { SidebarSessionList } = await import('../design/SidebarSessionList')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(SidebarSessionList)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Selected Project')
      expect(container.textContent).toContain('Selected session')
    })
    expect(container.textContent).not.toContain('Other Project')
  })

  it('renders only four permission approval actions inline above the composer', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') return { workspaces: [], total: 0 }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'permission:approval-respond') return { ok: true }
      return {}
    })
    const onApprovalClose = vi.fn()
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { AppProvider } = await import('../design/AppContext')

    await act(async () => {
      root = createRoot(container)
      const ChatViewWithApproval = ChatView as React.ComponentType<{
        approvalRequest: {
          requestId: string
          sessionId: string
          toolName: string
          action: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          persistentScopes: Array<'project' | 'global'>
        }
        onApprovalClose: () => void
      }>
      root.render(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            ToastProvider,
            null,
            React.createElement(
              (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
              null,
              React.createElement(ChatViewWithApproval, {
                approvalRequest: {
                  requestId: 'req-1',
                  sessionId: '42e5391d-session',
                  toolName: 'bash',
                  action: 'command_exec',
                  toolInput: { command: 'git log --oneline -20' },
                  riskLevel: 'high',
                  persistentScopes: ['project', 'global'],
                },
                onApprovalClose,
              }),
            ),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const inlineCard = container.querySelector('.composer-approval-card')
    const composer = container.querySelector('.composer')
    expect(inlineCard).not.toBeNull()
    expect(composer).not.toBeNull()
    expect(inlineCard?.compareDocumentPosition(composer!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(container.querySelector('.modal-backdrop')).toBeNull()
    expect(inlineCard?.textContent).toContain('运行命令')
    expect(inlineCard?.textContent).toContain('git log --oneline -20')
    expect(inlineCard?.textContent).toContain('查看技术详情')

    const approvalButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.composer-approval-btn'),
    )
    expect(approvalButtons.map((button) => button.textContent?.trim())).toEqual([
      '拒绝',
      '会话拒绝',
      '会话允许',
      '允许',
    ])
    expect(container.textContent).not.toContain('本项目拒绝')
    expect(container.textContent).not.toContain('全局拒绝')
    expect(container.textContent).not.toContain('本项目记住')
    expect(container.textContent).not.toContain('全局记住')

    const allowButton = approvalButtons.find((button) => button.textContent?.trim() === '允许')
    expect(allowButton).toBeDefined()

    await act(async () => {
      allowButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('permission:approval-respond', {
      requestId: 'req-1',
      decision: 'allow-once',
    })
    expect(onApprovalClose).toHaveBeenCalled()
  })

  it('submits deny-session from inline approval', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') return { workspaces: [], total: 0 }
      if (channel === 'session:list') return { sessions: [], total: 0 }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'permission:approval-respond') return { ok: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { ChatView } = await import('../design/views/ChatView')
    const { AppProvider } = await import('../design/AppContext')

    await act(async () => {
      root = createRoot(container)
      const ChatViewWithApproval = ChatView as React.ComponentType<{
        approvalRequest: {
          requestId: string
          sessionId: string
          toolName: string
          action: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          persistentScopes: Array<'project' | 'global'>
        }
      }>
      root.render(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            ToastProvider,
            null,
            React.createElement(
              (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
              null,
              React.createElement(ChatViewWithApproval, {
                approvalRequest: {
                  requestId: 'req-2',
                  sessionId: '42e5391d-session',
                  toolName: 'bash',
                  action: 'command_exec',
                  toolInput: { command: 'git status' },
                  riskLevel: 'high',
                  persistentScopes: ['project', 'global'],
                },
              }),
            ),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const denySessionButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.composer-approval-btn'),
    ).find((button) => button.textContent?.trim() === '会话拒绝')
    expect(denySessionButton).toBeDefined()

    await act(async () => {
      denySessionButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith('permission:approval-respond', {
      requestId: 'req-2',
      decision: 'deny-session',
    })
  })

  it('places the composer caret at the end of a restored session draft', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    localStorage.setItem(
      'spark-agent:composer-drafts',
      JSON.stringify({
        'session-1': {
          value: 'restored draft text',
          attachments: [],
          manualExpanded: false,
        },
      }),
    )

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Draft session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'provider-1',
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: 'provider-1',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { ChatView } = await import('../design/views/ChatView')
    const { AppProvider } = await import('../design/AppContext')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          AppProvider,
          null,
          React.createElement(
            LocalToastProvider,
            null,
            React.createElement(
              (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
              null,
              React.createElement(ChatView),
            ),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    await vi.waitFor(() => {
      const textarea = container.querySelector<HTMLTextAreaElement>('.composer-input')
      expect(textarea).not.toBeNull()
      expect(textarea?.value).toBe('restored draft text')
      expect(textarea?.selectionStart).toBe('restored draft text'.length)
      expect(textarea?.selectionEnd).toBe('restored draft text'.length)
    })
  })

  it('routes background approval requests to the target session instead of popping in the current one', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const listeners = new Map<string, Array<(payload: unknown) => void>>()
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'window:is-maximized') return { maximized: false }
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Current session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 1,
            },
            {
              id: 'session-2',
              title: 'Target session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 2,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'provider-1',
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: 'provider-1',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'playwright:status')
        return { installed: false, enabled: false, viewOpen: false, mode: 'off' }
      if (channel === 'hook:trigger') return { triggered: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (payload: unknown) => void) => {
        const arr = listeners.get(channel) ?? []
        arr.push(callback)
        listeners.set(channel, arr)
        return vi.fn()
      }),
    })

    vi.doMock('../design/views/WorkflowView', () => ({
      WorkflowView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/AgentsView', () => ({
      AgentsView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/McpView', () => ({ McpView: () => React.createElement('div') }))
    vi.doMock('../design/views/SkillsView', () => ({
      SkillsView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/SkillStoreView', () => ({
      SkillStoreView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/SettingsView', () => ({
      SettingsView: () => React.createElement('div'),
      ProfileEditModal: () => null,
    }))
    vi.doMock('../design/views/ProvidersView', () => ({
      default: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/BrowserPanelView', () => ({ BrowserPanelView: () => null }))
    vi.doMock('../design/views/ProjectView', () => ({
      ProjectView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/overlays', () => ({
      CommandPalette: () => null,
      PermissionModal: () => null,
    }))

    const { App } = await import('../App')

    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(App))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      listeners.get('stream:permission:approval-request')?.forEach((handler) => {
        handler({
          requestId: 'req-background',
          sessionId: 'session-2',
          toolName: 'bash',
          action: 'command_exec',
          toolInput: { command: 'git status' },
          riskLevel: 'high',
          persistentScopes: ['project', 'global'],
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('.modal-backdrop')).toBeNull()
    expect(container.querySelector('.composer-approval-card')).toBeNull()
    expect(document.body.textContent).toContain('有新的权限审批等待处理')
    expect(invoke).toHaveBeenCalledWith('hook:trigger', {
      sessionId: 'session-2',
      node: 'permission_request',
      title: 'Target session',
      body: 'Agent 正在等待您的审批',
    })

    const jumpButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('前往审批'),
    )
    expect(jumpButton).toBeDefined()

    await act(async () => {
      jumpButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.textContent).toContain('Target session')
    expect(container.querySelector('.composer-approval-card')).not.toBeNull()
  })

  it('keeps unsent composer drafts isolated per session', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'window:is-maximized') return { maximized: false }
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Draft session one',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 1,
            },
            {
              id: 'session-2',
              title: 'Draft session two',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 1,
            },
          ],
          total: 2,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'provider-1',
              name: 'Claude',
              provider: 'anthropic',
              defaultModel: 'claude-3-5-sonnet',
              modelIds: ['claude-3-5-sonnet'],
              apiEndpoint: 'https://api.example.com',
              keystoreRef: 'provider-1',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'agent:list') return { agents: [] }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'playwright:status')
        return { installed: false, enabled: false, viewOpen: false, mode: 'off' }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    vi.doMock('../design/views/WorkflowView', () => ({
      WorkflowView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/AgentsView', () => ({
      AgentsView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/McpView', () => ({ McpView: () => React.createElement('div') }))
    vi.doMock('../design/views/SkillsView', () => ({
      SkillsView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/SkillStoreView', () => ({
      SkillStoreView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/SettingsView', () => ({
      SettingsView: () => React.createElement('div'),
      ProfileEditModal: () => null,
    }))
    vi.doMock('../design/views/ProvidersView', () => ({
      default: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/BrowserPanelView', () => ({ BrowserPanelView: () => null }))
    vi.doMock('../design/views/ProjectView', () => ({
      ProjectView: () => React.createElement('div'),
    }))
    vi.doMock('../design/views/overlays', () => ({
      CommandPalette: () => null,
      PermissionModal: () => null,
    }))

    const { App } = await import('../App')

    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(App))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const setTextareaValue = (element: HTMLTextAreaElement | null, value: string) => {
      expect(element).not.toBeNull()
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      expect(setter).toBeDefined()
      if (setter == null || element == null) throw new Error('textarea setter unavailable')
      setter.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const composerInput = () => container.querySelector<HTMLTextAreaElement>('.composer-input')

    await act(async () => {
      setTextareaValue(composerInput(), 'draft for session one')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sessionTwoItem = Array.from(
      container.querySelectorAll<HTMLElement>('.chat-item-compact'),
    ).find((item) => item.textContent?.includes('Draft session two'))
    expect(sessionTwoItem).toBeDefined()

    await act(async () => {
      sessionTwoItem?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(composerInput()?.value).toBe('')
    })

    await act(async () => {
      setTextareaValue(composerInput(), 'draft for session two')
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sessionOneItem = Array.from(
      container.querySelectorAll<HTMLElement>('.chat-item-compact'),
    ).find((item) => item.textContent?.includes('Draft session one'))
    expect(sessionOneItem).toBeDefined()

    await act(async () => {
      sessionOneItem?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(composerInput()?.value).toBe('draft for session one')
    })

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLElement>('.chat-item-compact'))
        .find((item) => item.textContent?.includes('Draft session two'))
        ?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(composerInput()?.value).toBe('draft for session two')
    })
  })

  it('renders plan approval as the only approval surface for control tools', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const listeners = new Map<string, (payload: unknown) => void>()
    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Plan mode session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'anthropic-provider',
              modelId: 'claude-sonnet-4-5',
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'anthropic-provider',
              name: 'Anthropic',
              provider: 'anthropic',
              defaultModel: 'claude-sonnet-4-5',
              modelIds: ['claude-sonnet-4-5'],
              apiEndpoint: null,
              keystoreRef: 'anthropic-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'session:update') {
        return {
          session: {
            id: 'session-1',
            title: 'Plan mode session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: 'anthropic-provider',
            modelId: 'claude-sonnet-4-5',
            agentAdapter: 'claude-sdk',
            permissionMode: request?.permissionMode,
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          },
        }
      }
      if (channel === 'session:submit-turn')
        return { turnId: 'turn-continue', accepted: true, started: true }
      return {}
    })
    const onApprovalClose = vi.fn()
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (payload: unknown) => void) => {
        listeners.set(channel, callback)
        return vi.fn()
      }),
    })

    mockLobeUiForChatView()
    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      const ChatViewWithApproval = ChatView as React.ComponentType<{
        approvalRequest: {
          requestId: string
          sessionId: string
          toolName: string
          action: string
          toolInput: Record<string, unknown>
          riskLevel: 'low' | 'medium' | 'high'
          persistentScopes: Array<'project' | 'global'>
        }
        onApprovalClose: () => void
      }>
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatViewWithApproval, {
              approvalRequest: {
                requestId: 'req-plan',
                sessionId: 'session-1',
                toolName: 'exit_plan_mode',
                action: 'control_plan',
                toolInput: { plan: '1. inspect\n2. patch\n3. verify' },
                riskLevel: 'low',
                persistentScopes: ['project', 'global'],
              },
              onApprovalClose,
            }),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('.composer-approval-card')).toBeNull()

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Plan mode session')
    })
    await vi.waitFor(() => {
      expect(listeners.get('stream:session:agent-event')).toBeDefined()
    })

    await act(async () => {
      listeners.get('stream:session:agent-event')?.({
        id: 'evt-plan',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-28T00:00:01.000Z',
        type: 'plan_proposed',
        plan: '1. inspect\n2. patch\n3. verify',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.plan-approval')).not.toBeNull()
    })
    expect(container.querySelector('.composer-approval-card')).toBeNull()
    expect(container.textContent).toContain('计划已就绪，等待你审批')

    const approveButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.plan-approval button'),
    ).find((button) => button.textContent?.includes('批准并执行'))
    expect(approveButton).toBeDefined()

    await act(async () => {
      approveButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith(
      'session:submit-turn',
      expect.objectContaining({
        sessionId: 'session-1',
        message: expect.stringContaining('1. inspect\n2. patch\n3. verify'),
        permissionMode: 'claude-auto-edits',
        interruptActive: true,
      }),
    )
    const sendTurnIndex = invoke.mock.calls.findIndex(
      ([channel]) => channel === 'session:submit-turn',
    )
    const runtimeUpdateIndex = invoke.mock.calls.findIndex(
      ([channel, request]) =>
        channel === 'session:update' &&
        (request as Record<string, unknown> | undefined)?.permissionMode === 'claude-auto-edits',
    )
    expect(sendTurnIndex).toBeGreaterThanOrEqual(0)
    expect(runtimeUpdateIndex).toBe(-1)

    await vi.waitFor(() => {
      expect(container.textContent).toContain('自动编辑')
    })
    expect(JSON.parse(localStorage.getItem('spark-agent:composer-prefs') ?? '{}')).toMatchObject({
      permissionMode: 'claude-auto-edits',
    })
  })

  it('uses the active session provider model instead of stale composer preferences', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({
        adapter: 'claude-sdk',
        providerProfileId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
        permissionMode: 'claude-plan',
      }),
    )

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Old GLM session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'tencent-provider',
              modelId: null,
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: '腾讯云 Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: '小米 MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: false,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'session:submit-turn')
        return { turnId: 'turn-1', accepted: true, started: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })
    expect(container.textContent).not.toContain('mimo-v2.5-pro')
    const pickerIcon = container.querySelector('.composer-model-picker .composer-select-icon')
    expect(pickerIcon?.querySelector('[data-lobe-icon="TencentCloud"]')).not.toBeNull()
    expect(pickerIcon?.querySelector('[data-lobe-icon="XiaomiMiMo"]')).toBeNull()

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    const sendButton = container.querySelector<HTMLButtonElement>('.composer-send-round')
    expect(textarea).not.toBeNull()
    expect(sendButton).not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'hello from old session')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      sendButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith(
      'session:submit-turn',
      expect.objectContaining({
        sessionId: 'session-1',
        providerProfileId: 'tencent-provider',
        modelId: 'glm-5',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
      }),
    )
  })

  it('derives the provider from the active session model when the session provider is missing', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    localStorage.setItem(
      'spark-agent:composer-prefs',
      JSON.stringify({
        adapter: 'claude-sdk',
        providerProfileId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
        permissionMode: 'claude-plan',
      }),
    )

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Recovered model owner',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: '',
              modelId: 'glm-5',
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: '腾讯云 Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: false,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: '小米 MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      if (channel === 'session:submit-turn')
        return { turnId: 'turn-1', accepted: true, started: true }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })
    expect(container.textContent).not.toContain('mimo-v2.5-pro')

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    const sendButton = container.querySelector<HTMLButtonElement>('.composer-send-round')
    expect(textarea).not.toBeNull()
    expect(sendButton).not.toBeNull()

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'hello with recovered provider')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await act(async () => {
      sendButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith(
      'session:submit-turn',
      expect.objectContaining({
        sessionId: 'session-1',
        providerProfileId: 'tencent-provider',
        modelId: 'glm-5',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
      }),
    )
  })

  it('uses the session model owner icon when the stored provider no longer supports that model', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')

    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-09T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Externally switched model',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'xiaomi-provider',
              modelId: 'glm-5',
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-07-09T00:00:00.000Z',
              updatedAt: '2026-07-09T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: '腾讯云 Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: false,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: '小米 MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: true,
              createdAt: '2026-07-09T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })

    const pickerIcon = container.querySelector('.composer-model-picker .composer-select-icon')
    expect(pickerIcon?.querySelector('[data-lobe-icon="TencentCloud"]')).not.toBeNull()
    expect(pickerIcon?.querySelector('[data-lobe-icon="XiaomiMiMo"]')).toBeNull()
  })

  it('switches same-adapter provider and model atomically for an existing session', async () => {
    localStorage.setItem('spark-agent:last-active-session', 'session-1')
    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Switch model session',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'tencent-provider',
              modelId: 'glm-5',
              agentAdapter: 'claude-sdk',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-28T00:00:00.000Z',
              updatedAt: '2026-05-28T00:00:00.000Z',
              messageCount: 0,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
          },
        }
      }
      if (channel === 'provider:list') {
        return {
          profiles: [
            {
              id: 'tencent-provider',
              name: 'Tencent Coding Plan',
              provider: 'anthropic',
              defaultModel: 'glm-5',
              modelIds: ['glm-5'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'tencent-key',
              isDefault: true,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
            {
              id: 'xiaomi-provider',
              name: 'Xiaomi MiMo',
              provider: 'anthropic',
              defaultModel: 'mimo-v2.5-pro',
              modelIds: ['mimo-v2.5-pro'],
              apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
              keystoreRef: 'xiaomi-key',
              isDefault: false,
              createdAt: '2026-05-28T00:00:00.000Z',
            },
          ],
        }
      }
      if (channel === 'session:update') {
        return {
          session: {
            id: 'session-1',
            title: 'Switch model session',
            projectId: 'workspace-1',
            workspaceIds: ['workspace-1'],
            providerProfileId: request?.providerProfileId,
            modelId: request?.modelId,
            agentAdapter: request?.agentAdapter,
            permissionMode: request?.permissionMode,
            chatMode: 'agent',
            reasoningEffort: 'medium',
            status: 'idle',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-28T00:00:00.000Z',
            updatedAt: '2026-05-28T00:00:00.000Z',
            messageCount: 0,
          },
        }
      }
      if (channel === 'settings:get') return { value: null }
      if (channel === 'settings:set') return { ok: true }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'main', branches: ['main'] }
      if (channel === 'session:get-history') return { events: [], hasMore: false }
      if (channel === 'session:get-queue')
        return { sessionId: 'session-1', running: false, queuedTurns: [] }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    mockLobeUiForChatView()
    mockAppContextForChatView()
    const { ChatView } = await import('../design/views/ChatView')
    const { ToastProvider: LocalToastProvider } = await import('../design/components/Toast')
    const { SessionSidebarProvider } = await import('../design/SessionSidebarContext')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          LocalToastProvider,
          null,
          React.createElement(SessionSidebarProvider, null, React.createElement(ChatView)),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('glm-5')
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.composer-model-picker .composer-select-trigger')
        ?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const mimoButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.composer-model-menu .composer-menu-item'),
    ).find((button) => button.textContent?.includes('mimo-v2.5-pro'))
    expect(mimoButton).toBeDefined()

    await act(async () => {
      mimoButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(invoke).toHaveBeenCalledWith(
      'session:update',
      expect.objectContaining({
        sessionId: 'session-1',
        providerProfileId: 'xiaomi-provider',
        modelId: 'mimo-v2.5-pro',
        agentAdapter: 'claude-sdk',
        permissionMode: 'claude-plan',
      }),
    )
  })

  it('does not auto-collapse the latest assistant message body', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Long answer',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 4,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'session:get-history') {
        return {
          events: [
            {
              id: 'user-1',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:00.000Z',
              seq: 1,
              content: 'first',
            },
            {
              id: 'assistant-1',
              type: 'assistant_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:01.000Z',
              seq: 2,
              mode: 'complete',
              provider: 'claude',
              content: 'Historical long answer',
              isFinal: true,
            },
            {
              id: 'user-2',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-2',
              timestamp: '2026-05-27T00:00:02.000Z',
              seq: 3,
              content: 'second',
            },
            {
              id: 'assistant-2',
              type: 'assistant_message',
              sessionId: 'session-1',
              turnId: 'turn-2',
              timestamp: '2026-05-27T00:00:03.000Z',
              seq: 4,
              mode: 'complete',
              provider: 'claude',
              content: 'Latest long answer',
              isFinal: true,
            },
          ],
          hasMore: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(800)

    try {
      const { ChatView } = await import('../design/views/ChatView')

      await act(async () => {
        root = createRoot(container)
        root.render(
          React.createElement(
            ToastProvider,
            null,
            React.createElement(
              (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
              null,
              React.createElement(ChatView),
            ),
          ),
        )
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await vi.waitFor(() => {
        expect(container.querySelector('.chat-item-compact')).not.toBeNull()
      })

      await act(async () => {
        container.querySelector<HTMLElement>('.chat-item-compact')?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      await vi.waitFor(() => {
        expect(container.querySelectorAll('.msg-agent').length).toBe(2)
      })

      await vi.waitFor(() => {
        expect(container.querySelectorAll('.collapse-overlay .collapse-toggle').length).toBe(1)
      })
      const latestMessage = container.querySelectorAll('.msg-agent')[1]
      expect(latestMessage?.querySelector('.collapse-overlay .collapse-toggle')).toBeNull()
    } finally {
      scrollHeightSpy.mockRestore()
    }
  })

  it('shows the latest todo_write plan below session information in the inspector', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Plan progress',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'idle',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 2,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'session:get-history') {
        return {
          events: [
            {
              id: 'user-1',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:00.000Z',
              seq: 1,
              content: 'make a plan',
            },
            {
              id: 'tool-1',
              type: 'tool_call',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:01.000Z',
              seq: 2,
              provider: 'claude',
              toolCallId: 'todo-1',
              toolName: 'todo_write',
              toolInput: {
                todos: [
                  { content: '确认空目录状态', status: 'completed' },
                  {
                    content: '初始化 React 项目',
                    activeForm: '执行 Vite 初始化命令',
                    status: 'in_progress',
                  },
                  { content: '验证启动脚本', status: 'pending' },
                ],
              },
              source: 'builtin',
            },
          ],
          hasMore: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.chat-item-compact')).not.toBeNull()
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.chat-item-compact')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('todo_write')
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.tabbar-actions .icon-btn[aria-label="会话检查器"]')
        ?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const sections = Array.from(container.querySelectorAll<HTMLElement>('.inspector-section'))
    expect(sections[0]?.textContent).toContain('会话信息')
    expect(sections[1]?.textContent).toContain('计划')
    expect(sections[1]?.textContent).toContain('1/3')
    expect(sections[1]?.textContent).toContain('执行 Vite 初始化命令')
  })

  it('updates git environment progress from live todo_write events', async () => {
    let streamHandler: ((event: Record<string, unknown>) => void) | null = null
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Git progress',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-plan',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 2,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches')
        return { currentBranch: 'develop', branches: ['develop'] }
      if (channel === 'workspace:git-status') {
        return {
          isGitRepo: true,
          currentBranch: 'develop',
          branches: ['develop'],
          hasRemote: true,
          remoteName: 'origin',
          remoteBranch: 'develop',
          additions: 30,
          deletions: 28,
          changedFiles: 4,
          stagedFiles: 0,
          ahead: 0,
          behind: 0,
          files: [],
        }
      }
      if (channel === 'session:get-history') {
        return {
          events: [
            {
              id: 'user-1',
              type: 'user_message',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:00.000Z',
              seq: 1,
              content: 'fix progress',
            },
            {
              id: 'todo-1',
              type: 'tool_call',
              sessionId: 'session-1',
              turnId: 'turn-1',
              timestamp: '2026-05-27T00:00:01.000Z',
              seq: 2,
              provider: 'claude',
              toolCallId: 'todo-1',
              toolName: 'todo_write',
              toolInput: {
                todos: [
                  { id: 'locate', content: '定位文件变更展示链路', status: 'in_progress' },
                  { id: 'fix', content: '实施修复', status: 'pending' },
                ],
              },
              source: 'builtin',
            },
          ],
          hasMore: false,
        }
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:session:agent-event') streamHandler = callback
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.chat-item-compact')).not.toBeNull()
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.chat-item-compact')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      const panelText = container.querySelector('.git-env-panel')?.textContent ?? ''
      expect(panelText).toContain('进程')
      expect(panelText).toContain('0/2')
      expect(panelText).toContain('定位文件变更展示链路')
    })

    await act(async () => {
      streamHandler?.({
        id: 'todo-2',
        type: 'tool_call',
        sessionId: 'session-1',
        turnId: 'turn-1',
        timestamp: '2026-05-27T00:00:02.000Z',
        seq: 3,
        provider: 'claude',
        toolCallId: 'todo-2',
        toolName: 'todo_write',
        toolInput: {
          todos: [
            { id: 'locate', content: '定位文件变更展示链路', status: 'completed' },
            { id: 'fix', content: '实施修复', activeForm: '正在实施修复', status: 'in_progress' },
          ],
        },
        source: 'builtin',
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      const panelText = container.querySelector('.git-env-panel')?.textContent ?? ''
      expect(panelText).toContain('1/2')
      expect(panelText).toContain('正在实施修复')
    })
  })

  it('hydrates complete running history with one IPC request and merges live events received during reload', async () => {
    let streamHandler: ((event: Record<string, unknown>) => void) | null = null
    let resolveFirstHistory: ((value: unknown) => void) | null = null
    const firstHistory = new Promise((resolve) => {
      resolveFirstHistory = resolve
    })
    const historyCalls: Array<Record<string, unknown>> = []

    const userEvent = (seq: number, turnId: string, content: string) => ({
      id: `user-${seq}`,
      type: 'user_message',
      sessionId: 'session-1',
      turnId,
      timestamp: `2026-05-27T00:00:0${seq}.000Z`,
      seq,
      content,
    })
    const assistantEvent = (seq: number, turnId: string, content: string) => ({
      id: `assistant-${seq}`,
      type: 'assistant_message',
      sessionId: 'session-1',
      turnId,
      timestamp: `2026-05-27T00:00:0${seq}.000Z`,
      seq,
      mode: 'delta',
      provider: 'claude',
      content,
      isFinal: false,
    })

    const invoke = vi.fn(async (channel: string, request?: Record<string, unknown>) => {
      if (channel === 'workspace:list') {
        return {
          workspaces: [
            {
              id: 'workspace-1',
              name: 'Spark Agent',
              rootPath: '/tmp/spark-agent',
              projectKind: 'node',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
            },
          ],
          total: 1,
        }
      }
      if (channel === 'session:list') {
        return {
          sessions: [
            {
              id: 'session-1',
              title: 'Running stream',
              projectId: 'workspace-1',
              workspaceIds: ['workspace-1'],
              providerProfileId: 'provider-1',
              modelId: 'claude-3-5-sonnet',
              agentAdapter: 'claude',
              permissionMode: 'claude-ask',
              chatMode: 'agent',
              reasoningEffort: 'medium',
              status: 'running',
              pinnedAt: null,
              archivedAt: null,
              createdAt: '2026-05-27T00:00:00.000Z',
              updatedAt: '2026-05-27T00:00:00.000Z',
              messageCount: 5,
            },
          ],
          total: 1,
        }
      }
      if (channel === 'workspace:get-current') return { workspace: null }
      if (channel === 'provider:list') return { profiles: [] }
      if (channel === 'workspace:list-branches') return { currentBranch: null, branches: [] }
      if (channel === 'workspace:open') {
        return {
          workspace: {
            id: 'workspace-1',
            name: 'Spark Agent',
            rootPath: '/tmp/spark-agent',
            projectKind: 'node',
            pinnedAt: null,
            archivedAt: null,
            createdAt: '2026-05-27T00:00:00.000Z',
            updatedAt: '2026-05-27T00:00:00.000Z',
          },
        }
      }
      if (channel === 'session:get-history') {
        historyCalls.push(request ?? {})
        if (historyCalls.length === 1) return firstHistory
        throw new Error('history should be loaded in one complete request')
      }
      return {}
    })
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn((channel: string, callback: (event: Record<string, unknown>) => void) => {
        if (channel === 'stream:session:agent-event') streamHandler = callback
        return vi.fn()
      }),
    })

    const { ChatView } = await import('../design/views/ChatView')

    await act(async () => {
      root = createRoot(container)
      root.render(
        React.createElement(
          ToastProvider,
          null,
          React.createElement(
            (await import('../design/SessionSidebarContext')).SessionSidebarProvider,
            null,
            React.createElement(ChatView),
          ),
        ),
      )
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(container.querySelector('.chat-item-compact')).not.toBeNull()
    })

    await act(async () => {
      container.querySelector<HTMLElement>('.chat-item-compact')?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(historyCalls.length).toBe(1)
      expect(streamHandler).not.toBeNull()
    })

    await act(async () => {
      streamHandler?.(assistantEvent(4, 'turn-2', 'live tail. '))
      resolveFirstHistory?.({
        events: [
          userEvent(0, 'turn-1', 'first'),
          assistantEvent(1, 'turn-1', 'Older answer. '),
          userEvent(2, 'turn-2', 'second'),
          assistantEvent(3, 'turn-2', 'Latest start. '),
        ],
        hasMore: false,
      })
      await firstHistory
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    await vi.waitFor(() => {
      expect(historyCalls).toHaveLength(1)
      // 窗口化：首屏加载最新一页（limit），不再一次性 full 拉全量
      expect(historyCalls[0]).toEqual(expect.objectContaining({ turnLimit: expect.any(Number) }))
      expect(historyCalls[0]).not.toHaveProperty('full')
    })

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Older answer.')
      expect(container.textContent).toContain('Latest start. live tail.')
    })
  })

  it.todo('should render HomePage with metric cards')
  it.todo('should render SettingsPage with sub-navigation')
})

// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceInfo } from '@spark/protocol'
import type { SessionSummary } from '../../SessionSidebarContext'
import { ChatConfigPanel } from './ChatInspectorPanel'

const mocks = vi.hoisted(() => ({
  getPromptConfig: vi.fn(),
  updatePromptConfig: vi.fn(),
  getEnvConfig: vi.fn(),
  updateEnvConfig: vi.fn(),
  getPromptFilter: vi.fn(),
  updatePromptFilter: vi.fn(),
  clipboardReadText: vi.fn(),
  clipboardWriteText: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@lobehub/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lobehub/ui')>()
  return {
    ...actual,
    Popover: ({ children }: { children: React.ReactNode }) => children,
  }
})

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke: {
      'prompt-config:get': mocks.getPromptConfig,
      'prompt-config:update': mocks.updatePromptConfig,
      'env-config:get': mocks.getEnvConfig,
      'env-config:update': mocks.updateEnvConfig,
      'prompt-filter:get': mocks.getPromptFilter,
      'prompt-filter:update': mocks.updatePromptFilter,
    }[channel],
  }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

// ChatConfigPanel 读取 sessionCtx.agents（项目 Agent 区块数据源）；测试树没有
// SessionSidebarProvider，mock 最小 ctx（agents 空数组 + refreshData）。
vi.mock('../../SessionSidebarContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../SessionSidebarContext')>()
  return {
    ...actual,
    useSessionSidebar: () => ({
      agents: [],
      refreshData: vi.fn(),
    }),
  }
})
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session = { id: 'session-1' } as SessionSummary
const workspace = {
  id: 'workspace-1',
  name: 'Workspace',
  rootPath: '/workspace',
  pinnedAt: null,
  archivedAt: null,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  worktreeMeta: null,
} satisfies WorkspaceInfo

async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function findButton(root: ParentNode, label: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
  )
  if (button == null) throw new Error(`找不到按钮：${label}`)
  return button
}

describe('ChatConfigPanel runtime configuration feedback', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.getPromptConfig.mockResolvedValue({
      system: { enabled: false, content: '' },
      agent: { enabled: false, content: '' },
      project: { enabled: true, content: 'project prompt' },
      session: { enabled: true, content: 'session prompt' },
      effectivePrompt: '',
    })
    mocks.getEnvConfig.mockResolvedValue({
      project: {
        enabled: true,
        vars: [{ key: 'API_KEY', value: 'secret', description: 'access token' }],
      },
      session: { enabled: true, vars: [{ key: 'PORT', value: '3000' }] },
      effectiveEnv: { API_KEY: 'secret', PORT: '3000' },
    })
    mocks.updatePromptConfig.mockResolvedValue(undefined)
    mocks.updateEnvConfig.mockResolvedValue(undefined)
    mocks.getPromptFilter.mockResolvedValue({
      project: { configured: false, disabledSources: [] },
      session: { configured: false, disabledSources: [] },
      effectiveDisabledSources: [],
    })
    mocks.updatePromptFilter.mockResolvedValue({
      project: { configured: false, disabledSources: [] },
      session: { configured: false, disabledSources: [] },
      effectiveDisabledSources: [],
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: mocks.clipboardReadText,
        writeText: mocks.clipboardWriteText,
      },
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        <ChatConfigPanel
          embedded
          session={session}
          workspace={workspace}
          width={360}
          onWidthChange={vi.fn()}
        />,
      )
    })
    await flushPromises()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders the prompt injection filter section with grouped sources', async () => {
    // 新区块默认展开（自管 collapsed=false），注册表分组与锁定态随 PROMPT_INJECTION_SOURCES 渲染。
    const sectionTitles = Array.from(
      container.querySelectorAll('.config-panel-header .session-panel-toggle'),
    ).map((node) => node.textContent?.trim() ?? '')
    expect(sectionTitles.some((title) => title.includes('提示词注入'))).toBe(true)

    const groupTitles = Array.from(container.querySelectorAll('.prompt-filter-group-title')).map(
      (node) => node.textContent?.trim() ?? '',
    )
    // 分组顺序：MCP 能力域 → 项目上下文 → 技能目录 → 记忆 → 平台常驻段
    expect(groupTitles).toEqual([
      'MCP 能力域',
      '项目上下文',
      '技能目录',
      '记忆',
      '平台常驻段',
    ])

    // 锁定条目（核心行为准则）置灰展示且不可交互。
    const lockedRow = Array.from(container.querySelectorAll('.prompt-filter-row')).find((row) =>
      row.textContent?.includes('核心行为准则'),
    )
    expect(lockedRow).toBeDefined()
    const lockedSwitch = lockedRow?.querySelector('.ant-switch') as HTMLElement | null
    expect(lockedSwitch?.classList.contains('ant-switch-disabled')).toBe(true)
  })

  it('refreshes prompt filter with a full get after saving the project layer', async () => {
    // 回归：update 响应只含被写层（后端 refs 单层），保存项目层后必须重新 get
    // 完整双层态，否则会话层已接管时 sessionDraft 会被单层响应污染。
    const getCallsBefore = mocks.getPromptFilter.mock.calls.length
    act(() => findButton(container, '保存项目层').click())
    await flushPromises()
    expect(mocks.updatePromptFilter).toHaveBeenCalledWith({
      scope: 'project',
      scopeRef: 'workspace-1',
      disabledSources: [],
    })
    expect(mocks.getPromptFilter.mock.calls.length).toBeGreaterThan(getCallsBefore)
  })

  it('saves the session takeover layer with selected sources', async () => {
    // 开启接管（本地态）→ 勾选「记忆注入」→ 保存会话层。title 文案随状态切换：
    // 未接管显示「跟随项目」，接管后显示「本会话独立配置」。
    const followTitle = Array.from(container.querySelectorAll('.runtime-prompt-title')).find(
      (node) => node.textContent?.includes('跟随项目'),
    )
    expect(followTitle).toBeDefined()
    act(() => (followTitle?.querySelector('.ant-switch') as HTMLElement).click())
    await flushPromises()

    const sessionBlock = Array.from(container.querySelectorAll('.runtime-prompt-block')).find(
      (node) => node.textContent?.includes('保存会话层'),
    )
    const memoryRow = Array.from(
      sessionBlock?.querySelectorAll('.prompt-filter-row') ?? [],
    ).find((row) => row.textContent?.includes('记忆注入'))
    expect(memoryRow).toBeDefined()
    act(() => (memoryRow?.querySelector('.ant-switch') as HTMLElement).click())
    await flushPromises()

    act(() => findButton(container, '保存会话层').click())
    await flushPromises()
    expect(mocks.updatePromptFilter).toHaveBeenCalledWith({
      scope: 'session',
      scopeRef: 'session-1',
      disabledSources: ['inject:memory'],
    })
  })

  it('deletes the session layer row immediately when takeover is switched off', async () => {
    // 回归：关闭接管开关必须立即落盘删行（保存按钮随接管区隐藏，仅改本地态
    // 会让删行路径不可达，UI 显示「跟随项目」而 DB 行仍在）。
    const followTitle = Array.from(container.querySelectorAll('.runtime-prompt-title')).find(
      (node) => node.textContent?.includes('跟随项目'),
    )
    act(() => (followTitle?.querySelector('.ant-switch') as HTMLElement).click())
    await flushPromises()
    const takeoverTitle = Array.from(container.querySelectorAll('.runtime-prompt-title')).find(
      (node) => node.textContent?.includes('本会话独立配置'),
    )
    expect(takeoverTitle).toBeDefined()
    act(() => (takeoverTitle?.querySelector('.ant-switch') as HTMLElement).click())
    await flushPromises()
    expect(mocks.updatePromptFilter).toHaveBeenCalledWith({
      scope: 'session',
      scopeRef: 'session-1',
      disabledSources: undefined,
    })
  })

  it('exposes accessible section toggles and preserves drafts when collapsed', () => {
    const toggle = container.querySelector<HTMLButtonElement>('.session-panel-toggle')!
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    act(() => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.runtime-env-key')).toBeNull()
    act(() => toggle.click())
    expect(container.querySelector<HTMLInputElement>('.runtime-env-key')?.value).toBe('API_KEY')
    expect(container.querySelector<HTMLInputElement>('.runtime-env-value')?.value).toBe('secret')
    expect(mocks.updateEnvConfig).not.toHaveBeenCalled()
  })

  it('shows success feedback after explicit environment and prompt saves', async () => {
    const blocks = container.querySelectorAll('.runtime-prompt-block')
    const projectEnvBlock = blocks.item(0)
    const projectPromptBlock = blocks.item(2)

    act(() => findButton(projectEnvBlock, '保存项目').click())
    await flushPromises()

    expect(mocks.updateEnvConfig).toHaveBeenCalledWith({
      scope: 'project',
      scopeRef: 'workspace-1',
      value: {
        enabled: true,
        vars: [{ key: 'API_KEY', value: 'secret', description: 'access token' }],
      },
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('项目环境变量已保存')

    act(() => findButton(projectPromptBlock, '保存项目').click())
    await flushPromises()

    expect(mocks.updatePromptConfig).toHaveBeenCalledWith({
      scope: 'project',
      scopeRef: 'workspace-1',
      value: { enabled: true, content: 'project prompt' },
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('项目提示词已保存')
  })

  it('copies project variables as JSON and imports clipboard JSON into the same scope', async () => {
    const projectEnvBlock = container.querySelectorAll('.runtime-prompt-block').item(0)
    const copyButton = findButton(projectEnvBlock, '复制项目环境变量 JSON')
    const pasteButton = findButton(projectEnvBlock, '粘贴项目环境变量 JSON')

    expect(copyButton.classList.contains('icon-btn')).toBe(true)
    expect(copyButton.textContent?.trim()).toBe('')
    expect(pasteButton.classList.contains('icon-btn')).toBe(true)
    expect(pasteButton.textContent?.trim()).toBe('')

    act(() => copyButton.click())
    await flushPromises()
    // serializeEnvVarsJson 导出 EnvVarItem 数组格式（保留 key/value/description 字段，
    // 与 parseEnvVarsJson 对称），不是 { KEY: value } 扁平映射。
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith(
      JSON.stringify(
        [{ key: 'API_KEY', value: 'secret', description: 'access token' }],
        null,
        2,
      ),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith('已复制 1 个项目环境变量')

    mocks.clipboardReadText.mockResolvedValue('{"NEW_KEY":"new-value"}')
    act(() => pasteButton.click())
    await flushPromises()

    expect(mocks.updateEnvConfig).toHaveBeenLastCalledWith({
      scope: 'project',
      scopeRef: 'workspace-1',
      value: {
        enabled: true,
        vars: [{ key: 'NEW_KEY', value: 'new-value' }],
      },
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('已导入并保存 1 个项目环境变量')
  })

  it('imports native array JSON into the session scope independently', async () => {
    mocks.clipboardReadText.mockResolvedValue(
      '[{"key":"SESSION_TOKEN","value":"token","description":"session only"}]',
    )
    const sessionEnvBlock = container.querySelectorAll('.runtime-prompt-block').item(1)

    act(() => findButton(sessionEnvBlock, '粘贴会话环境变量 JSON').click())
    await flushPromises()

    expect(mocks.updateEnvConfig).toHaveBeenLastCalledWith({
      scope: 'session',
      scopeRef: 'session-1',
      value: {
        enabled: true,
        vars: [{ key: 'SESSION_TOKEN', value: 'token', description: 'session only' }],
      },
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('已导入并保存 1 个会话环境变量')
  })

  it('keeps the current draft when clipboard JSON is invalid', async () => {
    mocks.clipboardReadText.mockResolvedValue('{"PORT":3000}')
    const projectEnvBlock = container.querySelectorAll('.runtime-prompt-block').item(0)

    act(() => findButton(projectEnvBlock, '粘贴项目环境变量 JSON').click())
    await flushPromises()

    expect(mocks.updateEnvConfig).not.toHaveBeenCalled()
    expect(projectEnvBlock.querySelector<HTMLInputElement>('.runtime-env-key')?.value).toBe(
      'API_KEY',
    )
    expect(mocks.toast.error).toHaveBeenCalledWith('环境变量 PORT 的值必须是字符串')
  })

  it('shows the original error when an explicit save fails', async () => {
    mocks.updateEnvConfig.mockRejectedValueOnce(new Error('环境变量写入失败'))
    const projectEnvBlock = container.querySelectorAll('.runtime-prompt-block').item(0)

    act(() => findButton(projectEnvBlock, '保存项目').click())
    await flushPromises()

    expect(mocks.toast.error).toHaveBeenCalledWith('环境变量写入失败')
    expect(mocks.toast.success).not.toHaveBeenCalled()

    mocks.updatePromptConfig.mockRejectedValueOnce(new Error('提示词写入失败'))
    const projectPromptBlock = container.querySelectorAll('.runtime-prompt-block').item(2)
    act(() => findButton(projectPromptBlock, '保存项目').click())
    await flushPromises()

    expect(mocks.toast.error).toHaveBeenCalledWith('提示词写入失败')
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})

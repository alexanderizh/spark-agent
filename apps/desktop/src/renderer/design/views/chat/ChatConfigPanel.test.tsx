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
  clipboardReadText: vi.fn(),
  clipboardWriteText: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('@lobehub/ui', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: (channel: string) => ({
    invoke: {
      'prompt-config:get': mocks.getPromptConfig,
      'prompt-config:update': mocks.updatePromptConfig,
      'env-config:get': mocks.getEnvConfig,
      'env-config:update': mocks.updateEnvConfig,
    }[channel],
  }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
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
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('{\n  "API_KEY": "secret"\n}')
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

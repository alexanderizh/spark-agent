// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteSessionConfigPanel } from './RemoteSessionConfigPanel'
import {
  useRemoteSessionRuntimeConfig,
  type RemoteSessionRuntimeConfigState,
} from './useRemoteSessionRuntimeConfig'

const mockedUseRuntimeConfig = vi.mocked(useRemoteSessionRuntimeConfig)

/**
 * 远程配置面板 = 本地 ChatConfigPanel 的远程移植（2026-11-25）。
 * 这里锁定两条底线：
 *  1. 区块与类名与本地同款（session-panel-heading / inspector-section /
 *     runtime-env-row / inspector-textarea），不再出现自制的 rc-cfg-* 下拉版；
 *  2. 助手/模型/权限/推理力度四个下拉不在配置面板里（本地语义属于输入框参数栏）。
 */

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  savePrompt: vi.fn().mockResolvedValue(true),
  saveEnv: vi.fn().mockResolvedValue(true),
  saveFilter: vi.fn().mockResolvedValue(true),
  reload: vi.fn(),
}))

const configState: RemoteSessionRuntimeConfigState = {
  config: {
    workspaceId: 'workspace-1',
    prompt: {
      system: { enabled: true, content: 'sys' },
      agent: { enabled: false, content: '' },
      project: { enabled: true, content: 'project prompt' },
      session: { enabled: false, content: '' },
      effectivePrompt: 'sys',
    },
    env: {
      project: {
        enabled: true,
        vars: [{ key: 'PROJECT_KEY', value: '1', description: '项目变量' }],
      },
      session: { enabled: true, vars: [{ key: 'SESSION_KEY', value: '2' }] },
      effectiveEnv: { PROJECT_KEY: '1', SESSION_KEY: '2' },
    },
    filter: {
      project: { configured: false, disabledSources: [] },
      session: { configured: false, disabledSources: [] },
      effectiveDisabledSources: [],
    },
  },
  loading: false,
  saving: false,
  error: null,
  supported: true,
  savePrompt: mocks.savePrompt,
  saveEnv: mocks.saveEnv,
  saveFilter: mocks.saveFilter,
  reload: mocks.reload,
}

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))

vi.mock('./useRemoteSessionRuntimeConfig', () => ({
  useRemoteSessionRuntimeConfig: vi.fn(() => configState),
}))

vi.mock('./RemotePromptInjectionFilterSection', () => ({
  RemotePromptInjectionFilterSection: () => (
    <div data-testid="remote-prompt-filter" />
  ),
}))

vi.mock('./RemoteSessionHooksSection', () => ({
  RemoteSessionHooksSection: () => <div data-testid="remote-hooks" />,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('RemoteSessionConfigPanel（本地同款）', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    mockedUseRuntimeConfig.mockReturnValue(configState)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root.render(<RemoteSessionConfigPanel deviceId="device-1" sessionId="session-1" />)
    })
    await flushPromises()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders the local-parity heading, env rows, and prompt textareas', () => {
    // 本地同款头部与区块结构
    expect(container.querySelector('.session-panel-heading')?.textContent).toContain('配置面板')
    const sectionTitles = Array.from(
      container.querySelectorAll('.config-panel-header .session-panel-toggle'),
    ).map((node) => node.textContent?.trim() ?? '')
    expect(sectionTitles.some((title) => title.includes('环境变量'))).toBe(true)
    expect(sectionTitles.some((title) => title.includes('提示词'))).toBe(true)
    // 本地同款环境变量行：项目层 + 会话层各一行 KEY 输入
    const keys = Array.from(container.querySelectorAll('.runtime-env-key')).map(
      (node) => (node as HTMLInputElement).value,
    )
    expect(keys).toEqual(['PROJECT_KEY', 'SESSION_KEY'])
    // 本地同款提示词 textarea（spark-textarea inspector-textarea）
    const textareas = container.querySelectorAll('textarea.inspector-textarea')
    expect(textareas.length).toBe(2)
    expect((textareas[0] as HTMLTextAreaElement).value).toBe('project prompt')
    // 注入过滤 + Hooks 区块挂载
    expect(container.querySelector('[data-testid="remote-prompt-filter"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="remote-hooks"]')).not.toBeNull()
  })

  it('keeps runtime selects out of the config panel（助手/模型归输入框参数栏）', () => {
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).not.toContain('推理力度')
    expect(container.textContent).not.toContain('工具执行审批档位')
  })

  it('hides project-layer blocks for unassigned sessions（workspace=default 只留会话层）', async () => {
    const unassigned: RemoteSessionRuntimeConfigState = {
      ...configState,
      config: {
        ...configState.config!,
        workspaceId: 'default',
        prompt: {
          ...configState.config!.prompt,
          project: { enabled: false, content: '' },
        },
        env: {
          ...configState.config!.env,
          project: { enabled: true, vars: [] },
        },
      },
    }
    mockedUseRuntimeConfig.mockReturnValue(unassigned)
    await act(async () => {
      root.render(<RemoteSessionConfigPanel deviceId="device-1" sessionId="session-1" />)
    })
    await flushPromises()
    const keys = Array.from(container.querySelectorAll('.runtime-env-key')).map(
      (node) => (node as HTMLInputElement).value,
    )
    expect(keys).toEqual(['SESSION_KEY'])
    expect(container.querySelectorAll('textarea.inspector-textarea').length).toBe(1)
  })
})

// @vitest-environment jsdom

/**
 * GlobalQuickTaskModal（快捷录入弹窗）回归测试。
 *
 * 固化的核心契约：弹窗打开期间的表单状态（粘贴的图片附件、已选字段）不得被
 * 其他会话的活动重置。根因是重置 effect 曾把 resolveDefaults 放进依赖数组，
 * 而 resolveDefaults 随 sessionCtx.sessions 引用高频重建（任何会话输出的
 * agent 状态事件都会让 setSessions 产生新数组），导致弹窗内附件被清空。
 *
 * 依赖按现有测试惯例 mock（参照 wiki-settings-panel.test.tsx）：
 * @lobehub/ui / antd / Icons / ProjectSelect / BoardView 降级为轻量实现，
 * AppContext / SessionSidebarContext 用可控 holder 驱动重渲染。
 */

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 告知 React 当前处于 act 测试环境，否则每次 act() 都打印告警
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/* ── mock：@lobehub/ui 只用到 Button ── */
vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => React.createElement('button', { type: 'button', onClick, disabled }, children),
}))

/* ── mock：antd 控件降级为原生元素 ── */
vi.mock('antd', () => ({
  Select: () => React.createElement('div', { 'data-mock': 'antd-select' }),
  DatePicker: () => React.createElement('div', { 'data-mock': 'antd-date-picker' }),
}))

/* ── mock：图标降级，避免拉入整组 SVG ── */
vi.mock('../design/Icons', () => ({
  Icons: new Proxy(
    {},
    {
      get: (_target, prop: string) => () => React.createElement('i', { 'data-mock-icon': prop }),
    },
  ),
}))

/* ── mock：项目选择器降级 ── */
vi.mock('../design/components/ProjectSelect', () => ({
  ProjectSelect: () => React.createElement('div', { 'data-mock': 'project-select' }),
  projectValueToStorage: (value: string) => value,
}))

/* ── mock：BoardView 很重（拖入看板全量依赖），只保留类型与执行桩 ── */
vi.mock('../design/views/BoardView', () => ({
  executeTaskViaSession: vi.fn(async () => null),
}))

/* ── mock：AppContext.useApp ── */
vi.mock('../design/AppContext', () => ({
  useApp: () => ({
    t: { view: 'chat' },
    setTweak: vi.fn(),
  }),
}))

/* ── mock：SessionSidebarContext.useSessionSidebar 由 holder 驱动，
 *    测试通过替换 sessions 引用模拟「其他会话输出导致列表刷新」。 ── */
const sessionCtxHolder: {
  sessions: Array<{ id: string; agentId?: string }>
  selectableAgents: Array<{ id: string; name: string; enabled: boolean; isDefault?: boolean }>
  activeSessionId: string | null
  projectGroups: Array<{ workspace: { name: string; id: string } }>
  setActiveSession: ReturnType<typeof vi.fn>
} = {
  sessions: [],
  selectableAgents: [{ id: 'agent-1', name: 'Spark助手', enabled: true, isDefault: true }],
  activeSessionId: null,
  projectGroups: [],
  setActiveSession: vi.fn(),
}

vi.mock('../design/SessionSidebarContext', () => ({
  useSessionSidebar: () => sessionCtxHolder,
}))

import { GlobalQuickTaskModal } from '../design/components/GlobalQuickTaskModal'

async function flushAsync(ms = 16) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function dispatchPaste(target: Element) {
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: {
      items: [{ type: 'image/png', getAsFile: () => file }],
    },
  })
  // 粘贴链路（FileReader → IPC → setAttachments）是异步的，在 act 内让出事件队列，
  // 避免 React 状态更新落在 act 之外产生告警。
  await act(async () => {
    target.dispatchEvent(pasteEvent)
    await new Promise((resolve) => setTimeout(resolve, 16))
  })
}

describe('GlobalQuickTaskModal', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  const renderModal = () => {
    act(() => {
      root?.render(React.createElement(GlobalQuickTaskModal, { open: true, onClose: vi.fn() }))
    })
  }

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'file:save-pasted-image') {
        return { filePath: '/tmp/pasted-images/pasted-1.png', fileName: 'pasted-1.png' }
      }
      return {}
    })
    vi.stubGlobal('spark', { invoke, on: vi.fn(() => vi.fn()) })
    sessionCtxHolder.sessions = [{ id: 'session-a' }, { id: 'session-b' }]
    sessionCtxHolder.selectableAgents = [
      { id: 'agent-1', name: 'Spark助手', enabled: true, isDefault: true },
    ]
    sessionCtxHolder.activeSessionId = null
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('粘贴图片后其他会话输出（sessions 引用刷新）不得清空附件', async () => {
    await act(async () => {
      root = createRoot(container)
    })
    renderModal()
    await flushAsync()

    const textarea = container.querySelector('textarea.quick-task-input')
    expect(textarea).not.toBeNull()

    await dispatchPaste(textarea as Element)
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.quick-task-thumb')).toHaveLength(1)
    })

    // 模拟其他会话输出：agent 状态事件让 setSessions 产生新数组引用（内容不变）。
    // 旧实现中 resolveDefaults 随之重建并触发重置 effect，附件被清空。
    sessionCtxHolder.sessions = [{ id: 'session-a' }, { id: 'session-b' }]
    renderModal()
    await flushAsync()

    expect(container.querySelectorAll('.quick-task-thumb')).toHaveLength(1)

    // 连续多次引用刷新（流式输出期间事件密集）也必须保持稳定。
    sessionCtxHolder.sessions = [...sessionCtxHolder.sessions]
    renderModal()
    await flushAsync()

    expect(container.querySelectorAll('.quick-task-thumb')).toHaveLength(1)
    expect(invoke).toHaveBeenCalledWith('file:save-pasted-image', expect.anything())
  })

  it('open 重新置为 true 时仍会重置表单（保持打开时清空的既有语义）', async () => {
    await act(async () => {
      root = createRoot(container)
    })
    renderModal()
    await flushAsync()

    const textarea = container.querySelector('textarea.quick-task-input')
    await dispatchPaste(textarea as Element)
    await vi.waitFor(() => {
      expect(container.querySelectorAll('.quick-task-thumb')).toHaveLength(1)
    })

    // 关闭再打开：重新挂载 + open 上升沿，表单应被重置
    act(() => {
      root?.render(React.createElement(GlobalQuickTaskModal, { open: false, onClose: vi.fn() }))
    })
    renderModal()
    await flushAsync()

    expect(container.querySelectorAll('.quick-task-thumb')).toHaveLength(0)
  })
})

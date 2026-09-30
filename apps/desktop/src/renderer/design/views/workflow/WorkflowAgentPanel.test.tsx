// @vitest-environment jsdom

/**
 * WorkflowAgentPanel 换绑守卫测试（遮挡修复连带引入的常驻挂载保护）
 *
 * 面板常驻挂载后组件实例不再随开关销毁，sessionId 会跨工作流残留，
 * 因此新增换绑守卫。本测试固化两个方向：
 *  ① 用户切到另一条工作流 → 旧会话必须重置（否则上下文属于旧图）；
 *  ② AI 生成新工作流并切换过去 → 会话必须保留（首轮会话常建于落库前）。
 */
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowGraph } from '@spark/protocol'
import { WorkflowAgentPanel } from './WorkflowAgentPanel'
import type { WorkflowToolContext } from './workflow.tools'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  chatSessionId: null as string | null,
  onSend: null as null | ((text: string, attachments: never[]) => Promise<void>),
  toolContext: null as WorkflowToolContext | null,
}))

vi.mock('../../components/ChatPanel', () => ({
  ChatPanel: (props: {
    sessionId: string | null
    onSend: (text: string, attachments: never[]) => Promise<void>
  }) => {
    mocks.chatSessionId = props.sessionId
    mocks.onSend = props.onSend
    return React.createElement('div', { 'data-testid': 'chat' })
  },
}))

vi.mock('./workflow-tool-host', () => ({
  useWorkflowToolHost: (opts: { context: WorkflowToolContext }) => {
    mocks.toolContext = opts.context
    return { status: 'attached', error: null, ensureAttached: vi.fn(), reconnect: vi.fn() }
  },
}))

vi.mock('../../utils/provider-adapter', () => ({
  // 简化版真实语义：claude-sdk 优先、跨引擎回退 → 取渠道列表第一项（测试夹具即唯一渠道）
  getPreferredProviderWithAdapterFallback: (providers: unknown[]) => providers[0] ?? null,
  getProviderAdapterKind: () => 'claude-sdk',
}))

const EMPTY_GRAPH = { nodes: [], edges: [] } as unknown as WorkflowGraph
const editorStateOf = (workflowId: string | null) => ({
  workflowId,
  name: workflowId ?? '未命名工作流',
  graph: EMPTY_GRAPH,
})

const providers = [{ id: 'p-1', name: 'P1', enabled: true }] as never
const agents = [{ id: 'workflow-architect-agent', name: '工作流架构师' }] as never

describe('WorkflowAgentPanel 换绑守卫', () => {
  let container: HTMLDivElement
  let root: Root

  const renderPanel = (workflowId: string | null) => {
    act(() => {
      root.render(
        React.createElement(WorkflowAgentPanel, {
          open: true,
          onClose: () => {},
          editorState: editorStateOf(workflowId),
          providers,
          agents,
          onWorkflowCreated: () => {},
        }),
      )
    })
  }

  /** 走一次真实的首轮发送，让面板建立会话。 */
  const sendFirstTurn = async () => {
    await act(async () => {
      await mocks.onSend?.('做一个代码评审工作流', [] as never[])
    })
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    localStorage.clear()
    mocks.chatSessionId = null
    mocks.onSend = null
    mocks.toolContext = null
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'session:create') return Promise.resolve({ sessionId: 'sess-1' })
      if (channel === 'workflow:create') {
        return Promise.resolve({ workflow: { id: 'wf-new', updatedAt: '2026-09-25' } })
      }
      if (channel === 'session:submit-turn') return Promise.resolve({ turnId: 'turn-1' })
      return Promise.resolve({})
    })
    ;(window as unknown as { spark: { invoke: typeof mocks.invoke } }).spark = {
      invoke: mocks.invoke,
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('用户切到另一条工作流时重置会话', async () => {
    renderPanel('wf-a')
    await sendFirstTurn()
    expect(mocks.chatSessionId).toBe('sess-1')

    renderPanel('wf-b')
    expect(mocks.chatSessionId).toBeNull()
  })

  it('AI 生成新工作流并切换过去时保留会话', async () => {
    // 首轮发生在图尚未落库时（workflowId 为 null）
    renderPanel(null)
    await sendFirstTurn()
    expect(mocks.chatSessionId).toBe('sess-1')

    await act(async () => {
      await mocks.toolContext?.createWorkflow({ name: '新工作流', graph: EMPTY_GRAPH })
    })
    // createWorkflow 触发 onWorkflowCreated 认领新 id，随后编辑器切到新图
    renderPanel('wf-new')
    expect(mocks.chatSessionId).toBe('sess-1')
  })

  it('编辑器重建（切任务列表再回来）时从持久化恢复会话', async () => {
    renderPanel('wf-a')
    await sendFirstTurn()
    expect(mocks.chatSessionId).toBe('sess-1')

    // 模拟切到左侧任务列表：编辑器整个卸载，再回来是全新实例
    act(() => root.unmount())
    container.remove()
    const container2 = document.createElement('div')
    document.body.appendChild(container2)
    const root2 = createRoot(container2)
    act(() => {
      root2.render(
        React.createElement(WorkflowAgentPanel, {
          open: true,
          onClose: () => {},
          editorState: editorStateOf('wf-a'),
          providers,
          agents,
          onWorkflowCreated: () => {},
        }),
      )
    })
    expect(mocks.chatSessionId).toBe('sess-1')
    act(() => root2.unmount())
    container2.remove()
  })

  it('编辑器异步装载（首帧 workflowId 为 null）时仍恢复持久化会话', async () => {
    renderPanel('wf-a')
    await sendFirstTurn()
    expect(mocks.chatSessionId).toBe('sess-1')

    // 模拟切到任务列表再回来：编辑器视图整个重建。与上一个用例不同，
    // 真实重建时 WorkflowView 的 activeId 异步装载——首帧 editorState.workflowId
    // 为 null，workflow:list 返回后才 rerender 真实 id（2026-09-25 GUI 实测暴露）。
    act(() => root.unmount())
    container.remove()
    const container2 = document.createElement('div')
    document.body.appendChild(container2)
    const root2 = createRoot(container2)
    act(() => {
      root2.render(
        React.createElement(WorkflowAgentPanel, {
          open: true,
          onClose: () => {},
          editorState: editorStateOf(null),
          providers,
          agents,
          onWorkflowCreated: () => {},
        }),
      )
    })
    expect(mocks.chatSessionId).toBeNull()
    act(() => {
      root2.render(
        React.createElement(WorkflowAgentPanel, {
          open: true,
          onClose: () => {},
          editorState: editorStateOf('wf-a'),
          providers,
          agents,
          onWorkflowCreated: () => {},
        }),
      )
    })
    // 持久化会话不能随首帧 null 被永久丢弃
    expect(mocks.chatSessionId).toBe('sess-1')
    act(() => root2.unmount())
    container2.remove()
  })

  it('面板关闭时不渲染对话区，但组件实例保活（会话不丢）', async () => {
    renderPanel('wf-a')
    await sendFirstTurn()
    expect(mocks.chatSessionId).toBe('sess-1')

    act(() => {
      root.render(
        React.createElement(WorkflowAgentPanel, {
          open: false,
          onClose: () => {},
          editorState: editorStateOf('wf-a'),
          providers,
          agents,
          onWorkflowCreated: () => {},
        }),
      )
    })
    expect(container.querySelector('[data-testid="chat"]')).toBeNull()

    // 重新打开：同一工作流，会话应原样恢复（常驻挂载的核心收益）
    renderPanel('wf-a')
    expect(mocks.chatSessionId).toBe('sess-1')
  })
})

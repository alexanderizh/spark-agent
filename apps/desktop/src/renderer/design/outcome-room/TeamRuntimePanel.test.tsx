// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliberationSnapshot, SessionId, TaskGraphSnapshot } from '@spark/protocol'
import { TeamRuntimePanel } from './TeamRuntimePanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const graph: TaskGraphSnapshot = {
  sessionId,
  discussionId: 'discussion-1',
  nodes: [{
    id: 'node-1', sessionId, roomId: 'room-1', discussionId: 'discussion-1', title: '实现运行时面板', description: '展示任务依赖与执行状态。', status: 'failed', assigneeId: 'agent-1',
    inputs: {}, outputs: {}, acceptanceStatus: 'pending', retryCount: 1, maxRetries: 3, version: 4,
    createdAt: '2026-08-13T01:00:00.000Z', updatedAt: '2026-08-13T01:01:00.000Z',
  }],
  edges: [{ id: 'edge-1', sessionId, roomId: 'room-1', discussionId: 'discussion-1', fromNodeId: 'node-0', toNodeId: 'node-1', type: 'dependency', version: 1, createdAt: '2026-08-13T01:00:00.000Z' }],
  syncedAt: '2026-08-13T01:02:00.000Z',
}
const deliberation: DeliberationSnapshot = {
  sessionId, discussionId: 'discussion-1', conflicts: [], syncedAt: '2026-08-13T01:02:00.000Z', records: [{
    id: 'proposal-1', sessionId, roomId: 'room-1', discussionId: 'discussion-1', topic: '是否启用任务图',
    proposal: { claim: '启用任务图可追踪依赖。', position: 'support', rationale: '减少隐式阻塞。' }, evidence: [], alternatives: [], risks: [],
    decision: null, ownerId: 'user-1', deadline: '2026-08-14T01:00:00.000Z', status: 'proposed', capability: 'user', conflict: null,
    version: 2, createdAt: '2026-08-13T01:00:00.000Z', updatedAt: '2026-08-13T01:01:00.000Z',
  }],
}

describe('TeamRuntimePanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => Promise.resolve(channel === 'task-graph:get' ? graph : deliberation))
    Object.defineProperty(window, 'spark', { configurable: true, value: { invoke } })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('renders task graph dependencies and exposes CAS retry/reassign actions', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<TeamRuntimePanel sessionId={sessionId} />)
    })
    expect(container.querySelector('[data-task-graph]')).not.toBeNull()
    expect(container.textContent).toContain('前置')
    expect(container.textContent).toContain('实现运行时面板')
    const retry = container.querySelector<HTMLButtonElement>('[aria-label="重试任务 实现运行时面板"]')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    const request = invoke.mock.calls.find(([channel]) => channel === 'task-graph:mutate')?.[1]
    expect(request).toMatchObject({ action: 'retry', id: 'node-1', expectedVersion: 4, expectedDiscussionId: 'discussion-1' })
  })

  it('switches to deliberation and renders governance actions', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<TeamRuntimePanel sessionId={sessionId} />)
    })
    await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')?.click())
    expect(container.querySelector('[data-deliberation]')).not.toBeNull()
    expect(container.textContent).toContain('是否启用任务图')
    const support = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '支持')
    expect(support).not.toBeUndefined()
    await act(async () => support?.click())
    const request = invoke.mock.calls.find(([channel]) => channel === 'deliberation:mutate')?.[1]
    expect(request).toMatchObject({ action: 'vote', id: 'proposal-1', expectedVersion: 2, expectedDiscussionId: 'discussion-1' })
  })

  it('shows loading, empty and conflict states with recovery controls', async () => {
    let resolve: ((value: unknown) => void) | undefined
    invoke.mockImplementation(() => new Promise((nextResolve) => { resolve = nextResolve }))
    await act(async () => {
      root = createRoot(container)
      root.render(<TeamRuntimePanel sessionId={sessionId} />)
    })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => resolve?.({ ...graph, nodes: [], edges: [] }))
    expect(container.textContent).toContain('暂无任务节点')
  })
})

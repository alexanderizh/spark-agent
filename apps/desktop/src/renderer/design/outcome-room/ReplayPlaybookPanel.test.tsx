// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { ReplayIpcSchemaRegistry } from '@spark/protocol'
import { ReplayPlaybookPanel } from './ReplayPlaybookPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId

const response = {
  timeline: { sessionId, discussionId: 'discussion-1', events: [{ id: 'event-1', sessionId, roomId: 'room', discussionId: 'discussion-1', sourceType: 'task', sourceId: 'task-1', seq: 1, time: '2026-08-14T00:00:00.000Z', actor: 'agent-a', action: 'started', before: null, after: {}, evidenceRefs: [] }], cursor: null, nextCursor: null, status: 'available' as const, syncedAt: '2026-08-14T00:00:00.000Z' },
}
const playbook = { id: 'playbook-1', sessionId, roomId: 'room', discussionId: 'discussion-1', version: 1, status: 'proposed' as const, name: 'Release flow', graph: {}, roles: {}, handoffRules: {}, gateRules: {}, deliberationRules: {}, createdBy: 'agent-a', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' }

describe('ReplayPlaybookPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke.mockReset()
    invoke.mockImplementation((channel: string, request: Record<string, unknown>) => {
      if (channel === 'replay:fork') ReplayIpcSchemaRegistry['replay:fork'].parse(request)
      if (channel === 'playbook:mutate') ReplayIpcSchemaRegistry['playbook:mutate'].parse(request)
      return channel === 'replay:timeline' ? Promise.resolve(response) : channel === 'playbook:list' ? Promise.resolve({ playbook, versions: [playbook], applications: [] }) : Promise.resolve({ playbook })
    })
    Object.defineProperty(window, 'spark', { configurable: true, value: { invoke } })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('renders replay events, cursor/branch controls and playbook governance actions', async () => {
    await act(async () => { root = createRoot(container); root.render(<ReplayPlaybookPanel sessionId={sessionId} discussionId="discussion-1" activePlaybookId="playbook-1" />) })
    expect(container.querySelector('[data-replay-timeline]')).not.toBeNull()
    expect(container.textContent).toContain('started')
    expect(container.textContent).toContain('创建分支')
    expect(container.textContent).toContain('发布')
    expect(container.textContent).toContain('部分数据')
    const publish = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('发布'))
    publish?.focus()
    expect(document.activeElement).toBe(publish)
    await act(async () => { publish?.click() })
    expect(invoke.mock.calls.find(([channel]) => channel === 'playbook:mutate')?.[1]).toMatchObject({ action: 'publish', expectedVersion: 1, expectedDiscussionId: 'discussion-1' })
  })

  it('sends propose, apply, and fork payloads accepted by the strict IPC schemas', async () => {
    await act(async () => { root = createRoot(container); root.render(<ReplayPlaybookPanel sessionId={sessionId} discussionId="discussion-1" activePlaybookId="playbook-1" />) })
    const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes(label))
    await act(async () => { button('提议')?.click() })
    await act(async () => { button('应用')?.click() })
    await act(async () => { button('创建分支')?.click() })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'playbook:mutate').map(([, request]) => request)).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'propose', name: 'Release flow', graph: {}, roles: {}, handoffRules: {}, gateRules: {}, deliberationRules: {} }),
      expect.objectContaining({ action: 'apply', targetDiscussionId: 'discussion-1' }),
    ]))
    expect(invoke.mock.calls.find(([channel]) => channel === 'replay:fork')?.[1]).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('shows permission and conflict feedback, plus empty and unknown data states', async () => {
    await act(async () => { root = createRoot(container); root.render(<ReplayPlaybookPanel sessionId={sessionId} discussionId="discussion-1" activePlaybookId="playbook-1" canPropose={false} canGovern={false} />) })
    expect(container.textContent).toContain('当前角色无治理权限')
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('发布'))?.disabled).toBe(true)
    await act(async () => { root?.render(<ReplayPlaybookPanel sessionId={sessionId} discussionId="discussion-1" activePlaybookId="playbook-1" />) })
    invoke.mockImplementation((channel: string) => channel === 'replay:timeline' ? Promise.resolve({ timeline: { ...response.timeline, events: [], nextCursor: null, status: 'empty' } }) : Promise.reject(new Error('Expected current playbook version 1, current version is 2')))
    await act(async () => { await container.querySelector<HTMLButtonElement>('button[aria-label="重新加载 Replay 与 Playbook"]')?.click() })
    expect(container.textContent).toContain('暂无 Replay 事件')
    expect(container.textContent).toContain('数据版本冲突')
    expect(container.textContent).toContain('current version is 2')
  })
})

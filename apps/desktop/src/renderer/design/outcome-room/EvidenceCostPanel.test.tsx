// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { EvidenceCostPanel } from './EvidenceCostPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const baseSnapshot = {
  sessionId, roomId: 'team-room:session', discussionId: 'discussion-1',
  evidence: [{ id: 'evidence-1', claim: '接口返回可追溯证据', links: [{ type: 'task', id: 'task-1' }], source: { type: 'test', ref: 'evidence-cost.test.ts' }, version: null, summary: '测试覆盖来源与状态。', hash: null, status: 'unknown' as const, verifiedBy: null, verifiedAt: null, createdBy: 'agent-1', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z', versionNumber: 1 }],
  costs: [{ id: 'cost-1', taskId: 'task-1', agentId: 'agent-1', dispatchId: null, tokens: null, amount: null, currency: null, latencyMs: null, status: 'unknown' as const, source: 'runtime', createdAt: '2026-08-14T00:00:00.000Z' }],
  aggregates: [{ dimension: 'task' as const, key: 'task-1', tokens: null, amount: null, latencyMs: null, eventCount: 1, unknown: true }],
  budgetTokens: 100, budgetAmount: null, budgetCurrency: null, syncedAt: '2026-08-14T00:00:00.000Z',
}

describe('EvidenceCostPanel', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke.mockReset()
    invoke.mockImplementation((channel: string) => channel === 'evidence-cost:get' ? Promise.resolve(baseSnapshot) : Promise.resolve(baseSnapshot))
    Object.defineProperty(window, 'spark', { configurable: true, value: { invoke } })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('renders evidence provenance, unknown cost warning, and governance action', async () => {
    await act(async () => { root = createRoot(container); root.render(<EvidenceCostPanel sessionId={sessionId} discussionId="discussion-1" />) })
    expect(container.querySelector('[data-evidence-list]')).not.toBeNull()
    expect(container.textContent).toContain('接口返回可追溯证据')
    expect(container.textContent).toContain('测试')
    expect(container.textContent).toContain('含未知')
    expect(container.textContent).toContain('部分成本缺少可计量数据')
    await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('核验'))?.click())
    expect(invoke.mock.calls.find(([channel]) => channel === 'evidence-cost:mutate')?.[1]).toMatchObject({ id: 'evidence-1', expectedVersion: 1, expectedDiscussionId: 'discussion-1' })
  })

  it('shows loading and precise conflict recovery state', async () => {
    let reject: ((reason: Error) => void) | undefined
    invoke.mockImplementation(() => new Promise((_, rejectPromise) => { reject = rejectPromise }))
    await act(async () => { root = createRoot(container); root.render(<EvidenceCostPanel sessionId={sessionId} discussionId="discussion-1" />) })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => reject?.(new Error('Expected evidence version 1, current version is 2')))
    expect(container.textContent).toContain('数据版本冲突')
    expect(container.textContent).toContain('Expected evidence version 1')
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.includes('重试'))).toBe(true)
  })

  it('shows the empty state and keeps refresh/actions keyboard reachable', async () => {
    invoke.mockImplementation((channel: string) => channel === 'evidence-cost:get'
      ? Promise.resolve({ ...baseSnapshot, evidence: [], costs: [], aggregates: [], budgetTokens: null })
      : Promise.resolve(baseSnapshot))
    await act(async () => { root = createRoot(container); root.render(<EvidenceCostPanel sessionId={sessionId} discussionId="discussion-1" />) })
    expect(container.textContent).toContain('当前尚未记录证据或成本')
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="重新加载证据与成本"]')
    expect(refresh).not.toBeNull()
    refresh?.focus()
    expect(document.activeElement).toBe(refresh)
  })

  it('preserves the panel theme hooks and responsive layout contract', async () => {
    document.documentElement.dataset.theme = 'dark'
    await act(async () => { root = createRoot(container); root.render(<EvidenceCostPanel sessionId={sessionId} discussionId="discussion-1" />) })
    const panel = container.querySelector<HTMLElement>('[data-evidence-cost-panel]')
    expect(panel).not.toBeNull()
    expect(panel?.className).toContain('evidence-cost-panel')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(container.querySelector('[data-cost-list]')).not.toBeNull()
  })
})

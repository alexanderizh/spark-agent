// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionGetQueueResponse, SessionQueuedTurn } from '@spark/protocol'
import { RemoteQueuePanel } from './RemoteQueuePanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('RemoteQueuePanel', () => {
  let container: HTMLDivElement
  let root: Root

  const onClear = vi.fn()
  const onEdit = vi.fn()
  const onSendNow = vi.fn()
  const onRemove = vi.fn()
  const onReorder = vi.fn()

  const renderPanel = (snapshot: SessionGetQueueResponse | null) => {
    act(() =>
      root.render(
        <RemoteQueuePanel
          snapshot={snapshot}
          onClear={onClear}
          onEdit={onEdit}
          onSendNow={onSendNow}
          onRemove={onRemove}
          onReorder={onReorder}
        />,
      ),
    )
  }

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClear.mockClear()
    onEdit.mockClear()
    onSendNow.mockClear()
    onRemove.mockClear()
    onReorder.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const userTurn = (turnId: string, message: string): SessionQueuedTurn => ({
    turnId,
    message,
    enqueuedAt: '2026-11-25T00:00:00.000Z',
  })

  it('redacts hidden internal prompt text and keeps the panel actionable', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    renderPanel({
      sessionId,
      running: true,
      queuedTurns: [
        userTurn('t1', 'Visible follow-up'),
        {
          turnId: 't2',
          message: 'secret internal prompt',
          enqueuedAt: '2026-11-25T00:01:00.000Z',
          userMessageVisibility: 'hidden',
        },
      ],
    })

    expect(container.textContent).toContain('Visible follow-up')
    expect(container.textContent).toContain('内部任务自动执行')
    expect(container.textContent).not.toContain('secret internal prompt')

    // 可见轮：编辑 / 立即执行 / 移除齐全（复用本地 QueuedTaskList 的按钮组）
    expect(container.querySelectorAll('.composer-queue-item').length).toBe(2)
    // hidden 内部轮没有编辑按钮：编辑按钮总数 = 可编辑轮数
    expect(container.querySelectorAll('.composer-queue-edit-btn').length).toBe(1)
  })

  it('dispatches edit / send-now / remove callbacks with the matching turn', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    renderPanel({
      sessionId,
      running: true,
      queuedTurns: [userTurn('t1', 'follow-up A'), userTurn('t2', 'follow-up B')],
    })

    const items = container.querySelectorAll('.composer-queue-item')
    expect(items.length).toBe(2)

    const editBtn = items[0]?.querySelector('.composer-queue-edit-btn')
    expect(editBtn).not.toBeNull()
    act(() => editBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0]?.[0]?.turnId).toBe('t1')

    const sendBtn = items[1]?.querySelector('.composer-queue-send-btn')
    expect(sendBtn).not.toBeNull()
    act(() => sendBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSendNow).toHaveBeenCalledTimes(1)
    expect(onSendNow.mock.calls[0]?.[0]?.turnId).toBe('t2')

    const removeBtns = container.querySelectorAll('.composer-queue-item button')
    // 移除按钮是每条最后一个 icon button（title=移除）
    const trashBtn = Array.from(items[1]?.querySelectorAll('button') ?? []).find(
      (btn) => btn.getAttribute('title') === '移除',
    )
    expect(trashBtn).not.toBeUndefined()
    expect(removeBtns.length).toBeGreaterThan(0)
    act(() => trashBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onRemove.mock.calls[0]?.[0]?.turnId).toBe('t2')
  })

  it('offers clear-all when more than one turn is queued and hides it otherwise', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    renderPanel({
      sessionId,
      running: true,
      queuedTurns: [userTurn('t1', 'a'), userTurn('t2', 'b')],
    })
    const clearBtn = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.getAttribute('aria-label') === '清空队列',
    )
    expect(clearBtn).not.toBeUndefined()
    act(() => clearBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClear).toHaveBeenCalledTimes(1)

    act(() => root.unmount())
    root = createRoot(container)
    renderPanel({ sessionId, running: true, queuedTurns: [userTurn('t1', 'a')] })
    expect(
      Array.from(container.querySelectorAll('button')).find(
        (btn) => btn.getAttribute('aria-label') === '清空队列',
      ),
    ).toBeUndefined()
  })

  it('surfaces the paused badge while the queue is error-paused', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    renderPanel({
      sessionId,
      running: false,
      queuedTurns: [userTurn('t1', 'a')],
      paused: { reason: 'turn_error', pausedAt: '2026-11-25T00:02:00.000Z' },
    })
    expect(container.querySelector('.rc-queue-paused')?.textContent).toBe('队列已暂停')
  })

  it('renders nothing when there are no queued turns', () => {
    const sessionId = 's1' as SessionGetQueueResponse['sessionId']
    renderPanel({ sessionId, running: true, queuedTurns: [] })
    expect(container.querySelector('.rc-queue-panel')).toBeNull()
  })
})

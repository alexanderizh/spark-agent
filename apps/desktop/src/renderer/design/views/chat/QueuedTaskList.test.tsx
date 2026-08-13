// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedMessage } from './ChatComposerTypes'
import { QueuedTaskList } from './QueuedTaskList'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function queuedMessage(turnId: string): QueuedMessage {
  return {
    id: turnId,
    turnId,
    content: `任务 ${turnId}`,
    enqueuedAt: '2026-08-14T00:00:00.000Z',
    attachments: [],
    sessionReferences: [],
    editable: true,
  }
}

describe('QueuedTaskList', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps a single queued task compact without rendering the panel header', () => {
    act(() => {
      root.render(
        <QueuedTaskList
          messages={[queuedMessage('turn-1')]}
          clearing={false}
          reordering={false}
          onClear={vi.fn()}
          onEdit={vi.fn()}
          onSendNow={vi.fn()}
          onRemove={vi.fn()}
          onReorder={vi.fn()}
        />,
      )
    })

    expect(container.querySelector('.composer-queue-header')).toBeNull()
    expect(container.querySelector('.composer-queue-hint')).toBeNull()
    expect(container.querySelectorAll('.composer-queue-drag-handle')).toHaveLength(1)
  })

  it('shows the batch clear action and one drag handle per task for multiple tasks', () => {
    act(() => {
      root.render(
        <QueuedTaskList
          messages={[queuedMessage('turn-1'), queuedMessage('turn-2')]}
          clearing={false}
          reordering={false}
          onClear={vi.fn()}
          onEdit={vi.fn()}
          onSendNow={vi.fn()}
          onRemove={vi.fn()}
          onReorder={vi.fn()}
        />,
      )
    })

    expect(container.querySelector('.composer-queue-header')).not.toBeNull()
    expect(container.querySelector('.composer-queue-hint')?.textContent).toBe('拖动调整执行顺序')
    expect(container.textContent).toContain('清空队列')
    expect(container.querySelectorAll('.composer-queue-drag-handle')).toHaveLength(2)
  })
})

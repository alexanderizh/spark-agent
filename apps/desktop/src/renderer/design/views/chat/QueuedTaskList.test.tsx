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
    runtime: { providerProfileId: 'provider-1', modelId: 'model-1' },
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
          paused={null}
          recovering={null}
          canRetry={false}
          onClear={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
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
          paused={null}
          recovering={null}
          canRetry={false}
          onClear={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
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
    expect(container.querySelectorAll('.composer-queue-model')).toHaveLength(2)
  })

  it('shows the error pause actions and invokes retry or skip explicitly', () => {
    const onRetry = vi.fn()
    const onResume = vi.fn()
    act(() => {
      root.render(
        <QueuedTaskList
          messages={[queuedMessage('turn-1')]}
          clearing={false}
          reordering={false}
          paused={{
            reason: 'turn_error',
            failedTurnId: 'turn-failed',
            pausedAt: '2026-09-05T00:00:00.000Z',
          }}
          recovering={null}
          canRetry
          onClear={vi.fn()}
          onRetry={onRetry}
          onResume={onResume}
          onEdit={vi.fn()}
          onSendNow={vi.fn()}
          onRemove={vi.fn()}
          onReorder={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('当前回复出错，队列已暂停（内容未丢失）')
    const actions = container.querySelectorAll<HTMLButtonElement>('.composer-queue-pause-action')
    act(() => actions[0]?.click())
    act(() => actions[1]?.click())
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onResume).toHaveBeenCalledOnce()
  })

  it('shows the effective Spark model for local CLI queued turns', () => {
    const message = queuedMessage('turn-cli')
    message.runtime = {
      providerProfileId: 'local-cli',
      modelId: 'host-model',
      cliSparkOverride: { providerProfileId: 'spark-provider', modelId: 'spark-model' },
    }
    act(() => {
      root.render(
        <QueuedTaskList
          messages={[message]}
          clearing={false}
          reordering={false}
          paused={null}
          recovering={null}
          canRetry={false}
          onClear={vi.fn()}
          onRetry={vi.fn()}
          onResume={vi.fn()}
          onEdit={vi.fn()}
          onSendNow={vi.fn()}
          onRemove={vi.fn()}
          onReorder={vi.fn()}
        />,
      )
    })

    expect(container.querySelector('.composer-queue-model')?.textContent).toBe('spark-model')
    expect(container.querySelector('.composer-queue-model')?.getAttribute('title')).toBe(
      'Provider：spark-provider · 模型：spark-model',
    )
  })
})

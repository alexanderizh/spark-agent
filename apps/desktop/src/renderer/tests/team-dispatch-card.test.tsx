// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamA2ATask } from '@spark/protocol'
import { TeamDispatchCard } from '../design/components/TeamDispatchCard'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../design/avatar', () => ({
  getAvatarFallback: () => ({
    background: 'linear-gradient(135deg, #3b82f6, #14b8a6)',
  }),
}))

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('TeamDispatchCard', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
  })

  it('renders team dispatch tasks as an avatar-led collapsible task panel', () => {
    const task: TeamA2ATask = {
      taskId: 'task-1',
      hostAgentId: 'host',
      memberAgentId: 'reviewer',
      rootTurnId: 'turn-1',
      instruction: 'Review the canvas migration files and report blockers.',
      attachments: [
        {
          type: 'file_ref',
          value: 'apps/desktop/src/renderer/design/views/canvas/CanvasNode.tsx',
        },
      ],
    }

    act(() => {
      root = createRoot(container)
      root.render(<TeamDispatchCard task={task} memberName="Reviewer" state="working" />)
    })

    expect(container.querySelector('.team-dispatch-card-avatar .spark-avatar-fallback')).not.toBeNull()
    expect(container.querySelector('.team-dispatch-task-panel')).not.toBeNull()
    expect(container.textContent).toContain('Reviewer')
    expect(container.textContent).toContain('收到任务')
    expect(container.textContent).toContain(task.instruction)

    act(() => {
      root?.render(<TeamDispatchCard task={task} memberName="Reviewer" state="completed" />)
    })

    expect(container.querySelector('.team-dispatch-task-panel')).toBeNull()

    const head = container.querySelector<HTMLButtonElement>('.team-dispatch-card-head')
    expect(head).not.toBeNull()

    act(() => {
      if (head == null) throw new Error('Dispatch card head missing')
      click(head)
    })

    expect(container.querySelector('.team-dispatch-task-panel')).not.toBeNull()
  })
})

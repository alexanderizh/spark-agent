// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InspectorTask } from './ChatInspectorUtils'
import { SessionTaskPanel } from './SessionTaskPanel'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const tasks: InspectorTask[] = [
  { id: '1', subject: '定位数据链路', status: 'completed', createdAt: 0 },
  {
    id: '2',
    subject: '实现会话任务面板',
    activeForm: '正在实现会话任务面板',
    description: '共享检查器任务快照',
    status: 'in_progress',
    createdAt: 1,
  },
  { id: '3', subject: '完成界面验证', status: 'pending', createdAt: 2 },
]

describe('SessionTaskPanel', () => {
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

  it('renders the shared task statuses as a flat in-session panel', () => {
    act(() => root.render(<SessionTaskPanel tasks={tasks} />))

    expect(container.querySelector('[aria-label="Agent 任务进度"]')).not.toBeNull()
    expect(container.querySelector('.block-traffic-header')).not.toBeNull()
    expect(container.querySelectorAll('.md-code-dot')).toHaveLength(3)
    expect(container.querySelectorAll('.session-task-panel-item')).toHaveLength(3)
    expect(container.textContent).toContain('进行中')
    expect(container.textContent).toContain('1/3')
    expect(container.textContent).toContain('正在实现会话任务面板')
    expect(container.textContent).toContain('共享检查器任务快照')
    expect(container.querySelector('[aria-current="step"]')).not.toBeNull()
    expect(
      container.querySelector('.session-task-panel-item.is-pending .lucide-circle'),
    ).not.toBeNull()
    expect(
      container.querySelector('.session-task-panel-item.is-pending .lucide-circle-x'),
    ).toBeNull()
  })

  it('renders nothing when the shared extractor has no tasks', () => {
    act(() => root.render(<SessionTaskPanel tasks={[]} />))
    expect(container.childElementCount).toBe(0)
  })
})

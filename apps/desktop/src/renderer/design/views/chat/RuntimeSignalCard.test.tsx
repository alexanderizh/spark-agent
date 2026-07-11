// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { RuntimeSignalCard } from './RuntimeSignalCard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type RuntimeSignalBlock = Extract<UIBlock, { kind: 'runtime_signal' }>

describe('RuntimeSignalCard', () => {
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

  it('renders the latest background task snapshot as a compact expandable card', () => {
    const block: RuntimeSignalBlock = {
      kind: 'runtime_signal',
      signal: 'background_tasks',
      level: 'info',
      title: '后台任务正在运行',
      message: '3 个后台任务仍在运行。',
      code: 'CLAUDE_BACKGROUND_TASKS_CHANGED',
      retryable: false,
      details: [
        { label: '运行中', value: '3' },
        { label: '任务', value: '检查会话面板; 检查画布地图; 检查节点系统' },
      ],
    }

    act(() => root.render(<RuntimeSignalCard block={block} />))

    expect(container.textContent).toContain('后台任务')
    expect(container.textContent).toContain('3 项运行中')
    expect(container.textContent).toContain('检查会话面板 · 检查画布地图 · +1')
    expect(container.textContent).not.toContain('CLAUDE_BACKGROUND_TASKS_CHANGED')
    expect(container.querySelectorAll('.background-tasks-card-task')).toHaveLength(0)

    const header = container.querySelector<HTMLElement>('[role="button"]')
    act(() => header?.click())

    expect(container.querySelectorAll('.background-tasks-card-task')).toHaveLength(3)
    expect(header?.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps other runtime signals on the actionable diagnostic card', () => {
    const block: RuntimeSignalBlock = {
      kind: 'runtime_signal',
      signal: 'rate_limit',
      level: 'warning',
      title: '额度即将用尽',
      message: '当前窗口已使用 92%。',
      code: 'CLAUDE_RATE_LIMIT_WARNING',
      retryable: false,
    }

    act(() => root.render(<RuntimeSignalCard block={block} />))

    expect(container.querySelector('.streaming-error-card')).not.toBeNull()
    expect(container.textContent).toContain('CLAUDE_RATE_LIMIT_WARNING')
  })

  it('renders the completed snapshot without an expandable empty section', () => {
    const block: RuntimeSignalBlock = {
      kind: 'runtime_signal',
      signal: 'background_tasks',
      level: 'info',
      title: '后台任务已结束',
      message: '当前没有运行中的后台任务。',
      code: 'CLAUDE_BACKGROUND_TASKS_CHANGED',
      retryable: false,
      details: [{ label: '运行中', value: '0' }],
    }

    act(() => root.render(<RuntimeSignalCard block={block} />))

    expect(container.textContent).toContain('所有后台任务均已结束')
    expect(container.textContent).toContain('已结束')
    expect(container.querySelector('[role="button"]')).toBeNull()
    expect(container.querySelector('.background-tasks-card-detail')).toBeNull()
  })
})

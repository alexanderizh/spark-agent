// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { useAssistantTurnCollapse } from './useAssistantTurnCollapse'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const blocks: UIBlock[] = [
  { kind: 'text', content: '过程正文', isStreaming: false },
  { kind: 'text', content: '最终总结', isStreaming: false, isFinalAnswer: true },
]

function Harness({ status }: { status: UIMessage['status'] }) {
  const collapse = useAssistantTurnCollapse(status, blocks)
  return (
    <button
      data-state={collapse.expanded ? 'expanded' : 'collapsed'}
      onClick={collapse.toggleExpanded}
    >
      {collapse.visibleBlocks
        .filter((block) => block.kind === 'text')
        .map((block) => block.content)
        .join('|')}
    </button>
  )
}

describe('useAssistantTurnCollapse', () => {
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

  it('collapses exactly when the turn becomes completed and preserves manual expansion', () => {
    act(() => root.render(<Harness status="streaming" />))
    expect(container.querySelector('button')?.dataset.state).toBe('expanded')
    expect(container.textContent).toBe('过程正文|最终总结')

    act(() => root.render(<Harness status="completed" />))
    expect(container.querySelector('button')?.dataset.state).toBe('collapsed')
    expect(container.textContent).toBe('最终总结')

    act(() => container.querySelector('button')?.click())
    expect(container.querySelector('button')?.dataset.state).toBe('expanded')
    expect(container.textContent).toBe('过程正文|最终总结')

    act(() => root.render(<Harness status="completed" />))
    expect(container.querySelector('button')?.dataset.state).toBe('expanded')
  })
})

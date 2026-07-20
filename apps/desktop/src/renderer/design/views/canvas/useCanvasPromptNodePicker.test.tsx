// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { useCanvasPromptNodePicker } from './useCanvasPromptNodePicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ownerNode = node('owner', '任务节点')
const sourceNode = node('source', '参考节点')

function node(id: string, title: string): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    title,
    assetId: null,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: { text: title },
    createdAt: '',
    updatedAt: '',
  }
}

describe('useCanvasPromptNodePicker', () => {
  it('keeps the operation panel selected and consumes one canvas node click', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const onPick = vi.fn()
    let picker!: ReturnType<typeof useCanvasPromptNodePicker>

    function Harness() {
      const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(['owner'])
      picker = useCanvasPromptNodePicker({
        nodes: [ownerNode, sourceNode],
        activeOperationNodeId: 'owner',
        setSelectedNodeIds,
      })
      return <span>{selectedNodeIds.join(',')}</span>
    }

    await act(async () => root.render(<Harness />))
    await act(async () => picker.start('owner', onPick))
    let intercepted = false
    await act(async () => {
      picker.interceptNodeSelect('source')
      intercepted = picker.interceptSelectionChange()
    })
    expect(intercepted).toBe(true)

    expect(onPick).toHaveBeenCalledWith(sourceNode)
    expect(picker.ownerNodeId).toBeNull()
    expect(container.textContent).toBe('owner')
    await act(async () => root.unmount())
  })

  it('cancels the active pick mode with Escape', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    let picker!: ReturnType<typeof useCanvasPromptNodePicker>

    function Harness() {
      const [, setSelectedNodeIds] = useState<string[]>(['owner'])
      picker = useCanvasPromptNodePicker({
        nodes: [ownerNode, sourceNode],
        activeOperationNodeId: 'owner',
        setSelectedNodeIds,
      })
      return null
    }

    await act(async () => root.render(<Harness />))
    await act(async () => picker.start('owner', vi.fn()))
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(picker.ownerNodeId).toBeNull()
    await act(async () => root.unmount())
  })
})

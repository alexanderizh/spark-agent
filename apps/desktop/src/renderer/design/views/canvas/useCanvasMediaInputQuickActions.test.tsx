// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasMediaInputQuickActions } from './useCanvasMediaInputQuickActions'
import type { CanvasNodeMediaKind } from './canvasNodeMediaKind'
import type { CanvasNode } from './canvas.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const at = '2026-08-01T00:00:00.000Z'

function mediaNode(id: string, type: 'image' | 'video' | 'audio'): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    x: 0,
    y: 0,
    width: 460,
    height: 300,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
  }
}

function taskNode(id: string, type: CanvasNode['type']): CanvasNode {
  return { ...mediaNode(id, 'video'), type }
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('useCanvasMediaInputQuickActions', () => {
  it('commits a compatible canvas selection immediately', async () => {
    const image = mediaNode('image-1', 'image')
    const onAppendNode = vi.fn()
    let actions: ReturnType<typeof useCanvasMediaInputQuickActions> | null = null

    await renderHarness({
      nodes: [image],
      acceptedKinds: ['image'],
      onRequestCanvasNodePick: (onPick) => onPick(image),
      onAppendNode,
      onActions: (next) => {
        actions = next
      },
    })

    await act(async () => actions!.pick())
    expect(onAppendNode).toHaveBeenCalledWith(image)
  })

  it('accepts a video task node by resolving it to its output media node', async () => {
    const t2v = taskNode('t2v', 'text_to_video')
    const output = mediaNode('output-1', 'video')
    const kindMap = new Map<string, CanvasNodeMediaKind>([['t2v', 'video']])
    const nodeMap = new Map<string, CanvasNode>([['t2v', output]])
    const onAppendNode = vi.fn()
    const onInvalidNode = vi.fn()
    let actions: ReturnType<typeof useCanvasMediaInputQuickActions> | null = null

    await renderHarness({
      nodes: [t2v, output],
      acceptedKinds: ['video'],
      outputMediaKindByNodeId: kindMap,
      outputMediaNodeByNodeId: nodeMap,
      onRequestCanvasNodePick: (onPick) => onPick(t2v),
      onAppendNode,
      onInvalidNode,
      onActions: (next) => {
        actions = next
      },
    })

    await act(async () => actions!.pick())
    expect(onInvalidNode).not.toHaveBeenCalled()
    expect(onAppendNode).toHaveBeenCalledWith(output)
  })

  it('rejects a task node whose output kind is not accepted', async () => {
    const t2i = taskNode('t2i', 'text_to_image')
    const output = mediaNode('output-1', 'image')
    const kindMap = new Map<string, CanvasNodeMediaKind>([['t2i', 'image']])
    const onAppendNode = vi.fn()
    const onInvalidNode = vi.fn()
    let actions: ReturnType<typeof useCanvasMediaInputQuickActions> | null = null

    await renderHarness({
      nodes: [t2i, output],
      acceptedKinds: ['video'],
      outputMediaKindByNodeId: kindMap,
      onRequestCanvasNodePick: (onPick) => onPick(t2i),
      onAppendNode,
      onInvalidNode,
      onActions: (next) => {
        actions = next
      },
    })

    await act(async () => actions!.pick())
    expect(onAppendNode).not.toHaveBeenCalled()
    expect(onInvalidNode).toHaveBeenCalledWith(t2i)
  })
})

type HarnessProps = {
  nodes: CanvasNode[]
  acceptedKinds: Array<'image' | 'video' | 'audio'>
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>
  outputMediaNodeByNodeId?: ReadonlyMap<string, CanvasNode>
  onRequestCanvasNodePick?: (onPick: (node: CanvasNode) => void) => void
  onAppendNode: (node: CanvasNode) => void
  onInvalidNode?: (node: CanvasNode) => void
  onActions: (actions: ReturnType<typeof useCanvasMediaInputQuickActions>) => void
}

async function renderHarness(initial: HarnessProps) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  let current = initial

  function Harness(props: HarnessProps) {
    const actions = useCanvasMediaInputQuickActions(props)
    props.onActions(actions)
    return null
  }

  const render = async (patch: Partial<HarnessProps>) => {
    current = { ...current, ...patch }
    await act(async () => root.render(<Harness {...current} />))
  }
  await render({})
  return { render }
}

// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCanvasMediaInputQuickActions } from './useCanvasMediaInputQuickActions'
import type { CanvasNode } from './canvas.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []
const at = '2026-08-01T00:00:00.000Z'

function mediaNode(id: string, type: 'image' | 'video'): CanvasNode {
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

  it('waits for an uploaded node to enter the snapshot before committing it', async () => {
    const video = mediaNode('video-1', 'video')
    const onAppendNode = vi.fn()
    let actions: ReturnType<typeof useCanvasMediaInputQuickActions> | null = null
    const harness = await renderHarness({
      nodes: [],
      acceptedKinds: ['video'],
      onUploadLocalFile: vi.fn(async () => video),
      onAppendNode,
      onActions: (next) => {
        actions = next
      },
    })

    await act(async () => actions!.upload({ type: 'video/mp4' } as File))
    expect(onAppendNode).not.toHaveBeenCalled()

    await harness.render({ nodes: [video] })
    expect(onAppendNode).toHaveBeenCalledWith(video)
  })
})

type HarnessProps = {
  nodes: CanvasNode[]
  acceptedKinds: Array<'image' | 'video' | 'audio'>
  onRequestCanvasNodePick?: (onPick: (node: CanvasNode) => void) => void
  onUploadLocalFile?: (file: File) => Promise<CanvasNode | null | undefined>
  onAppendNode: (node: CanvasNode) => void
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

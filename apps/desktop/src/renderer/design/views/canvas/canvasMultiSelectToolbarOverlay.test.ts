import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import type { CanvasFlowEdgeData } from './CanvasFlowEdge'
import type { CanvasFlowNodeData } from './CanvasNode'
import { resolveCanvasMultiSelectToolbarGeometry } from './canvasMultiSelectToolbarGeometry'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas multi-select toolbar overlay', () => {
  it('updates its anchor without driving CanvasStage state on every viewport frame', () => {
    const stage = readCanvasSource('./CanvasStage.tsx')
    const overlay = readCanvasSource('./CanvasMultiSelectToolbarOverlay.tsx')

    expect(stage).toContain('multiSelectToolbarOverlayRef.current?.schedulePositionUpdate()')
    expect(stage).not.toContain('multiSelectToolbarTick')
    expect(overlay).toContain('anchor.style.left = `${geometry.left}px`')
    expect(overlay).toContain('anchor.style.top = `${geometry.top}px`')
    expect(overlay).toContain('if (placeAboveRef.current !== geometry.placeAbove)')
  })

  it('keeps the toolbar above a roomy selection and flips it below near the top edge', () => {
    let bounds = { x: 100, y: 80, width: 200, height: 50 }
    const stage = {
      clientHeight: 400,
      getBoundingClientRect: () => ({ left: 10, top: 20 }),
    } as unknown as HTMLDivElement
    const instance = {
      getInternalNode: (nodeId: string) => ({ id: nodeId }),
      getNodesBounds: () => bounds,
      flowToScreenPosition: ({ x, y }: { x: number; y: number }) => ({
        x: x * 2 + 10,
        y: y * 2 + 20,
      }),
    } as unknown as ReactFlowInstance<Node<CanvasFlowNodeData>, Edge<CanvasFlowEdgeData>>
    const selectedNodeIds = new Set(['node-1', 'node-2'])

    expect(resolveCanvasMultiSelectToolbarGeometry({ stage, instance, selectedNodeIds })).toEqual({
      left: 400,
      top: 98,
      placeAbove: true,
    })

    bounds = { ...bounds, y: 10 }
    expect(resolveCanvasMultiSelectToolbarGeometry({ stage, instance, selectedNodeIds })).toEqual({
      left: 400,
      top: 144,
      placeAbove: false,
    })
  })

  it('does not position the toolbar when fewer than two internal nodes exist', () => {
    const stage = {
      clientHeight: 400,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as unknown as HTMLDivElement
    const instance = {
      getInternalNode: () => undefined,
    } as unknown as ReactFlowInstance<Node<CanvasFlowNodeData>, Edge<CanvasFlowEdgeData>>

    expect(
      resolveCanvasMultiSelectToolbarGeometry({
        stage,
        instance,
        selectedNodeIds: new Set(['missing-1', 'missing-2']),
      }),
    ).toBeNull()
  })
})

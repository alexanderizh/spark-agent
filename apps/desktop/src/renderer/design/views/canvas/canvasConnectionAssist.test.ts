import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_CONNECTION_ASSIST_RADIUS_PX,
  pickConnectionCandidate,
  resolveCardDropConnection,
  type ConnectionAssistNodeRect,
  type ConnectionAssistRules,
} from './canvasConnectionAssist'
import type { CanvasEdge, CanvasNode } from './canvas.types'

function node(id: string, type: CanvasNode['type'] = 'image'): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}

function edge(sourceNodeId: string, targetNodeId: string, type: CanvasEdge['type']): CanvasEdge {
  return {
    id: `edge-${sourceNodeId}-${targetNodeId}-${type}`,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    sourceNodeId,
    targetNodeId,
    type,
    taskId: null,
    metadata: { manual: true },
    createdAt: '2026-07-10T00:00:00.000Z',
  }
}

function rect(
  id: string,
  left: number,
  top: number,
  right: number,
  bottom: number,
  extra: Partial<ConnectionAssistNodeRect> = {},
): ConnectionAssistNodeRect {
  return { id, left, top, right, bottom, zIndex: 0, order: 0, ...extra }
}

function rules(nodes: CanvasNode[], edges: CanvasEdge[]): ConnectionAssistRules {
  return { nodeById: new Map(nodes.map((item) => [item.id, item])), edges }
}

describe('pickConnectionCandidate', () => {
  it('prefers the node under the pointer over merely nearby nodes', () => {
    const under = rect('under', 100, 100, 300, 300)
    const nearby = rect('nearby', 400, 100, 600, 300)
    // 指针落在 under 内部，同时也在 nearby 的感应半径边缘。
    const picked = pickConnectionCandidate(
      [under, nearby],
      { x: 320, y: 200 },
      CANVAS_CONNECTION_ASSIST_RADIUS_PX,
    )
    expect(picked?.id).toBe('under')
  })

  it('picks the visually topmost node when candidates overlap', () => {
    const lower = rect('lower', 0, 0, 300, 300, { zIndex: 1, order: 0 })
    const upper = rect('upper', 100, 100, 400, 400, { zIndex: 5, order: 1 })
    const picked = pickConnectionCandidate(
      [lower, upper],
      { x: 200, y: 200 },
      CANVAS_CONNECTION_ASSIST_RADIUS_PX,
    )
    expect(picked?.id).toBe('upper')
  })

  it('falls back to the nearest node inside the assist radius and ignores farther ones', () => {
    const near = rect('near', 0, 0, 100, 100)
    const far = rect('far', 500, 0, 600, 100)
    const picked = pickConnectionCandidate(
      [far, near],
      { x: 120, y: 50 },
      CANVAS_CONNECTION_ASSIST_RADIUS_PX,
    )
    expect(picked?.id).toBe('near')
    expect(
      pickConnectionCandidate([far], { x: 120, y: 50 }, CANVAS_CONNECTION_ASSIST_RADIUS_PX),
    ).toBeNull()
  })

  it('never suggests the node the connection was dragged from', () => {
    const origin = rect('origin', 0, 0, 100, 100)
    const other = rect('other', 104, 0, 204, 100)
    // 指针落在起点节点内部、同时处于 other 的感应半径内：起点必须被排除。
    const picked = pickConnectionCandidate(
      [origin, other],
      { x: 98, y: 50 },
      CANVAS_CONNECTION_ASSIST_RADIUS_PX,
      'origin',
    )
    expect(picked?.id).toBe('other')
  })
})

describe('resolveCardDropConnection', () => {
  it('rejects dropping a connection back onto its own node', () => {
    const origin = node('origin')
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'source' },
        dropNodeId: 'origin',
        rules: rules([origin], []),
      }),
    ).toBeNull()
  })

  it('connects origin -> drop when dragging from a source handle', () => {
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'source' },
        dropNodeId: 'target',
        rules: rules([node('origin'), node('target')], []),
      }),
    ).toEqual({ sourceNodeId: 'origin', targetNodeId: 'target' })
  })

  it('connects drop -> origin when dragging from a target handle', () => {
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'target' },
        dropNodeId: 'candidate',
        rules: rules([node('origin'), node('candidate')], []),
      }),
    ).toEqual({ sourceNodeId: 'candidate', targetNodeId: 'origin' })
  })

  it('rejects a duplicate edge with the same inferred type in the same direction', () => {
    // target 是 image 节点 → inferCanvasConnectionType 推断为 references。
    const existing = edge('origin', 'target', 'references')
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'source' },
        dropNodeId: 'target',
        rules: rules([node('origin'), node('target')], [existing]),
      }),
    ).toBeNull()
  })

  it('allows the reverse direction even when one edge already exists', () => {
    const existing = edge('origin', 'target', 'references')
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'target' },
        dropNodeId: 'target',
        rules: rules([node('origin'), node('target')], [existing]),
      }),
    ).toEqual({ sourceNodeId: 'target', targetNodeId: 'origin' })
  })

  it('rejects hidden nodes', () => {
    const origin = node('origin')
    const drop = node('drop')
    drop.hidden = true
    expect(
      resolveCardDropConnection({
        origin: { nodeId: 'origin', handleType: 'source' },
        dropNodeId: 'drop',
        rules: rules([origin, drop], []),
      }),
    ).toBeNull()
  })
})

describe('canvas connection assist wiring', () => {
  it('keeps the stage wired to the assist hook and the candidate feedback styles in place', () => {
    const stageSource = readFileSync(
      fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
      'utf8',
    )
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useCanvasConnectionAssist.ts', import.meta.url)),
      'utf8',
    )
    const nodeStyles = readFileSync(
      fileURLToPath(new URL('./cinematic/nodes.less', import.meta.url)),
      'utf8',
    )

    // CanvasStage：牵线开始/结束时驱动吸附辅助，卡片级投放直接复用现有连接入口。
    expect(stageSource).toContain('useCanvasConnectionAssist')
    expect(stageSource).toContain('beginConnectionDrag(')
    expect(stageSource).toContain('endConnectionDrag(event)')
    expect(stageSource).toContain('onConnectNodes(drop.connect)')
    expect(stageSource).toContain('openPaneContextMenuAt(point, pendingConnection)')

    // hook：屏幕像素坐标采集 + data-id 定位 + rAF 节流 + 卸载清理。
    expect(hookSource).toContain("'.react-flow__node'")
    expect(hookSource).toContain("'data-id'")
    expect(hookSource).toContain('requestAnimationFrame')
    expect(hookSource).toContain('getBoundingClientRect')

    // 样式：候选态（偏转动画 + 放大锚点）与无效态（危险色描边）必须并存且区分。
    expect(nodeStyles).toContain('.react-flow__node.canvas-connection-candidate')
    expect(nodeStyles).toContain('.react-flow__node.canvas-connection-invalid')
    expect(nodeStyles).toContain('@keyframes canvas-connection-nudge')
    expect(nodeStyles).toContain('--canvas-node-handle-scale: 1.8;')
    expect(nodeStyles).toMatch(
      /\.canvas-node-handle\s*\{[\s\S]*?transition:[\s\S]*?transform var\(--canvas-cinema-motion-fast\) ease/,
    )
    expect(nodeStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?canvas-connection-candidate[\s\S]*?animation: none;/,
    )
  })
})

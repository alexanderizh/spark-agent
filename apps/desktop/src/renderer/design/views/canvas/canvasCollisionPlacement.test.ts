import { describe, expect, it } from 'vitest'
import {
  CANVAS_BATCH_ITEM_GAP,
  getCanvasBatchLayoutSize,
  resolveCollisionFreeBatchPositions,
  resolveCollisionFreeNodePosition,
} from './canvasCollisionPlacement'
import type { CanvasNode } from './canvas.types'

function node(patch: Partial<CanvasNode>): CanvasNode {
  return {
    id: patch.id ?? 'node',
    projectId: 'project',
    boardId: 'board',
    userId: 0,
    type: 'text',
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '',
    updatedAt: '',
    ...patch,
  }
}

describe('canvasCollisionPlacement', () => {
  it('保留没有碰撞的用户期望落点', () => {
    expect(
      resolveCollisionFreeNodePosition({
        preferred: { x: 800, y: 500 },
        size: { width: 360, height: 280 },
        nodes: [node({ x: 0, y: 0 })],
        boardId: 'board',
      }),
    ).toEqual({ x: 800, y: 500 })
  })

  it('与已有节点重叠时给出确定的空闲落点', () => {
    const result = resolveCollisionFreeNodePosition({
      preferred: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      nodes: [node({ x: 0, y: 0 })],
      boardId: 'board',
    })
    expect(result).not.toEqual({ x: 0, y: 0 })
  })

  it('牵线创建时即使重叠也保留用户释放位置', () => {
    expect(
      resolveCollisionFreeNodePosition({
        preferred: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        nodes: [node({ x: 0, y: 0 })],
        boardId: 'board',
        preservePreferredPosition: true,
      }),
    ).toEqual({ x: 0, y: 0 })
  })

  it('把多产物稳定排成等间距网格并整体避让', () => {
    const positions = resolveCollisionFreeBatchPositions({
      preferred: { x: 0, y: 0 },
      sizes: [
        { width: 200, height: 160 },
        { width: 240, height: 180 },
        { width: 220, height: 140 },
        { width: 200, height: 200 },
      ],
      nodes: [node({ x: 0, y: 0, width: 700, height: 500 })],
      boardId: 'board',
    })
    expect(positions).toHaveLength(4)
    expect(positions[0]).not.toEqual({ x: 0, y: 0 })
    expect((positions[1]?.x ?? 0) - (positions[0]?.x ?? 0)).toBe(200 + CANVAS_BATCH_ITEM_GAP)
    expect(positions[3]?.y).toBeGreaterThan(positions[0]?.y ?? 0)
  })

  it('自动下游批次按来源后方的预设区域落位，不被障碍物拆散', () => {
    const sizes = [
      { width: 200, height: 160 },
      { width: 240, height: 180 },
      { width: 220, height: 140 },
    ]
    const layoutSize = getCanvasBatchLayoutSize(sizes)
    const positions = resolveCollisionFreeBatchPositions({
      preferred: { x: 900, y: 500 },
      sizes,
      nodes: [node({ x: 900, y: 500, width: 1200, height: 900 })],
      boardId: 'board',
      preservePreferredPosition: true,
    })

    expect(positions[0]).toEqual({ x: 900, y: 500 })
    expect(positions[1]).toEqual({ x: 900 + 200 + CANVAS_BATCH_ITEM_GAP, y: 500 })
    expect(layoutSize).toEqual({
      width: 200 + 240 + 220 + CANVAS_BATCH_ITEM_GAP * 2,
      height: 180,
    })
  })

  it('忽略其他 board、隐藏节点和组内相对坐标节点', () => {
    expect(
      resolveCollisionFreeNodePosition({
        preferred: { x: 0, y: 0 },
        size: { width: 300, height: 200 },
        nodes: [
          node({ boardId: 'other' }),
          node({ id: 'hidden', hidden: true }),
          node({ id: 'child', parentNodeId: 'group' }),
        ],
        boardId: 'board',
      }),
    ).toEqual({ x: 0, y: 0 })
  })
})

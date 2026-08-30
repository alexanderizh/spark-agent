import { describe, expect, it } from 'vitest'
import {
  canvasNodeDownloadName,
  createCanvasNodeNaming,
  formatCanvasNodeTitle,
  nextCanvasNodeNumber,
  readCanvasNodeNumber,
  renameCanvasNode,
} from './canvasNodeNaming'
import type { CanvasNode } from './canvas.types'

function node(
  title: string | null,
  options: { boardId?: string; hidden?: boolean; nodeSequence?: number } = {},
): CanvasNode {
  return {
    id: title ?? 'untitled',
    projectId: 'project-1',
    boardId: options.boardId ?? 'board-1',
    userId: 1,
    type: 'image',
    title,
    assetId: null,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: options.hidden ?? false,
    data: options.nodeSequence ? { nodeSequence: options.nodeSequence } : {},
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  }
}

describe('canvas node naming', () => {
  it('allocates from the largest existing number instead of the node count', () => {
    const nodes = [node('#1 图片'), node('#4 视频')]
    expect(nextCanvasNodeNumber(nodes, 'board-1')).toBe(5)
    expect(createCanvasNodeNaming({ nodes, boardId: 'board-1', type: 'text' })).toEqual({
      nodeNumber: 5,
      title: '#5 文本',
    })
  })

  it('ignores deleted and other-board nodes when allocating a number', () => {
    const nodes = [
      node('#3 图片'),
      node('#9 已删除', { hidden: true }),
      node('#12 另一画板', { boardId: 'board-2' }),
    ]
    expect(nextCanvasNodeNumber(nodes, 'board-1')).toBe(4)
  })

  it('names the unified text-to-video container as video generation', () => {
    expect(
      createCanvasNodeNaming({ nodes: [], boardId: 'board-1', type: 'text_to_video' }).title,
    ).toBe('#1 视频生成')
  })

  it('reads stored numbers and legacy suffix titles', () => {
    expect(readCanvasNodeNumber(node('自定义名', { nodeSequence: 8 }))).toBe(8)
    expect(readCanvasNodeNumber(node('文生图 #6'))).toBe(6)
  })

  it('keeps the number stable when a node is renamed', () => {
    const current = node('#7 旧名字', { nodeSequence: 7 })
    expect(renameCanvasNode(current, '新名字', '图片')).toBe('#7 新名字')
    expect(formatCanvasNodeTitle(7, '#2 新名字', '图片')).toBe('#7 新名字')
  })

  it('builds downloads as number plus artifact name without duplicate numbering', () => {
    const current = node('#11 文生图', { nodeSequence: 11 })
    expect(canvasNodeDownloadName(current, '海边日落', '图片')).toBe('11-海边日落')
    expect(canvasNodeDownloadName(current, '#3 海边日落', '图片')).toBe('11-海边日落')
  })
})

import { describe, expect, it } from 'vitest'
import type { CanvasNode } from '../canvas.types'
import { collectAssetGenerationStatuses, isAssetGenerationActive } from './assetGenerationStatus'

function taskNode(
  id: string,
  outputFilmAssetId: string,
  status: NonNullable<CanvasNode['data']['status']>,
  extra: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    // 类型化操作节点：node.type === node.data.operation
    type: 'text_to_image',
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { outputFilmAssetId, status, ...(extra.data ?? {}) },
    createdAt: '2026-08-30T10:00:00Z',
    updatedAt: extra.updatedAt ?? '2026-08-30T10:00:00Z',
    ...(extra.title != null ? { title: extra.title } : {}),
  }
}

describe('collectAssetGenerationStatuses', () => {
  it('按资产聚合最近一次生成任务状态', () => {
    const nodes = [
      taskNode('n1', 'asset-a', 'running', { updatedAt: '2026-08-30T10:00:00Z' }),
      taskNode('n2', 'asset-b', 'completed', { updatedAt: '2026-08-30T10:05:00Z' }),
      // asset-a 的更早一次生成：不得覆盖 n1
      taskNode('n3', 'asset-a', 'failed', { updatedAt: '2026-08-30T09:00:00Z' }),
    ]
    const map = collectAssetGenerationStatuses(nodes)
    expect(map.size).toBe(2)
    expect(map.get('asset-a')).toMatchObject({ taskNodeId: 'n1', status: 'running' })
    expect(map.get('asset-b')).toMatchObject({ taskNodeId: 'n2', status: 'completed' })
  })

  it('取 updatedAt 最新者；同刻并列取扫描顺序后者', () => {
    const nodes = [
      taskNode('old', 'asset-a', 'failed', { updatedAt: '2026-08-30T10:00:00Z' }),
      taskNode(
        'new',
        'asset-a',
        'succeeded-not-a-status' as NonNullable<CanvasNode['data']['status']>,
        {
          updatedAt: '2026-08-30T10:00:00Z',
        },
      ),
    ]
    const map = collectAssetGenerationStatuses(nodes)
    expect(map.get('asset-a')?.taskNodeId).toBe('new')
  })

  it('携带 progress 与 message（供抽屉展示）', () => {
    const nodes = [
      taskNode('n1', 'asset-a', 'running', {
        updatedAt: '2026-08-30T10:00:00Z',
        data: { progress: 0.4, message: '生成中' },
      }),
    ]
    const status = collectAssetGenerationStatuses(nodes).get('asset-a')
    expect(status?.progress).toBe(0.4)
    expect(status?.message).toBe('生成中')
  })

  it('忽略无 filmOwner 标记与无状态的节点', () => {
    const noise = taskNode('n1', '', 'running')
    const noStatus: CanvasNode = { ...taskNode('n2', 'asset-b', 'completed'), data: {} }
    const map = collectAssetGenerationStatuses([noise, noStatus])
    expect(map.size).toBe(0)
  })
})

describe('isAssetGenerationActive', () => {
  it('running/pending 为进行中，其余不是', () => {
    expect(isAssetGenerationActive({ assetId: 'a', taskNodeId: 'n', status: 'running' })).toBe(true)
    expect(isAssetGenerationActive({ assetId: 'a', taskNodeId: 'n', status: 'pending' })).toBe(true)
    expect(isAssetGenerationActive({ assetId: 'a', taskNodeId: 'n', status: 'completed' })).toBe(
      false,
    )
    expect(isAssetGenerationActive({ assetId: 'a', taskNodeId: 'n', status: 'failed' })).toBe(false)
    expect(isAssetGenerationActive(undefined)).toBe(false)
  })
})

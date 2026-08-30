import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { computePipelineProgress } from './canvasPipelineProgress'

function asset(kind: string, id: string): CanvasAsset {
  return {
    id,
    projectId: 'p',
    userId: 1,
    type: 'text',
    source: 'manual',
    metadata: { kind },
    createdAt: '',
    updatedAt: '',
  } as CanvasAsset
}

function node(partial: Partial<CanvasNode>): CanvasNode {
  return {
    id: partial.id ?? 'n',
    projectId: 'p',
    boardId: 'b',
    userId: 1,
    type: partial.type ?? 'text',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: partial.data ?? {},
    createdAt: '',
    updatedAt: '',
  } as CanvasNode
}

describe('computePipelineProgress', () => {
  it('空项目：0%，下一步为导入文稿', () => {
    const progress = computePipelineProgress({ assets: [], nodes: [], metadata: undefined })
    expect(progress.percent).toBe(0)
    expect(progress.completedStages).toBe(0)
    expect(progress.nextAction?.stageKey).toBe('manuscript')
  })

  it('统计各阶段数量与明细', () => {
    const metadata = {
      film: {
        manuscript: { chapters: [{ id: 'c1' }, { id: 'c2' }] },
        shotGroups: [
          {
            id: 'g1',
            name: 'g',
            segments: [
              { id: 's1', index: 1, title: 'a', durationSec: 3 },
              { id: 's2', index: 2, title: 'b', durationSec: 2 },
            ],
          },
        ],
      },
    }
    const assets = [
      asset('script', 'sc1'),
      asset('character', 'ch1'),
      asset('character', 'ch2'),
      asset('scene', 'se1'),
      asset('prop', 'pr1'),
    ]
    const nodes = [
      node({ id: 'k1', type: 'image', data: { pipelineRole: 'keyframe' } }),
      node({ id: 'v1', type: 'video', data: { url: 'file://x.mp4' } }),
    ]
    const progress = computePipelineProgress({ assets, nodes, metadata })
    const byKey = Object.fromEntries(progress.stages.map((s) => [s.key, s]))
    expect(byKey['manuscript']!.detail).toBe('2 章')
    expect(byKey['screenplay']!.count).toBe(1)
    expect(byKey['resource']!.detail).toBe('角色2·场景1·道具1')
    expect(byKey['shot']!.detail).toBe('2 镜·5s')
    expect(byKey['keyframe']!.count).toBe(1)
    expect(byKey['video']!.count).toBe(1)
    // 全部阶段都有内容 → 100%，无下一步
    expect(progress.percent).toBe(100)
    expect(progress.nextAction).toBeNull()
  })

  it('下一步指向第一个未完成阶段', () => {
    const metadata = { film: { manuscript: { chapters: [{ id: 'c1' }] } } }
    const progress = computePipelineProgress({
      assets: [asset('script', 'sc1')],
      nodes: [],
      metadata,
    })
    // 文稿✓ 剧本✓ 资源✗ → 下一步 resource
    expect(progress.nextAction?.stageKey).toBe('resource')
    expect(progress.completedStages).toBe(2)
  })
})

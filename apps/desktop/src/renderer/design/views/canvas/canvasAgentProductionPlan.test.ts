import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { buildCanvasAgentProductionPlan } from './canvasAgentProductionPlan'

function asset(id: string, kind: string): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type: 'text',
    source: 'manual',
    title: id,
    metadata: { kind },
    createdAt: '',
    updatedAt: '',
  }
}

function node(id: string, type: CanvasNode['type'], data: CanvasNode['data']): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type,
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data,
    createdAt: '',
    updatedAt: '',
  }
}

describe('buildCanvasAgentProductionPlan', () => {
  it('空项目先要求导入文稿，不建议创建视频', () => {
    const plan = buildCanvasAgentProductionPlan({ assets: [], nodes: [], metadata: undefined })

    expect(plan.currentStage).toBe('manuscript')
    expect(plan.nextActions[0]?.id).toBe('manuscript.import')
    expect(plan.nextActions.map((action) => action.id)).not.toContain('video.create_nodes')
    expect(plan.guardrails).toContain('默认只创建并配置操作节点；用户明确要求立即执行时才运行媒体任务。')
  })

  it('已有剧本时优先提取角色场景并准备设计资产', () => {
    const plan = buildCanvasAgentProductionPlan({
      assets: [asset('script-1', 'script')],
      nodes: [node('screenplay-1', 'text', { pipelineRole: 'screenplay', productionState: 'confirmed' })],
      metadata: undefined,
    })

    expect(plan.currentStage).toBe('assets')
    expect(plan.nextActions.slice(0, 2).map((action) => action.id)).toEqual([
      'screenplay.extract_characters',
      'screenplay.extract_scenes',
    ])
    expect(plan.nextActions.map((action) => action.id)).not.toContain('screenplay.split_episodes')
    expect(plan.blockers).toContain('尚未建立角色资产')
    expect(plan.blockers).toContain('尚未建立场景资产')
  })

  it('已有分镜但没有关键帧时先准备镜头资产和关键帧，再创建视频节点', () => {
    const plan = buildCanvasAgentProductionPlan({
      assets: [asset('script-1', 'script'), asset('character-1', 'character'), asset('scene-1', 'scene')],
      nodes: [
        node('character-card', 'image', {
          pipelineRole: 'design_card',
          url: 'character.png',
          outputFilmAssetId: 'character-1',
        }),
        node('scene-card', 'image', {
          pipelineRole: 'design_card',
          url: 'scene.png',
          outputFilmAssetId: 'scene-1',
        }),
        node('shot-1', 'text', { pipelineRole: 'shot', productionState: 'confirmed' }),
      ],
      metadata: {
        film: {
          shotGroups: [{ id: 'group-1', name: '第1集', segments: [{ id: 'shot-1', index: 1, title: '开场' }] }],
        },
      },
    })

    expect(plan.currentStage).toBe('shot_assets')
    expect(plan.nextActions.map((action) => action.id)).toEqual([
      'shot.audit_assets',
      'shot.create_keyframes',
    ])
    expect(plan.nextActions.map((action) => action.id)).not.toContain('video.create_nodes')
  })

  it('不会用同一角色的重复设计板抵消缺失的场景图', () => {
    const plan = buildCanvasAgentProductionPlan({
      assets: [
        asset('script-1', 'script'),
        asset('character-1', 'character'),
        asset('character-2', 'character'),
        asset('scene-1', 'scene'),
      ],
      nodes: [
        node('character-card-1', 'text_to_image', {
          pipelineRole: 'design_card',
          outputFilmAssetId: 'character-1',
        }),
        node('character-card-2', 'text_to_image', {
          pipelineRole: 'design_card',
          outputFilmAssetId: 'character-1',
        }),
        node('character-card-3', 'text_to_image', {
          pipelineRole: 'design_card',
          outputFilmAssetId: 'character-1',
        }),
      ],
      metadata: undefined,
    })

    expect(plan.currentStage).toBe('design_assets')
    expect(plan.blockers).toContain('角色身份板或场景设计图尚未齐套')
  })
})

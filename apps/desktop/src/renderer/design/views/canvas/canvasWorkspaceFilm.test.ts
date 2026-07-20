import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import type { ShotGroup, ShotSegment } from './canvasFilmAssets'
import {
  buildFilmAssetReferencePrompt,
  buildShotSegmentKeyframePrompt,
  buildShotSegmentVideoPrompt,
} from './canvasWorkspaceFilm'

describe('buildFilmAssetReferencePrompt', () => {
  it('场景图提示词强制为无人物的纯场景', () => {
    const asset: CanvasAsset = {
      id: 'scene-1',
      projectId: 'project-1',
      userId: 0,
      type: 'text',
      source: 'manual',
      title: '雨夜茶馆',
      contentText: '木质柜台与暖色吊灯。',
      metadata: { kind: 'scene' },
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    }

    const prompt = buildFilmAssetReferencePrompt(asset)

    expect(prompt).toContain('【不要存在人物】')
    expect(prompt).toContain('只呈现纯粹的场景')
    expect(prompt).toContain('不得出现任何人物')
  })

  it('把结构化分镜控制字段传给视频与首尾帧模型', () => {
    const segment: ShotSegment = {
      id: 'shot-1',
      index: 1,
      title: '推门入画',
      durationSec: 2,
      composition: '主体落在右上交点',
      blocking: '人物距镜头 220cm',
      characterReferences: '林岚=雨夜造型图',
      lighting: '主辅光比 4:1，3200K',
      actionBeats: '0.0–0.5s：手伸向门把',
      soundEffects: '0.5s：金属轻响',
      transition: '入：硬切；出：动作匹配硬切',
      firstFrame: '门关闭，手距门把 8cm',
      lastFrame: '门开 45°，右脚落地',
      continuity: '右手保持握门把',
      negativePrompt: '手指畸形，门把位置跳变',
    }
    const group: ShotGroup = { id: 'group-1', name: '第一场', segments: [segment] }

    const videoPrompt = buildShotSegmentVideoPrompt({ group, segment, characters: [] })
    expect(videoPrompt).toContain('动作节拍：0.0–0.5s')
    expect(videoPrompt).toContain('人物占位与距离：人物距镜头 220cm')
    expect(videoPrompt).toContain('首帧：门关闭')
    expect(videoPrompt).toContain('该镜反向约束：手指畸形')

    const firstFramePrompt = buildShotSegmentKeyframePrompt(
      { group, segment, characters: [] },
      'first',
      '',
    )
    const lastFramePrompt = buildShotSegmentKeyframePrompt(
      { group, segment, characters: [] },
      'last',
      '',
    )
    expect(firstFramePrompt).toContain('首帧精确描述：门关闭')
    expect(lastFramePrompt).toContain('尾帧精确描述：门开 45°')
  })
})

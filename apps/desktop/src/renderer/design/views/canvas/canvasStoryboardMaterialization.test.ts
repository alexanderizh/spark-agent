import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import { materializeStoryboardRows } from './canvasStoryboardMaterialization'

const at = '2026-07-18T00:00:00.000Z'

function filmAsset(id: string, kind: string, title: string): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 0,
    type: 'text',
    source: 'manual',
    title,
    contentText: title,
    metadata: { kind },
    createdAt: at,
    updatedAt: at,
  }
}

describe('storyboard materialization', () => {
  it('groups rows and preserves detailed fields while resolving asset names', () => {
    const result = materializeStoryboardRows({
      metadata: {},
      defaultGroupName: '第一集',
      assets: [filmAsset('char-1', 'character', '林岚'), filmAsset('scene-1', 'scene', '旧茶馆')],
      rows: [
        {
          index: 1,
          title: '雨夜进入茶馆',
          groupName: '第一场',
          sceneName: '旧茶馆',
          durationSec: 4,
          shotSize: '全景',
          angle: '平视',
          movement: '缓慢推进',
          sceneLayout: '前景雨帘，中景林岚，背景茶馆柜台',
          composition: '林岚落在右上交点',
          blocking: '林岚从画面左侧进入',
          lighting: '左侧暖光',
          focalLength: '35mm',
          aperture: 'f/4',
          iso: 'ISO 800',
          colorTone: '低饱和青橙',
          mood: '紧张',
          performance: '眼神快速扫视',
          costume: '深色外套',
          description: '林岚推门进入。',
          dialogue: '林岚：还有空房吗？',
          characterNames: ['林岚', '未入库角色'],
          characterReferences: '林岚=雨夜造型图',
          actionBeats: '0.0–0.5s：握住门把',
          soundEffects: '0.5s：门铃声',
          transition: '入：硬切；出：动作匹配硬切',
          firstFrame: '门关闭',
          lastFrame: '门开 45°',
          continuity: '右手保持握门把',
          shotPrompt: '雨夜茶馆全景',
          negativePrompt: '文字水印',
        },
      ],
    })

    expect(result.createdGroups).toHaveLength(1)
    expect(result.createdGroups[0]?.name).toBe('第一场')
    expect(result.createdGroups[0]?.segments[0]).toMatchObject({
      durationSec: 4,
      shotSize: '全景',
      angle: '平视',
      movement: '缓慢推进',
      sceneLayout: '前景雨帘，中景林岚，背景茶馆柜台',
      composition: '林岚落在右上交点',
      blocking: '林岚从画面左侧进入',
      lighting: '左侧暖光',
      focalLength: '35mm',
      aperture: 'f/4',
      iso: 'ISO 800',
      colorTone: '低饱和青橙',
      mood: '紧张',
      microExpression: '眼神快速扫视',
      costume: '深色外套',
      characterReferences: '林岚=雨夜造型图',
      actionBeats: '0.0–0.5s：握住门把',
      soundEffects: '0.5s：门铃声',
      transition: '入：硬切；出：动作匹配硬切',
      firstFrame: '门关闭',
      lastFrame: '门开 45°',
      continuity: '右手保持握门把',
      characterAssetIds: ['char-1'],
      sceneAssetId: 'scene-1',
      negativePrompt: '文字水印',
    })
    expect((result.metadata.film as { shotGroups: unknown[] }).shotGroups).toHaveLength(1)
  })

  it('appends to existing shot groups without mutating the input metadata', () => {
    const existing = {
      film: {
        shotGroups: [{ id: 'existing', name: '已有分组', sortOrder: 0, segments: [] }],
      },
    }

    const result = materializeStoryboardRows({
      metadata: existing,
      defaultGroupName: '新增分组',
      assets: [],
      rows: [{ title: '镜1', description: '建立镜头' }],
    })

    expect(existing.film.shotGroups as unknown[]).toHaveLength(1)
    expect((result.metadata.film as { shotGroups: unknown[] }).shotGroups).toHaveLength(2)
    expect(result.createdGroups[0]?.sortOrder).toBe(1)
  })
})

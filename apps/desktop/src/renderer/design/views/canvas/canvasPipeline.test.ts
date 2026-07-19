import { describe, expect, it } from 'vitest'
import type { CanvasNodeData } from './canvas.types'
import {
  collectDownstream,
  confirmPatch,
  getPipelineActions,
  getNodePipelineActions,
  humanEditPatch,
  isConfirmed,
  readManuscriptIndex,
  readStyleBible,
  readStylePresets,
  stalePatch,
  upsertManuscriptChapters,
  upsertStylePreset,
  writeStyleBible,
} from './canvasPipeline'

describe('canvasPipeline', () => {
  describe('getPipelineActions', () => {
    it('章节可转剧本', () => {
      const actions = getPipelineActions('chapter')
      expect(actions.map((a) => a.id)).toEqual(['chapter.to_screenplay'])
      expect(actions[0]!.produces).toBe('screenplay')
    })

    it('剧本可生成分镜脚本 / 提取完整实体 / 分镜关键帧图', () => {
      expect(getPipelineActions('screenplay').map((a) => a.id)).toEqual([
        'screenplay.to_shot_script',
        'screenplay.extract_characters',
        'screenplay.extract_scenes',
        'screenplay.extract_props',
        'screenplay.extract_effects',
        'screenplay.storyboard_grid',
      ])
    })

    it('角色出三视图，产出设定图卡', () => {
      const actions = getPipelineActions('character')
      expect(actions.map((a) => a.id)).toEqual(['character.three_view'])
      expect(actions[0]!.produces).toBe('design_card')
    })

    it('分镜可出关键帧 + 视频', () => {
      expect(getPipelineActions('shot').map((a) => a.id)).toEqual([
        'shot.to_keyframes',
        'shot.to_video',
      ])
    })

    it('无角色或未知角色返回空', () => {
      expect(getPipelineActions(undefined)).toEqual([])
      expect(getPipelineActions('style_bible')).toEqual([])
    })

    it('节点关联同类型资产时可放宽到对应出图任务', () => {
      expect(
        getNodePipelineActions({ type: 'image' }, { assetKinds: ['scene'] }).map(
          (action) => action.id,
        ),
      ).toEqual(['scene.scene_image'])
    })

    it('分镜脚本等功能文本节点仍保留完整标准文本能力', () => {
      const actions = getNodePipelineActions({
        type: 'text',
        data: {
          text: ['| 镜号 | 画面 |', '| --- | --- |', '| 1 | 夜景 |', '| 2 | 近景 |'].join('\n'),
        },
      })

      expect(actions.map((action) => action.id)).toContain('screenplay.extract_characters')
      expect(actions.map((action) => action.id)).toContain('character.three_view')
      expect(actions.every((action) => Boolean(action.kind))).toBe(true)
    })
  })

  describe('生产状态机 / 闸门', () => {
    it('confirm 后 isConfirmed 为真', () => {
      const node = { data: { ...confirmPatch('2026-06-20T00:00:00Z') } as CanvasNodeData }
      expect(isConfirmed(node)).toBe(true)
      expect(node.data.confirmedAt).toBe('2026-06-20T00:00:00Z')
    })

    it('人工编辑已确认节点会回落 draft', () => {
      const patch = humanEditPatch({ productionState: 'confirmed' } as CanvasNodeData)
      expect(patch.editedByHuman).toBe(true)
      expect(patch.productionState).toBe('draft')
    })

    it('stale 补丁累积上游来源', () => {
      const first = stalePatch(undefined, 'up1')
      expect(first.productionState).toBe('stale')
      expect(first.staleFrom).toEqual(['up1'])
      const second = stalePatch(first as CanvasNodeData, 'up2')
      expect(second.staleFrom).toEqual(['up1', 'up2'])
    })
  })

  describe('collectDownstream', () => {
    it('沿血缘边收集所有下游', () => {
      const edges = [
        { source: 'chapter', target: 'script' },
        { source: 'script', target: 'shot' },
        { source: 'shot', target: 'keyframe' },
        { source: 'keyframe', target: 'clip' },
        { source: 'other', target: 'unrelated' },
      ]
      const downstream = collectDownstream('script', edges)
      expect(downstream.sort()).toEqual(['clip', 'keyframe', 'shot'])
    })

    it('处理环不死循环', () => {
      const edges = [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ]
      expect(collectDownstream('a', edges).sort()).toEqual(['a', 'b'])
    })
  })

  describe('metadata helpers', () => {
    it('styleBible 读写', () => {
      const meta = writeStyleBible(undefined, 'anime, cinematic')
      expect(readStyleBible(meta)).toBe('anime, cinematic')
    })

    it('风格预设 upsert + 覆盖', () => {
      let meta = upsertStylePreset(undefined, {
        id: 'p1',
        kind: 'camera',
        name: '推镜',
        promptItemIds: ['movement.push'],
      })
      meta = upsertStylePreset(meta, {
        id: 'p1',
        kind: 'camera',
        name: '推镜v2',
        promptItemIds: ['movement.push', 'movement.zoom'],
      })
      const presets = readStylePresets(meta)
      expect(presets).toHaveLength(1)
      expect(presets[0]!.name).toBe('推镜v2')
    })

    it('文稿章节 upsert 合并 + 按 order 排序', () => {
      let meta = upsertManuscriptChapters(
        undefined,
        [
          { id: 'c2', title: '第二章', order: 1, chapterAssetId: 'a2' },
          { id: 'c1', title: '第一章', order: 0, chapterAssetId: 'a1' },
        ],
        { sourceAssetId: 'm1', title: '小说' },
      )
      meta = upsertManuscriptChapters(meta, [
        { id: 'c1', title: '第一章(改)', order: 0, chapterAssetId: 'a1' },
      ])
      const index = readManuscriptIndex(meta)
      expect(index?.title).toBe('小说')
      expect(index?.chapters.map((c) => c.title)).toEqual(['第一章(改)', '第二章'])
    })
  })
})

describe('Production Bible', () => {
  it('buildProductionBiblePrompt 输出结构化视觉圣经', async () => {
    const {
      buildProductionBiblePrompt,
      writeProductionBible,
      readProductionBible,
      isProductionBibleReady,
    } = await import('./canvasPipeline')
    const metadata = writeProductionBible(undefined, {
      locked: true,
      visualStyle: 'cinematic noir',
      aspectRatio: '16:9',
      colorPalette: [{ name: 'cyan', hex: '#00ffff', weight: 0.5 }],
      negativePrompt: 'watermark',
    })
    expect(readProductionBible(metadata)?.locked).toBe(true)
    expect(isProductionBibleReady(metadata)).toBe(true)
    const prompt = buildProductionBiblePrompt(metadata)
    expect(prompt).toContain('全片视觉圣经')
    expect(prompt).toContain('cinematic noir')
    expect(prompt).toContain('16:9')
    expect(prompt).toContain('#00ffff')
  })
})

import { describe, expect, it } from 'vitest'
import {
  CANVAS_PIPELINE_OPS,
  buildOpPrompt,
  getOp,
  getOpsForNode,
  getOpsForRole,
} from './canvasPipelineOps'

describe('canvasPipelineOps', () => {
  it('op id 全局唯一', () => {
    const ids = CANVAS_PIPELINE_OPS.map((op) => op.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('剧本角色有四个专用 op', () => {
    expect(getOpsForRole('screenplay').map((op) => op.id)).toEqual([
      'screenplay.to_shot_script',
      'screenplay.extract_characters',
      'screenplay.extract_scenes',
      'screenplay.storyboard_grid',
    ])
  })

  it('角色/场景有出图 op', () => {
    expect(getOpsForRole('character').map((op) => op.id)).toEqual(['character.three_view'])
    expect(getOpsForRole('scene').map((op) => op.id)).toEqual(['scene.scene_image'])
  })

  describe('getOpsForNode', () => {
    it('无 role 的文本节点给全量文本菜单（转剧本 + 剧本类入口）', () => {
      const ops = getOpsForNode({ type: 'text' })
      expect(ops.map((op) => op.id)).toEqual([
        'chapter.to_screenplay',
        'screenplay.to_shot_script',
        'screenplay.extract_characters',
        'screenplay.extract_scenes',
        'screenplay.storyboard_grid',
      ])
    })
    it('章节节点（pipelineRole=chapter）与普通文本节点菜单一致', () => {
      const ops = getOpsForNode({ type: 'text', data: { pipelineRole: 'chapter' } })
      expect(ops.map((op) => op.id)).toEqual([
        'chapter.to_screenplay',
        'screenplay.to_shot_script',
        'screenplay.extract_characters',
        'screenplay.extract_scenes',
        'screenplay.storyboard_grid',
      ])
    })
    it('剧本节点（pipelineRole=screenplay）与普通文本节点菜单一致', () => {
      const ops = getOpsForNode({ type: 'text', data: { pipelineRole: 'screenplay' } })
      expect(ops.map((op) => op.id)).toEqual([
        'chapter.to_screenplay',
        'screenplay.to_shot_script',
        'screenplay.extract_characters',
        'screenplay.extract_scenes',
        'screenplay.storyboard_grid',
      ])
    })
    it('组节点也给文本流水线入口，由运行时展开组内文本', () => {
      const ops = getOpsForNode({ type: 'group' })
      expect(ops.map((op) => op.id)).toEqual([
        'chapter.to_screenplay',
        'screenplay.to_shot_script',
        'screenplay.extract_characters',
        'screenplay.extract_scenes',
        'screenplay.storyboard_grid',
      ])
    })
    it('非文本节点（image）有 role 时按角色匹配', () => {
      const ops = getOpsForNode({ type: 'image', data: { pipelineRole: 'character' } })
      expect(ops.map((op) => op.id)).toEqual(['character.three_view'])
    })
    it('无 role 的图片节点不给入口', () => {
      expect(getOpsForNode({ type: 'image' })).toEqual([])
    })
  })

  describe('buildOpPrompt', () => {
    it('生成分镜脚本委托分镜预设，含时长上限', () => {
      const prompt = buildOpPrompt('screenplay.to_shot_script', {
        upstreamText: '场1 候车室',
        maxClipSec: 8,
      })
      expect(prompt).toContain('场1 候车室')
      expect(prompt).toContain('不得超过 8 秒')
    })
    it('keepShotScriptPlaceholders=true 透传到分镜预设，保留占位槽', () => {
      const prompt = buildOpPrompt('screenplay.to_shot_script', {
        upstreamText: '场1',
        maxClipSec: 8,
        keepShotScriptPlaceholders: true,
      })
      expect(prompt).toContain('{maxClip}')
      expect(prompt).not.toContain('不得超过 8 秒')
    })
    it('提取角色委托抽取提示词', () => {
      const prompt = buildOpPrompt('screenplay.extract_characters', { upstreamText: '林岚登场' })
      expect(prompt).toContain('抽取其中出现的全部角色')
      expect(prompt).toContain('林岚登场')
    })
    it('提取场景委托抽取提示词', () => {
      const prompt = buildOpPrompt('screenplay.extract_scenes', { upstreamText: '车站' })
      expect(prompt).toContain('抽取其中出现的全部场景')
    })
    it('图像类 op 返回空（由 workspace 用资产构建）', () => {
      expect(buildOpPrompt('character.three_view', {})).toBe('')
    })
  })

  it('getOp 命中与未命中', () => {
    expect(getOp('shot.to_video')?.produces).toBe('clip')
    expect(getOp('nope')).toBeUndefined()
  })
})

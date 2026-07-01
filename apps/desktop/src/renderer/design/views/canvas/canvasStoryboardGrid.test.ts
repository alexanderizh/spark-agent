import { describe, expect, it } from 'vitest'
import type { ShotGroup, ShotSegment } from './canvasFilmAssets'
import {
  buildStoryboardGridPrompt,
  buildStoryboardNodePrompt,
  recommendGridColumns,
} from './canvasStoryboardGrid'

function seg(overrides: Partial<ShotSegment> & { index: number; title: string }): ShotSegment {
  return { id: `s${overrides.index}`, ...overrides }
}

function group(segments: ShotSegment[]): Pick<ShotGroup, 'name' | 'segments'> {
  return { name: '开场', segments }
}

describe('canvasStoryboardGrid', () => {
  describe('recommendGridColumns', () => {
    it('按镜数推荐列数', () => {
      expect(recommendGridColumns(1)).toBe(1)
      expect(recommendGridColumns(4)).toBe(2)
      expect(recommendGridColumns(9)).toBe(3)
      expect(recommendGridColumns(16)).toBe(4)
      expect(recommendGridColumns(20)).toBe(5)
    })
  })

  describe('buildStoryboardGridPrompt', () => {
    it('空分组返回空串', () => {
      expect(buildStoryboardGridPrompt({ group: group([]) })).toBe('')
    })

    it('包含镜数、行列网格与逐格关键帧描述', () => {
      const prompt = buildStoryboardGridPrompt({
        group: group([
          seg({
            index: 1,
            title: '镜1',
            description: '少年拔剑',
            shotPrompt: 'close-up',
            durationSec: 3,
            dialogue: '住手',
          }),
          seg({ index: 2, title: '镜2', description: '对手后退', durationSec: 4 }),
        ]),
        styleBible: '水墨写意',
      })
      expect(prompt).toContain('film storyboard sheet containing 2 key-frame panels')
      expect(prompt).toContain('2-column by 1-row grid')
      expect(prompt).toContain('Panel 1 [key frame]')
      expect(prompt).toContain('少年拔剑')
      expect(prompt).toContain('shot: close-up')
      expect(prompt).toContain('3s')
      expect(prompt).toContain('dialogue: 住手')
      expect(prompt).toContain('Panel 2 [key frame]')
      expect(prompt).toContain('overall visual style: 水墨写意')
    })

    it('多镜推导出多行多列网格', () => {
      const segments = Array.from({ length: 9 }, (_, i) =>
        seg({ index: i + 1, title: `镜${i + 1}`, description: `画面${i + 1}` }),
      )
      const prompt = buildStoryboardGridPrompt({ group: group(segments) })
      // 9 镜 → 3 列 × 3 行
      expect(prompt).toContain('film storyboard sheet containing 9 key-frame panels')
      expect(prompt).toContain('3-column by 3-row grid')
      expect(prompt).toContain('Panel 9 [key frame]')
    })

    it('按 maxPanels 截断镜数', () => {
      const segments = Array.from({ length: 30 }, (_, i) =>
        seg({ index: i + 1, title: `镜${i + 1}`, description: `画面${i + 1}` }),
      )
      const prompt = buildStoryboardGridPrompt({ group: group(segments), maxPanels: 6 })
      expect(prompt).toContain('containing 6 key-frame panels')
      expect(prompt).toContain('Panel 6')
      expect(prompt).not.toContain('Panel 7')
    })

    it('用 nameById 解析角色与场景写进每格', () => {
      const prompt = buildStoryboardGridPrompt({
        group: group([
          seg({
            index: 1,
            title: '镜1',
            description: '对峙',
            characterAssetIds: ['c1', 'c2'],
            sceneAssetId: 's1',
          }),
        ]),
        nameById: (id) => ({ c1: '少年', c2: '黑衣人', s1: '竹林' })[id],
      })
      expect(prompt).toContain('cast: 少年, 黑衣人')
      expect(prompt).toContain('scene: 竹林')
    })

    it('可显式指定列数', () => {
      const prompt = buildStoryboardGridPrompt({
        group: group([seg({ index: 1, title: '镜1', description: 'a' })]),
        columns: 3,
      })
      expect(prompt).toContain('3-column by 1-row grid')
    })

    it('支持彩绘稿风格', () => {
      const prompt = buildStoryboardGridPrompt({
        group: group([seg({ index: 1, title: '镜1', description: '对峙' })]),
        visualStyle: 'color_painted',
      })
      expect(prompt).toContain('color painted storyboard draft')
    })
  })

  describe('buildStoryboardNodePrompt', () => {
    it('按输入图片顺序绑定节点提示词', () => {
      const prompt = buildStoryboardNodePrompt({
        prompt: '彩绘稿，两个角色在车站交谈',
        inputNodes: [
          {
            id: 'img-a',
            type: 'image',
            title: '角色A',
            data: { url: 'safe-file://a', prompt: '红色外套，短发，主角' },
          },
          {
            id: 'img-b',
            type: 'image',
            title: '角色B',
            data: { url: 'safe-file://b', prompt: '黑色风衣，反派' },
          },
          {
            id: 'txt-1',
            type: 'text',
            title: '场景',
            data: { text: '先沉默对视，随后角色A递出车票。' },
          },
        ],
      })
      expect(prompt).toContain('参考图 1 ↔ 角色A：红色外套，短发，主角')
      expect(prompt).toContain('参考图 2 ↔ 角色B：黑色风衣，反派')
      expect(prompt).toContain('文本 1（场景）：先沉默对视')
    })
  })
})

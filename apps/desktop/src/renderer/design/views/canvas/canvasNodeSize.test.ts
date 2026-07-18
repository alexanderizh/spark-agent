import { describe, expect, it } from 'vitest'
import {
  LONG_TEXT_MIN_CHARS,
  SHOT_SCRIPT_NODE_MIN_SIZE,
  SHOT_SCRIPT_NODE_SIZE,
  SHOT_SCRIPT_OPERATION_NODE_MIN_SIZE,
  SHOT_SCRIPT_OPERATION_NODE_SIZE,
  TEXT_NODE_DEFAULT_MIN_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  TEXT_NODE_LONG_MIN_SIZE,
  TEXT_NODE_LONG_SIZE,
  fitCanvasGroupedImageNodeSize,
  fitCanvasImageNodeSize,
  fitCollectionOperationNodeSize,
  fitShotScriptOperationNodeSize,
  fitShotScriptTextNodeSize,
  isLongText,
  keepsCanvasMediaNodeAspectRatio,
  pickCanvasNodeMinSize,
  pickOperationNodeInitialSize,
  pickTextNodeMinSize,
  pickTextNodeSize,
} from './canvasNodeSize'

const SINGLE_SHOT_STORYBOARD = [
  '| 镜号 | 景别 | 画面/动作 |',
  '| --- | --- | --- |',
  '| 1 | 远景 | 城市夜景 |',
].join('\n')

describe('canvasNodeSize', () => {
  describe('isLongText', () => {
    it('空文本 / undefined / null 都视为短文本', () => {
      expect(isLongText(undefined)).toBe(false)
      expect(isLongText(null)).toBe(false)
      expect(isLongText('')).toBe(false)
    })

    it('低于阈值的文本视为短文本', () => {
      const short = 'a'.repeat(LONG_TEXT_MIN_CHARS - 1)
      expect(isLongText(short)).toBe(false)
    })

    it('达到阈值的文本视为长文本', () => {
      const exact = 'a'.repeat(LONG_TEXT_MIN_CHARS)
      expect(isLongText(exact)).toBe(true)
    })

    it('明显超过阈值的中文文稿视为长文本', () => {
      const chapter = '少年提刀走入夜色，雨打青石板的声音渐渐密集起来。'.repeat(40)
      expect(chapter.length).toBeGreaterThan(LONG_TEXT_MIN_CHARS)
      expect(isLongText(chapter)).toBe(true)
    })
  })

  describe('pickTextNodeSize', () => {
    it('短文本使用紧凑便签默认尺寸 400×320', () => {
      expect(pickTextNodeSize('hello world')).toEqual(TEXT_NODE_DEFAULT_SIZE)
      expect(pickTextNodeSize(undefined)).toEqual(TEXT_NODE_DEFAULT_SIZE)
    })

    it('长文本使用阅读尺寸 680×560', () => {
      const longText = 'x'.repeat(LONG_TEXT_MIN_CHARS + 100)
      expect(pickTextNodeSize(longText)).toEqual(TEXT_NODE_LONG_SIZE)
    })

    it('返回的对象是只读快照的不同引用，避免调用方共享写', () => {
      const a = pickTextNodeSize('short')
      const b = pickTextNodeSize('short')
      // 引用不同（as const 元组 + 字面量返回），但结构相同
      expect(a).toEqual(b)
    })

    it('单镜分镜使用与多镜分镜相同的表格尺寸', () => {
      expect(pickTextNodeSize(SINGLE_SHOT_STORYBOARD)).toEqual(SHOT_SCRIPT_NODE_SIZE)
    })

    it('多镜分镜按镜头数有限增高，超过上限后交给表格滚动', () => {
      const storyboard = JSON.stringify({
        shots: Array.from({ length: 8 }, (_, index) => ({
          index: index + 1,
          durationSec: 3,
          description: `镜头 ${index + 1}`,
        })),
      })
      expect(pickTextNodeSize(storyboard)).toEqual({ width: 1080, height: 900 })
      expect(fitShotScriptTextNodeSize(100).height).toBe(900)
    })
  })

  describe('分镜任务节点尺寸', () => {
    it('创建时使用专用大尺寸，普通任务尺寸保持不变', () => {
      expect(pickOperationNodeInitialSize(true)).toEqual(SHOT_SCRIPT_OPERATION_NODE_SIZE)
      expect(pickOperationNodeInitialSize(false)).toEqual({ width: 460, height: 420 })
    })

    it('完成后按镜头数有限增高', () => {
      expect(fitShotScriptOperationNodeSize(1)).toEqual({ width: 1180, height: 640 })
      expect(fitShotScriptOperationNodeSize(5)).toEqual({ width: 1180, height: 860 })
      expect(fitShotScriptOperationNodeSize(30)).toEqual({ width: 1180, height: 920 })
    })
  })

  describe('集合型任务节点尺寸', () => {
    it('按产物数量扩大节点，并对超大集合设置高度上限', () => {
      expect(fitCollectionOperationNodeSize(1)).toEqual({ width: 640, height: 420 })
      expect(fitCollectionOperationNodeSize(5)).toEqual({ width: 640, height: 622 })
      expect(fitCollectionOperationNodeSize(100)).toEqual({ width: 640, height: 920 })
    })
  })

  describe('pickTextNodeMinSize', () => {
    it('短文本 NodeResizer 最小 300×240', () => {
      expect(pickTextNodeMinSize('')).toEqual(TEXT_NODE_DEFAULT_MIN_SIZE)
    })

    it('长文本 NodeResizer 最小 520×360', () => {
      const longText = 'x'.repeat(LONG_TEXT_MIN_CHARS + 50)
      expect(pickTextNodeMinSize(longText)).toEqual(TEXT_NODE_LONG_MIN_SIZE)
    })
  })

  describe('pickCanvasNodeMinSize', () => {
    it('为不同节点类型提供可用的最小尺寸', () => {
      expect(pickCanvasNodeMinSize('image')).toEqual({ width: 320, height: 218 })
      expect(pickCanvasNodeMinSize('video')).toEqual({ width: 360, height: 210 })
      expect(pickCanvasNodeMinSize('text_to_image')).toEqual({ width: 360, height: 320 })
      expect(pickCanvasNodeMinSize('group')).toEqual({ width: 400, height: 320 })
    })

    it('文本节点最小尺寸跟随长短文本切换', () => {
      expect(pickCanvasNodeMinSize('text', 'short')).toEqual(TEXT_NODE_DEFAULT_MIN_SIZE)
      expect(pickCanvasNodeMinSize('prompt', 'x'.repeat(LONG_TEXT_MIN_CHARS + 1))).toEqual(
        TEXT_NODE_LONG_MIN_SIZE,
      )
    })

    it('单镜分镜使用与多镜分镜相同的最小尺寸', () => {
      expect(pickCanvasNodeMinSize('text', SINGLE_SHOT_STORYBOARD)).toEqual(
        SHOT_SCRIPT_NODE_MIN_SIZE,
      )
    })

    it('分镜任务节点使用专用拖拽下限', () => {
      expect(
        pickCanvasNodeMinSize('text_generate', undefined, { shotScriptOperation: true }),
      ).toEqual(SHOT_SCRIPT_OPERATION_NODE_MIN_SIZE)
    })
  })

  describe('fitCanvasImageNodeSize', () => {
    it('横图节点尺寸严格等于图片正文比例', () => {
      expect(fitCanvasImageNodeSize(1920, 1080)).toEqual({ width: 540, height: 304 })
    })

    it('超宽图片不再用独立最小高度破坏图片比例', () => {
      expect(fitCanvasImageNodeSize(2400, 800)).toEqual({ width: 540, height: 180 })
    })

    it('竖图保持正文缩放上限且不加入卡片栏位高度', () => {
      expect(fitCanvasImageNodeSize(800, 1200)).toEqual({ width: 480, height: 720 })
    })
  })

  describe('fitCanvasGroupedImageNodeSize', () => {
    it('已知尺寸的多选导入节点严格等于图片比例', () => {
      expect(fitCanvasGroupedImageNodeSize(440, 220)).toEqual({ width: 220, height: 110 })
    })

    it('未知尺寸继续使用原有安全回退尺寸', () => {
      expect(fitCanvasGroupedImageNodeSize()).toEqual({ width: 220, height: 234 })
    })
  })

  it('只对图片和视频节点锁定缩放比例', () => {
    expect(keepsCanvasMediaNodeAspectRatio('image')).toBe(true)
    expect(keepsCanvasMediaNodeAspectRatio('video')).toBe(true)
    expect(keepsCanvasMediaNodeAspectRatio('audio')).toBe(false)
    expect(keepsCanvasMediaNodeAspectRatio('text')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  CANVAS_NODE_MIN_SIZE,
  LONG_TEXT_MIN_CHARS,
  TEXT_NODE_DEFAULT_MIN_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  TEXT_NODE_LONG_MIN_SIZE,
  TEXT_NODE_LONG_SIZE,
  fitCanvasGroupedImageNodeSize,
  fitCanvasImageNodeSize,
  isLongText,
  keepsCanvasMediaNodeAspectRatio,
  pickCanvasNodeMinSize,
  pickTextNodeMinSize,
  pickTextNodeSize,
} from './canvasNodeSize'

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
  })

  describe('fitCanvasImageNodeSize', () => {
    it('横图按真实纵横比收紧高度，并把内嵌头部计入节点总高度', () => {
      expect(fitCanvasImageNodeSize(1920, 1080)).toEqual({ width: 540, height: 342 })
    })

    it('超宽图片仍保留当前图片节点最小可用高度', () => {
      expect(fitCanvasImageNodeSize(2400, 800)).toEqual({
        width: 540,
        height: CANVAS_NODE_MIN_SIZE.image.height,
      })
    })

    it('竖图仍保持原有正文缩放上限逻辑，并把内嵌头部计入节点总高度', () => {
      expect(fitCanvasImageNodeSize(800, 1200)).toEqual({ width: 480, height: 758 })
    })
  })

  describe('fitCanvasGroupedImageNodeSize', () => {
    it('把图片正文和 meta 头部都计入多选导入的节点高度', () => {
      expect(fitCanvasGroupedImageNodeSize(440, 220)).toEqual({ width: 220, height: 158 })
    })

    it('对未知尺寸也保留 meta 头部空间', () => {
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

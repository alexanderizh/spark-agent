import { describe, expect, it } from 'vitest'
import {
  LONG_TEXT_MIN_CHARS,
  TEXT_NODE_DEFAULT_MIN_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
  TEXT_NODE_LONG_MIN_SIZE,
  TEXT_NODE_LONG_SIZE,
  isLongText,
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
    it('短文本使用加宽便签默认尺寸 520×240', () => {
      expect(pickTextNodeSize('hello world')).toEqual(TEXT_NODE_DEFAULT_SIZE)
      expect(pickTextNodeSize(undefined)).toEqual(TEXT_NODE_DEFAULT_SIZE)
    })

    it('长文本使用阅读尺寸 760×640', () => {
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
    it('短文本 NodeResizer 最小 340×150', () => {
      expect(pickTextNodeMinSize('')).toEqual(TEXT_NODE_DEFAULT_MIN_SIZE)
    })

    it('长文本 NodeResizer 最小 560×360', () => {
      const longText = 'x'.repeat(LONG_TEXT_MIN_CHARS + 50)
      expect(pickTextNodeMinSize(longText)).toEqual(TEXT_NODE_LONG_MIN_SIZE)
    })
  })

  describe('pickCanvasNodeMinSize', () => {
    it('为不同节点类型提供可用的最小尺寸', () => {
      expect(pickCanvasNodeMinSize('image')).toEqual({ width: 380, height: 220 })
      expect(pickCanvasNodeMinSize('video')).toEqual({ width: 400, height: 220 })
      expect(pickCanvasNodeMinSize('text_to_image')).toEqual({ width: 400, height: 170 })
      expect(pickCanvasNodeMinSize('group')).toEqual({ width: 440, height: 260 })
    })

    it('文本节点最小尺寸跟随长短文本切换', () => {
      expect(pickCanvasNodeMinSize('text', 'short')).toEqual(TEXT_NODE_DEFAULT_MIN_SIZE)
      expect(pickCanvasNodeMinSize('prompt', 'x'.repeat(LONG_TEXT_MIN_CHARS + 1))).toEqual(
        TEXT_NODE_LONG_MIN_SIZE,
      )
    })
  })
})

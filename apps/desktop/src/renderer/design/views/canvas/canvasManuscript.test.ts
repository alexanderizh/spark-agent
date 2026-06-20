import { describe, expect, it } from 'vitest'
import {
  chunkByLength,
  countChars,
  isChapterHeading,
  splitTextIntoChapters,
} from './canvasManuscript'

describe('canvasManuscript', () => {
  describe('isChapterHeading', () => {
    it('识别中文章节标题', () => {
      expect(isChapterHeading('第一章 风起')).toBe(true)
      expect(isChapterHeading('第1章')).toBe(true)
      expect(isChapterHeading('第十二回 夜行')).toBe(true)
      expect(isChapterHeading('序章')).toBe(true)
      expect(isChapterHeading('楔子')).toBe(true)
      expect(isChapterHeading('番外：旧事')).toBe(true)
    })

    it('识别英文章节标题', () => {
      expect(isChapterHeading('Chapter 1')).toBe(true)
      expect(isChapterHeading('Chapter IV The Storm')).toBe(true)
      expect(isChapterHeading('PART 2')).toBe(true)
    })

    it('不把正文段落误判为标题', () => {
      expect(isChapterHeading('他翻开第一章，发现里面夹着一封信，信纸已经泛黄，字迹也模糊了。')).toBe(false)
      expect(isChapterHeading('这是一段普通的叙述文字。')).toBe(false)
      expect(isChapterHeading('')).toBe(false)
    })
  })

  describe('countChars', () => {
    it('按非空白字符计数', () => {
      expect(countChars('你好 世界\n！')).toBe(5)
    })
  })

  describe('splitTextIntoChapters - heading 模式', () => {
    it('按章标题切分并保留正文', () => {
      const text = [
        '第一章 风起',
        '少年提刀走入夜色。',
        '风很大。',
        '',
        '第二章 雨落',
        '雨水打湿了石阶。',
      ].join('\n')
      const result = splitTextIntoChapters(text)
      expect(result.mode).toBe('heading')
      expect(result.chapters).toHaveLength(2)
      expect(result.chapters[0].title).toBe('第一章 风起')
      expect(result.chapters[0].content).toContain('少年提刀')
      expect(result.chapters[0].content).not.toContain('第二章')
      expect(result.chapters[1].title).toBe('第二章 雨落')
      expect(result.chapters[1].index).toBe(1)
    })

    it('把第一个标题之前的内容作为前言', () => {
      const text = ['这是一段引言，没有章号。', '', '第一章 开始', '正文内容。'].join('\n')
      const result = splitTextIntoChapters(text)
      expect(result.chapters).toHaveLength(2)
      expect(result.chapters[0].title).toBe('前言')
      expect(result.chapters[0].content).toContain('引言')
      expect(result.chapters[1].title).toBe('第一章 开始')
    })
  })

  describe('splitTextIntoChapters - length 退化模式', () => {
    it('无标题时按长度分片', () => {
      const para = '甲'.repeat(100)
      const text = Array.from({ length: 10 }, () => para).join('\n\n')
      const result = splitTextIntoChapters(text, { maxCharsPerChunk: 250 })
      expect(result.mode).toBe('length')
      expect(result.chapters.length).toBeGreaterThan(1)
      expect(result.chapters[0].title).toBe('分片 1')
    })
  })

  describe('chunkByLength', () => {
    it('空文本返回空数组', () => {
      expect(chunkByLength('   ')).toEqual([])
    })

    it('在段落边界分片', () => {
      const text = ['段落甲'.repeat(50), '段落乙'.repeat(50), '段落丙'.repeat(50)].join('\n\n')
      const chapters = chunkByLength(text, 200)
      expect(chapters.length).toBeGreaterThanOrEqual(2)
      expect(chapters.every((c) => c.charCount > 0)).toBe(true)
    })
  })
})

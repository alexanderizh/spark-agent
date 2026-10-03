import { describe, expect, it } from 'vitest'
import { describeEchoMatch, isLikelyTtsEcho, normalizeForEchoMatch } from './VoiceEchoGuard.js'

describe('VoiceEchoGuard', () => {
  describe('normalizeForEchoMatch', () => {
    it('去标点空白、全角数字统一、小写化', () => {
      expect(normalizeForEchoMatch('你好，World！２０２４年。')).toBe('你好world2024年')
    })
  })

  describe('isLikelyTtsEcho', () => {
    const ttsTexts = ['今天晴，气温二十五度。', '适合出行，记得防晒。', '还有什么可以帮你？']

    it('转写是 TTS 句子的子串 → 判回声', () => {
      expect(isLikelyTtsEcho('今天晴，气温二十五度。', ttsTexts)).toBe(true)
      expect(isLikelyTtsEcho('气温二十五度', ttsTexts)).toBe(true)
    })

    it('转写跨相邻两句边界（拼接窗口）→ 判回声', () => {
      expect(isLikelyTtsEcho('记得防晒。还有什么可以帮你', ttsTexts)).toBe(true)
    })

    it('高相似复述（bigram Dice ≥ 0.7）→ 判回声', () => {
      expect(isLikelyTtsEcho('今天晴，气温二十六度。', ttsTexts)).toBe(true) // 一字之差
    })

    it('短文本（<6 字归一化后）不判定（交给能量门控）', () => {
      expect(isLikelyTtsEcho('晴', ttsTexts)).toBe(false)
      expect(isLikelyTtsEcho('今天晴', ttsTexts)).toBe(false)
    })

    it('正常用户输入（低相似、非子串）→ 不判回声', () => {
      expect(isLikelyTtsEcho('帮我把空调打开一下', ttsTexts)).toBe(false)
      expect(isLikelyTtsEcho('再查一下明天的日程安排', ttsTexts)).toBe(false)
    })

    it('「再念一遍」类祈使句有引导词 → 不误杀', () => {
      expect(isLikelyTtsEcho('把第二句再念一遍', ttsTexts)).toBe(false)
      expect(isLikelyTtsEcho('重复一下刚才说的话', ttsTexts)).toBe(false)
    })

    it('空 TTS 文本列表 → 不判回声', () => {
      expect(isLikelyTtsEcho('任何内容都行', [])).toBe(false)
    })
  })

  describe('describeEchoMatch（日志详情）', () => {
    it('返回最接近句的长度与相似度', () => {
      const detail = describeEchoMatch('今天晴，气温二十五度。', ['今天晴，气温二十五度。'])
      expect(detail.matchedTtsLen).toBe(normalizeForEchoMatch('今天晴，气温二十五度。').length)
      expect(detail.bestRatio).toBe(1)
    })
  })
})

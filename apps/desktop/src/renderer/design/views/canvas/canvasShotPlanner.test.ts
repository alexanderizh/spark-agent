import { describe, expect, it } from 'vitest'
import {
  estimateSpeechDurationSec,
  planShotsFromScene,
  totalPlannedDurationSec,
} from './canvasShotPlanner'

describe('canvasShotPlanner', () => {
  describe('estimateSpeechDurationSec', () => {
    it('按字数/语速估时长', () => {
      expect(estimateSpeechDurationSec('十个字的一句话啊哈', 5)).toBeCloseTo(9 / 5, 5)
    })
    it('空文本为 0', () => {
      expect(estimateSpeechDurationSec('   ')).toBe(0)
    })
    it('至少 1 秒', () => {
      expect(estimateSpeechDurationSec('好', 5)).toBe(1)
    })
  })

  describe('planShotsFromScene', () => {
    it('对白行按语速、动作行按节奏基线', () => {
      const sceneText = [
        '【内景 客厅 夜】',
        '主角推开门，环顾四周。',
        '主角：你到底来不来？',
        '窗外雷声大作。',
      ].join('\n')
      const shots = planShotsFromScene({ sceneText, pacingSecPerShot: 3 })
      // 跳过场次标题行，剩 3 镜
      expect(shots).toHaveLength(3)
      expect(shots[0]!.description).toContain('推开门')
      expect(shots[0]!.durationSec).toBe(3)
      // 对白镜：提取说话人 + 对白
      expect(shots[1]!.dialogue).toBe('你到底来不来？')
      expect(shots[1]!.title).toContain('主角')
      expect(shots[2]!.durationSec).toBe(3)
    })

    it('时长夹在 [minSec, maxSec]', () => {
      const sceneText = '甲：' + '字'.repeat(100)
      const shots = planShotsFromScene({ sceneText, maxSec: 8 })
      expect(shots[0]!.durationSec).toBeLessThanOrEqual(8)
      expect(shots[0]!.durationSec).toBeGreaterThanOrEqual(1.5)
    })

    it('镜号连续递增', () => {
      const sceneText = ['动作一。', '动作二。', '动作三。'].join('\n')
      const shots = planShotsFromScene({ sceneText })
      expect(shots.map((s) => s.index)).toEqual([1, 2, 3])
    })

    it('空文本返回空', () => {
      expect(planShotsFromScene({ sceneText: '   ' })).toEqual([])
    })
  })

  describe('totalPlannedDurationSec', () => {
    it('累加分镜时长', () => {
      const shots = planShotsFromScene({
        sceneText: ['动作一。', '动作二。'].join('\n'),
        pacingSecPerShot: 2.5,
      })
      expect(totalPlannedDurationSec(shots)).toBe(5)
    })
  })
})

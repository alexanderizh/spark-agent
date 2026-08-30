import { describe, expect, it } from 'vitest'
import type { ShotSegment } from './canvasFilmAssets'
import { planSegmentSplit, resolveSegmentDuration, splitSegmentAt } from './canvasShotSplit'

function makeSegment(overrides: Partial<ShotSegment> = {}): ShotSegment {
  return {
    id: 'seg1',
    index: 1,
    title: '镜1',
    description: '少年拔剑',
    dialogue: '住手！',
    durationSec: 12,
    inSec: 0,
    outSec: 12,
    characterAssetIds: ['c1'],
    sceneAssetId: 's1',
    cameraDesignId: 'cam1',
    ...overrides,
  }
}

describe('canvasShotSplit', () => {
  describe('resolveSegmentDuration', () => {
    it('优先 durationSec', () => {
      expect(resolveSegmentDuration({ durationSec: 6, inSec: 0, outSec: 4 })).toBe(6)
    })
    it('退化为 out-in', () => {
      expect(resolveSegmentDuration({ inSec: 2, outSec: 7 })).toBe(5)
    })
    it('都没有则 0', () => {
      expect(resolveSegmentDuration({})).toBe(0)
    })
  })

  describe('planSegmentSplit by maxClipSec', () => {
    it('12 秒按 5 秒上限拆成 3 段', () => {
      const parts = planSegmentSplit(makeSegment(), { maxClipSec: 5 })
      expect(parts).toHaveLength(3)
      expect(parts.every((p) => p.durationSec <= 5)).toBe(true)
    })

    it('拆分后 in/out 连续且收尾对齐父镜', () => {
      const parts = planSegmentSplit(makeSegment({ durationSec: 12, inSec: 0 }), { maxClipSec: 5 })
      expect(parts[0]!.inSec).toBe(0)
      for (let i = 1; i < parts.length; i += 1) {
        expect(parts[i]!.inSec).toBe(parts[i - 1]!.outSec)
      }
      expect(parts.at(-1)!.outSec).toBe(12)
    })

    it('从父镜 inSec 偏移累计', () => {
      const parts = planSegmentSplit(makeSegment({ durationSec: 10, inSec: 30, outSec: 40 }), {
        maxClipSec: 5,
      })
      expect(parts[0]!.inSec).toBe(30)
      expect(parts.at(-1)!.outSec).toBe(40)
    })

    it('对白只保留在第一段', () => {
      const parts = planSegmentSplit(makeSegment(), { maxClipSec: 5 })
      expect(parts[0]!.dialogue).toBe('住手！')
      expect(parts[1]!.dialogue).toBeUndefined()
      expect(parts[2]!.dialogue).toBeUndefined()
    })

    it('各段继承资源引用与风格预设', () => {
      const parts = planSegmentSplit(makeSegment(), { maxClipSec: 5 })
      for (const part of parts) {
        expect(part.characterAssetIds).toEqual(['c1'])
        expect(part.sceneAssetId).toBe('s1')
        expect(part.cameraDesignId).toBe('cam1')
      }
    })

    it('继承静态分镜控制，但不复制已失效的父镜时间轴', () => {
      const parts = planSegmentSplit(
        makeSegment({
          composition: '主体落在右上交点',
          blocking: '人物距镜头 220cm',
          lighting: '主辅光比 4:1',
          characterReferences: '林岚=雨夜造型图',
          continuity: '保持右手持剑',
          negativePrompt: '手指畸形',
          actionBeats: '0.0–0.5s：拔剑',
          soundEffects: '0.5s：剑鸣',
          transition: '入：硬切；出：硬切',
          firstFrame: '剑未出鞘',
          lastFrame: '剑尖向前',
        }),
        { maxClipSec: 5 },
      )

      for (const part of parts) {
        expect(part.composition).toBe('主体落在右上交点')
        expect(part.blocking).toBe('人物距镜头 220cm')
        expect(part.lighting).toBe('主辅光比 4:1')
        expect(part.continuity).toBe('保持右手持剑')
        expect(part.actionBeats).toBeUndefined()
        expect(part.soundEffects).toBeUndefined()
        expect(part.transition).toBeUndefined()
      }
      expect(parts[0]?.firstFrame).toBe('剑未出鞘')
      expect(parts[0]?.lastFrame).toBeUndefined()
      expect(parts.at(-1)?.firstFrame).toBeUndefined()
      expect(parts.at(-1)?.lastFrame).toBe('剑尖向前')
    })

    it('短于上限不拆，返回单段', () => {
      const parts = planSegmentSplit(
        makeSegment({
          durationSec: 4,
          outSec: 4,
          actionBeats: '0.0–4.0s：完整动作',
          firstFrame: '起始帧',
          lastFrame: '结束帧',
        }),
        { maxClipSec: 5 },
      )
      expect(parts).toHaveLength(1)
      expect(parts[0]!.title).toBe('镜1')
      expect(parts[0]!.actionBeats).toBe('0.0–4.0s：完整动作')
      expect(parts[0]!.firstFrame).toBe('起始帧')
      expect(parts[0]!.lastFrame).toBe('结束帧')
    })

    it('未知时长用上限兜底每段时长', () => {
      const noDuration: ShotSegment = { id: 'seg1', index: 1, title: '镜1' }
      const parts = planSegmentSplit(noDuration, { parts: 2, maxClipSec: 5 })
      expect(parts).toHaveLength(2)
      expect(parts.every((p) => p.durationSec > 0)).toBe(true)
    })
  })

  describe('planSegmentSplit by parts', () => {
    it('显式段数优先于时长上限', () => {
      const parts = planSegmentSplit(makeSegment({ durationSec: 12 }), { parts: 4, maxClipSec: 5 })
      expect(parts).toHaveLength(4)
    })
  })

  describe('splitSegmentAt', () => {
    it('在指定秒切成两段', () => {
      const parts = splitSegmentAt(makeSegment({ durationSec: 10, inSec: 0, outSec: 10 }), 4)
      expect(parts).toHaveLength(2)
      expect(parts[0]!.outSec).toBe(4)
      expect(parts[1]!.inSec).toBe(4)
      expect(parts[1]!.outSec).toBe(10)
    })

    it('越界切点退化为均分', () => {
      const parts = splitSegmentAt(makeSegment({ durationSec: 10, inSec: 0, outSec: 10 }), 99)
      expect(parts[0]!.outSec).toBe(5)
    })
  })
})

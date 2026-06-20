import { describe, expect, it } from 'vitest'
import type { ShotGroup } from './canvasFilmAssets'
import {
  buildEdlMarkdown,
  buildTimeline,
  formatTimecode,
  totalRuntimeSec,
} from './canvasFilmTimeline'

function group(name: string, sortOrder: number, segs: Array<Partial<ShotGroup['segments'][number]> & { index: number; title: string }>): ShotGroup {
  return {
    id: `g_${name}`,
    name,
    sortOrder,
    segments: segs.map((s) => ({ id: `s_${s.index}`, ...s })),
  }
}

describe('canvasFilmTimeline', () => {
  describe('buildTimeline', () => {
    it('按分组顺序 + 镜号累计时间码', () => {
      const groups: ShotGroup[] = [
        group('B', 1, [{ index: 1, title: '镜1', durationSec: 2 }]),
        group('A', 0, [
          { index: 2, title: '镜2', durationSec: 3 },
          { index: 1, title: '镜1', durationSec: 4 },
        ]),
      ]
      const timeline = buildTimeline(groups)
      // A 组先(sortOrder 0)，组内按 index 升序：A镜1(4s)@0, A镜2(3s)@4, B镜1(2s)@7
      expect(timeline.map((e) => [e.groupName, e.segmentTitle, e.startSec])).toEqual([
        ['A', '镜1', 0],
        ['A', '镜2', 4],
        ['B', '镜1', 7],
      ])
    })

    it('缺省时长回退默认值', () => {
      const groups: ShotGroup[] = [group('A', 0, [{ index: 1, title: '镜1' }])]
      expect(buildTimeline(groups)[0]!.durationSec).toBe(3)
    })

    it('in/out 推导时长', () => {
      const groups: ShotGroup[] = [group('A', 0, [{ index: 1, title: '镜1', inSec: 2, outSec: 6.5 }])]
      expect(buildTimeline(groups)[0]!.durationSec).toBe(4.5)
    })
  })

  describe('totalRuntimeSec', () => {
    it('累加总时长', () => {
      const groups: ShotGroup[] = [
        group('A', 0, [
          { index: 1, title: '镜1', durationSec: 2.5 },
          { index: 2, title: '镜2', durationSec: 3 },
        ]),
      ]
      expect(totalRuntimeSec(buildTimeline(groups))).toBe(5.5)
    })
  })

  describe('formatTimecode', () => {
    it('mm:ss.s 格式', () => {
      expect(formatTimecode(0)).toBe('00:00.0')
      expect(formatTimecode(65.5)).toBe('01:05.5')
    })
  })

  describe('buildEdlMarkdown', () => {
    it('包含概览与表格行', () => {
      const groups: ShotGroup[] = [
        group('A', 0, [{ index: 1, title: '镜1', durationSec: 3, dialogue: '你好' }]),
      ]
      const md = buildEdlMarkdown('测试', buildTimeline(groups))
      expect(md).toContain('# 成片清单 (EDL) · 测试')
      expect(md).toContain('镜头数：1')
      expect(md).toContain('你好')
    })
  })
})

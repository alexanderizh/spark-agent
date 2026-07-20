import { describe, expect, it } from 'vitest'
import {
  createDefaultVideoWorkbenchData,
  formatTimestamp,
  readVideoWorkbenchData,
  type WorkbenchResource,
} from './videoWorkbench.types'

describe('videoWorkbench.types', () => {
  describe('createDefaultVideoWorkbenchData', () => {
    it('initializes the new resourcePanel/track/autoCollectUpstream fields', () => {
      const d = createDefaultVideoWorkbenchData()
      expect(d.resourcePanel).toEqual([])
      expect(d.track).toEqual([])
      expect(d.autoCollectUpstream).toBe(true)
      // 旧字段仍要保留
      expect(d.keyframes).toEqual([])
      expect(d.outputs).toEqual([])
      expect(d.activeTab).toBe('resources')
    })
  })

  describe('readVideoWorkbenchData', () => {
    it('returns defaults when raw is undefined', () => {
      const d = readVideoWorkbenchData(undefined)
      expect(d).toEqual(createDefaultVideoWorkbenchData())
    })

    it('preserves legacy fields when new fields are missing', () => {
      const d = readVideoWorkbenchData({
        keyframes: [{ path: '/a.jpg', previewUrl: 'safe-file:///a', timestampSec: 1.2, index: 0 }],
        outputs: [],
        manualMarks: [1.5, 3],
        activeTab: 'frames',
      })
      expect(d.keyframes).toHaveLength(1)
      expect(d.manualMarks).toEqual([1.5, 3])
      expect(d.activeTab).toBe('frames')
      // 新字段使用默认值
      expect(d.resourcePanel).toEqual([])
      expect(d.track).toEqual([])
      expect(d.autoCollectUpstream).toBe(true)
    })

    it('parses new resourcePanel and track when present', () => {
      const resources: WorkbenchResource[] = [
        {
          id: 'r1',
          source: 'upstream',
          kind: 'video',
          title: '上游视频',
          url: 'safe-file:///a.mp4',
          originPath: '/a.mp4',
          durationSec: 12,
          importedAt: 0,
        },
      ]
      const d = readVideoWorkbenchData({
        resourcePanel: resources,
        track: [{ id: 'c1', resourceId: 'r1', order: 0, staticDuration: 8 }],
        autoCollectUpstream: false,
        activeTab: 'resources',
      })
      expect(d.resourcePanel).toHaveLength(1)
      expect(d.resourcePanel[0]!.id).toBe('r1')
      expect(d.track).toHaveLength(1)
      expect(d.track[0]!.resourceId).toBe('r1')
      expect(d.autoCollectUpstream).toBe(false)
    })

    it('drops malformed resource entries silently', () => {
      const d = readVideoWorkbenchData({
        resourcePanel: [
          {
            id: 'good',
            source: 'local',
            kind: 'video',
            title: 'g',
            url: 'u',
            originPath: '/good.mp4',
            importedAt: 0,
          },
          {
            id: 'missing-path',
            source: 'local',
            kind: 'video',
            title: 'b',
            url: 'u',
            importedAt: 0,
          },
          { /* missing id */ source: 'local', kind: 'video', title: 'b', url: 'u' },
          { id: 'bad-kind', source: 'local', kind: 'audio', title: 'b', url: 'u' },
        ],
      })
      expect(d.resourcePanel).toHaveLength(1)
      expect(d.resourcePanel[0]!.id).toBe('good')
    })

    it('drops malformed track entries silently', () => {
      const d = readVideoWorkbenchData({
        resourcePanel: [
          {
            id: 'r1',
            source: 'local',
            kind: 'video',
            title: 'resource',
            url: 'u',
            originPath: '/resource.mp4',
            importedAt: 0,
          },
        ],
        track: [
          { id: 'c1', resourceId: 'r1', order: 0 },
          { id: 'invalid-order', resourceId: 'r1', order: Number.NaN },
          { id: 'dangling', resourceId: 'missing', order: 1 },
          { id: 'c2' /* missing resourceId */ },
          null,
        ],
      })
      expect(d.track).toHaveLength(1)
      expect(d.track[0]!.id).toBe('c1')
    })
  })

  describe('formatTimestamp', () => {
    it('formats seconds as mm:ss', () => {
      expect(formatTimestamp(0)).toBe('00:00')
      expect(formatTimestamp(9)).toBe('00:09')
      expect(formatTimestamp(65)).toBe('01:05')
    })

    it('switches to hh:mm:ss past one hour', () => {
      expect(formatTimestamp(3661)).toBe('01:01:01')
    })

    it('handles non-finite / negative values', () => {
      expect(formatTimestamp(NaN)).toBe('00:00')
      expect(formatTimestamp(-5)).toBe('00:00')
    })
  })
})

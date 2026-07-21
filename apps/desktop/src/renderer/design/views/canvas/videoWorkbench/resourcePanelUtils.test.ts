import { describe, expect, it } from 'vitest'
import {
  appendResourceToTrack,
  calculateTrackDuration,
  clipDurationSec,
  clipSeekTimeSec,
  clipStartSecInTrack,
  collectUpstreamResources,
  DEFAULT_IMAGE_STATIC_DURATION_SEC,
  indexResourcesById,
  insertResourceIntoTrack,
  isResourceUsedInTrack,
  mergeResources,
  moveClipRelativeTo,
  pickPrimaryArtifact,
  removeTrackClip,
  reorderTrack,
  resolveClipAtGlobalTime,
  shouldSeedSourceTrack,
  splitTrackClip,
  upstreamNodeToResource,
  type UpstreamNodeRef,
} from './resourcePanelUtils'
import type { TrackClip, WorkbenchResource } from './videoWorkbench.types'

function makeResource(partial: Partial<WorkbenchResource> & { id: string }): WorkbenchResource {
  const base: WorkbenchResource = {
    id: partial.id,
    source: partial.source ?? 'local',
    kind: partial.kind ?? 'video',
    title: partial.title ?? `r-${partial.id}`,
    url: partial.url ?? `safe-file://${partial.id}`,
    originPath: partial.originPath ?? `/tmp/${partial.id}`,
    importedAt: partial.importedAt ?? 0,
  }
  // 条件 spread 避免把 undefined 赋给可选字段（exactOptionalPropertyTypes）
  return {
    ...base,
    ...(partial.thumbnailUrl !== undefined ? { thumbnailUrl: partial.thumbnailUrl } : {}),
    ...(partial.durationSec !== undefined ? { durationSec: partial.durationSec } : {}),
    ...(partial.width !== undefined ? { width: partial.width } : {}),
    ...(partial.height !== undefined ? { height: partial.height } : {}),
    ...(partial.fileSize !== undefined ? { fileSize: partial.fileSize } : {}),
    ...(partial.upstreamNodeId !== undefined ? { upstreamNodeId: partial.upstreamNodeId } : {}),
    ...(partial.upstreamArtifactIndex !== undefined
      ? { upstreamArtifactIndex: partial.upstreamArtifactIndex }
      : {}),
  }
}

function makeClip(partial: Partial<TrackClip> & { id: string; resourceId: string }): TrackClip {
  const base: TrackClip = {
    id: partial.id,
    resourceId: partial.resourceId,
    order: partial.order ?? 0,
  }
  return {
    ...base,
    ...(partial.range !== undefined ? { range: partial.range } : {}),
    ...(partial.staticDuration !== undefined ? { staticDuration: partial.staticDuration } : {}),
  }
}

describe('resourcePanelUtils', () => {
  describe('shouldSeedSourceTrack', () => {
    it('seeds a legacy source only when neither a track nor migrated resource exists', () => {
      const source = makeResource({ id: 'source:workbench' })
      expect(shouldSeedSourceTrack([], [], source.id)).toBe(true)
      expect(
        shouldSeedSourceTrack([makeClip({ id: 'clip', resourceId: source.id })], [], source.id),
      ).toBe(false)
      expect(shouldSeedSourceTrack([], [source], source.id)).toBe(false)
    })
  })

  describe('pickPrimaryArtifact', () => {
    it('returns null for empty input', () => {
      expect(pickPrimaryArtifact([])).toBeNull()
      expect(pickPrimaryArtifact(undefined as never)).toBeNull()
    })

    it('prefers the first video over any image', () => {
      const result = pickPrimaryArtifact([
        { id: 'i1', kind: 'image', url: 'u1', originPath: 'o1', title: 'img-1' },
        { id: 'v1', kind: 'video', url: 'u2', originPath: 'o2', title: 'vid-1' },
        { id: 'v2', kind: 'video', url: 'u3', originPath: 'o3', title: 'vid-2' },
      ])
      expect(result?.id).toBe('v1')
    })

    it('falls back to the first image when there is no video', () => {
      const result = pickPrimaryArtifact([
        { id: 'i1', kind: 'image', url: 'u1', originPath: 'o1', title: 'img-1' },
        { id: 'i2', kind: 'image', url: 'u2', originPath: 'o2', title: 'img-2' },
      ])
      expect(result?.id).toBe('i1')
    })
  })

  describe('upstreamNodeToResource / collectUpstreamResources', () => {
    it('skips nodes without any artifact', () => {
      const node: UpstreamNodeRef = { nodeId: 'n1', title: 'empty', artifacts: [] }
      expect(upstreamNodeToResource(node, 1)).toBeNull()
    })

    it('builds a resource from the primary artifact', () => {
      const node: UpstreamNodeRef = {
        nodeId: 'n1',
        title: 'node1',
        artifacts: [
          { id: 'a1', kind: 'image', url: 'u', originPath: 'p', title: 'a' },
          { id: 'a2', kind: 'video', url: 'u2', originPath: 'p2', title: 'b' },
        ],
      }
      const r = upstreamNodeToResource(node, 100)
      expect(r?.id).toBe('a2')
      expect(r?.source).toBe('upstream')
      expect(r?.upstreamNodeId).toBe('n1')
      // a2 在节点产物列表里是 index=1（image 在前，video 在后）
      expect(r?.upstreamArtifactIndex).toBe(1)
      expect(r?.importedAt).toBe(100)
    })

    it('collects across multiple nodes and preserves order', () => {
      const nodes: UpstreamNodeRef[] = [
        {
          nodeId: 'n1',
          title: 'A',
          artifacts: [{ id: 'v1', kind: 'video', url: 'u1', originPath: 'p1', title: 'A' }],
        },
        {
          nodeId: 'n2',
          title: 'B',
          artifacts: [{ id: 'i1', kind: 'image', url: 'u2', originPath: 'p2', title: 'B' }],
        },
        { nodeId: 'n3', title: 'C', artifacts: [] },
      ]
      const result = collectUpstreamResources(nodes, 0)
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.title)).toEqual(['A', 'B'])
    })
  })

  describe('isResourceUsedInTrack', () => {
    it('returns true when at least one clip references the resource', () => {
      const track = [makeClip({ id: 'c1', resourceId: 'r1' })]
      expect(isResourceUsedInTrack(track, 'r1')).toBe(true)
      expect(isResourceUsedInTrack(track, 'r2')).toBe(false)
    })

    it('handles empty track safely', () => {
      expect(isResourceUsedInTrack([], 'r1')).toBe(false)
    })
  })

  describe('appendResourceToTrack', () => {
    it('appends to the end and assigns the next order', () => {
      const track = [makeClip({ id: 'c1', resourceId: 'r1', order: 0 })]
      const resource = makeResource({ id: 'r2', kind: 'video' })
      const next = appendResourceToTrack(track, resource)
      expect(next).toHaveLength(2)
      const appended = next[1]!
      expect(appended.resourceId).toBe('r2')
      expect(appended.order).toBe(1)
      expect(appended.staticDuration).toBeUndefined()
    })

    it('uses image static duration for image resources', () => {
      const resource = makeResource({ id: 'r3', kind: 'image' })
      const next = appendResourceToTrack([], resource)
      expect(next[0]!.staticDuration).toBe(DEFAULT_IMAGE_STATIC_DURATION_SEC)
    })

    it('returns the original array when resource is missing', () => {
      const track = [makeClip({ id: 'c1', resourceId: 'r1' })]
      const next = appendResourceToTrack(track, null as never)
      expect(next).toEqual(track)
      expect(next).not.toBe(track) // 仍然返回新数组以保持不可变语义
    })
  })

  describe('insertResourceIntoTrack', () => {
    const track = () => [
      makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
      makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
    ]

    it('deduplicates against the latest track passed to the state updater', () => {
      expect(insertResourceIntoTrack(track(), makeResource({ id: 'r2' }))).toEqual(track())
    })

    it('supports inserting first, last, or after an existing clip', () => {
      const resource = makeResource({ id: 'r3' })
      expect(insertResourceIntoTrack(track(), resource).map((clip) => clip.resourceId)).toEqual([
        'r1',
        'r2',
        'r3',
      ])
      expect(
        insertResourceIntoTrack(track(), resource, null).map((clip) => clip.resourceId),
      ).toEqual(['r3', 'r1', 'r2'])
      expect(
        insertResourceIntoTrack(track(), resource, 'a').map((clip) => clip.resourceId),
      ).toEqual(['r1', 'r3', 'r2'])
    })
  })

  describe('reorderTrack', () => {
    it('moves a clip to the position after the target', () => {
      const track = [
        makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
        makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
        makeClip({ id: 'c', resourceId: 'r3', order: 2 }),
      ]
      const next = reorderTrack(track, 'a', 'c')
      expect(next.map((c) => c.id)).toEqual(['b', 'c', 'a'])
      expect(next.map((c) => c.order)).toEqual([0, 1, 2])
    })

    it('moves a clip to the position after the target when the target is earlier', () => {
      const track = [
        makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
        makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
        makeClip({ id: 'c', resourceId: 'r3', order: 2 }),
      ]
      const next = reorderTrack(track, 'c', 'a')
      // reorderTrack 语义 = 「放到 toId 之后」：c 移到 a 之后
      expect(next.map((c) => c.id)).toEqual(['a', 'c', 'b'])
      expect(next.map((c) => c.order)).toEqual([0, 1, 2])
    })

    it('returns a copy unchanged when fromId === toId or id is missing', () => {
      const track = [
        makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
        makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
      ]
      expect(reorderTrack(track, 'a', 'a')).toEqual(track)
      expect(reorderTrack(track, 'x', 'a')).toEqual(track)
      expect(reorderTrack(track, 'a', 'x')).toEqual(track)
    })
  })

  describe('moveClipRelativeTo', () => {
    const track = () => [
      makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
      makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
      makeClip({ id: 'c', resourceId: 'r3', order: 2 }),
      makeClip({ id: 'd', resourceId: 'r4', order: 3 }),
    ]

    it('side=after 等价 reorderTrack：把 from 放到 target 之后', () => {
      const next = moveClipRelativeTo(track(), 'a', 'c', 'after')
      expect(next.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd'])
      expect(next.map((c) => c.order)).toEqual([0, 1, 2, 3])
    })

    it('side=before：把 from 放到 target 之前', () => {
      const next = moveClipRelativeTo(track(), 'd', 'b', 'before')
      expect(next.map((c) => c.id)).toEqual(['a', 'd', 'b', 'c'])
      expect(next.map((c) => c.order)).toEqual([0, 1, 2, 3])
    })

    it('side=before 且 target 是首位：把 from 移到最前', () => {
      const next = moveClipRelativeTo(track(), 'c', 'a', 'before')
      expect(next.map((c) => c.id)).toEqual(['c', 'a', 'b', 'd'])
      expect(next.map((c) => c.order)).toEqual([0, 1, 2, 3])
    })

    it('side=after 且 from 在 target 前面：正确收敛调整后的 target 索引', () => {
      // 移除 from 后 target 索引左移一位；验证不会出现"卡在原位"等 bug
      const next = moveClipRelativeTo(track(), 'a', 'c', 'after')
      // a 在 0，c 在 2。语义：放到 c 之后 → b,c,a,d
      expect(next.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd'])
    })

    it('from === target 或 id 不在轨道：原样返回同长度新数组', () => {
      const t = track()
      expect(moveClipRelativeTo(t, 'b', 'b', 'before')).toEqual(t)
      expect(moveClipRelativeTo(t, 'x', 'a', 'after')).toEqual(t)
      expect(moveClipRelativeTo(t, 'a', 'x', 'after')).toEqual(t)
      expect(moveClipRelativeTo(t, 'a', 'b', 'before')).not.toBe(t)
    })
  })

  describe('removeTrackClip', () => {
    it('removes a clip and compacts order', () => {
      const track = [
        makeClip({ id: 'a', resourceId: 'r1', order: 0 }),
        makeClip({ id: 'b', resourceId: 'r2', order: 1 }),
        makeClip({ id: 'c', resourceId: 'r3', order: 2 }),
      ]
      const next = removeTrackClip(track, 'b')
      expect(next.map((c) => c.id)).toEqual(['a', 'c'])
      expect(next.map((c) => c.order)).toEqual([0, 1])
    })

    it('returns a copy unchanged when the id is not found', () => {
      const track = [makeClip({ id: 'a', resourceId: 'r1', order: 0 })]
      expect(removeTrackClip(track, 'missing')).toEqual(track)
    })
  })

  describe('clipDurationSec / calculateTrackDuration', () => {
    it('uses range when present and valid', () => {
      const clip = makeClip({
        id: 'c1',
        resourceId: 'r1',
        range: { startSec: 2, endSec: 6 },
      })
      const resource = makeResource({ id: 'r1', kind: 'video', durationSec: 10 })
      expect(clipDurationSec(clip, resource)).toBe(4)
    })

    it('uses resource.durationSec for video without range', () => {
      const clip = makeClip({ id: 'c1', resourceId: 'r1' })
      const resource = makeResource({ id: 'r1', kind: 'video', durationSec: 12 })
      expect(clipDurationSec(clip, resource)).toBe(12)
    })

    it('uses staticDuration for image resources', () => {
      const clip = makeClip({
        id: 'c1',
        resourceId: 'r1',
        staticDuration: 5,
      })
      const resource = makeResource({ id: 'r1', kind: 'image' })
      expect(clipDurationSec(clip, resource)).toBe(5)
    })

    it('falls back to default image duration when not specified', () => {
      const clip = makeClip({ id: 'c1', resourceId: 'r1' })
      const resource = makeResource({ id: 'r1', kind: 'image' })
      expect(clipDurationSec(clip, resource)).toBe(DEFAULT_IMAGE_STATIC_DURATION_SEC)
    })

    it('sums clip durations across the whole track', () => {
      const resources = [
        makeResource({ id: 'r1', kind: 'video', durationSec: 10 }),
        makeResource({ id: 'r2', kind: 'image' }),
        makeResource({ id: 'r3', kind: 'video', durationSec: 7 }),
      ]
      const track = [
        makeClip({ id: 'c1', resourceId: 'r1', order: 0 }),
        makeClip({ id: 'c2', resourceId: 'r2', order: 1 }),
        makeClip({ id: 'c3', resourceId: 'r3', order: 2 }),
      ]
      const map = indexResourcesById(resources)
      const total = calculateTrackDuration(track, map)
      expect(total).toBe(10 + DEFAULT_IMAGE_STATIC_DURATION_SEC + 7)
    })

    it('returns 0 for an empty track', () => {
      expect(calculateTrackDuration([], new Map())).toBe(0)
    })
  })

  describe('splitTrackClip', () => {
    it('splits a video clip into adjacent source ranges', () => {
      const resource = makeResource({ id: 'video', kind: 'video', durationSec: 12 })
      const next = splitTrackClip(
        [makeClip({ id: 'clip', resourceId: resource.id, order: 0 })],
        indexResourcesById([resource]),
        'clip',
        5,
      )

      expect(next).toHaveLength(2)
      expect(next[0]?.range).toEqual({ startSec: 0, endSec: 5 })
      expect(next[1]?.range).toEqual({ startSec: 5, endSec: 12 })
      expect(next.map((clip) => clip.order)).toEqual([0, 1])
    })

    it('splits an image clip by its static display duration', () => {
      const resource = makeResource({ id: 'image', kind: 'image' })
      const next = splitTrackClip(
        [makeClip({ id: 'clip', resourceId: resource.id, staticDuration: 8 })],
        indexResourcesById([resource]),
        'clip',
        3,
      )

      expect(next.map((clip) => clip.staticDuration)).toEqual([3, 5])
    })
  })

  describe('resolveClipAtGlobalTime / clipStartSecInTrack', () => {
    const resources = [
      makeResource({ id: 'r1', kind: 'video', durationSec: 10 }),
      makeResource({ id: 'r2', kind: 'image' }),
      makeResource({ id: 'r3', kind: 'video', durationSec: 7 }),
    ]
    const track = [
      makeClip({ id: 'c1', resourceId: 'r1', order: 0 }),
      makeClip({ id: 'c2', resourceId: 'r2', order: 1 }),
      makeClip({ id: 'c3', resourceId: 'r3', order: 2 }),
    ]
    const map = indexResourcesById(resources)
    // c1: 0..10, c2: 10..18 (8s image), c3: 18..25

    it('returns null for an empty track', () => {
      expect(resolveClipAtGlobalTime([], map, 5)).toBeNull()
    })

    it('lands on the first clip when global time is in its range', () => {
      const hit = resolveClipAtGlobalTime(track, map, 4)
      expect(hit?.clip.id).toBe('c1')
      expect(hit?.offsetSec).toBe(4)
    })

    it('crosses into the second clip accounting for clip 1 duration', () => {
      const hit = resolveClipAtGlobalTime(track, map, 14)
      expect(hit?.clip.id).toBe('c2')
      expect(hit?.offsetSec).toBe(4)
    })

    it('clamps overflow into the last clip', () => {
      const hit = resolveClipAtGlobalTime(track, map, 999)
      expect(hit?.clip.id).toBe('c3')
    })

    it('clipStartSecInTrack reports the start offset of each clip', () => {
      expect(clipStartSecInTrack(track, map, 'c1')).toBe(0)
      expect(clipStartSecInTrack(track, map, 'c2')).toBe(10)
      expect(clipStartSecInTrack(track, map, 'c3')).toBe(18)
    })

    it('clipStartSecInTrack returns 0 for unknown clipId', () => {
      expect(clipStartSecInTrack(track, map, 'nope')).toBe(0)
    })
  })

  describe('clipSeekTimeSec', () => {
    it('offsets by range.startSec when clip has a range', () => {
      const clip = makeClip({ id: 'c1', resourceId: 'r1', range: { startSec: 5, endSec: 15 } })
      expect(clipSeekTimeSec(clip, 3)).toBe(8)
    })

    it('returns offset directly when clip has no range', () => {
      const clip = makeClip({ id: 'c1', resourceId: 'r1' })
      expect(clipSeekTimeSec(clip, 6)).toBe(6)
    })

    it('clamps negative offsets to 0', () => {
      const clip = makeClip({ id: 'c1', resourceId: 'r1' })
      expect(clipSeekTimeSec(clip, -2)).toBe(0)
    })
  })

  describe('indexResourcesById / mergeResources', () => {
    it('builds a lookup map keyed by resource id', () => {
      const r1 = makeResource({ id: 'a' })
      const r2 = makeResource({ id: 'b' })
      const map = indexResourcesById([r1, r2])
      expect(map.get('a')).toBe(r1)
      expect(map.get('b')).toBe(r2)
      expect(map.get('c')).toBeUndefined()
    })

    it('merges incoming resources and dedupes by id (newer wins)', () => {
      const oldA = makeResource({ id: 'a', title: 'old' })
      const oldB = makeResource({ id: 'b', title: 'B' })
      const newA = makeResource({ id: 'a', title: 'new' })
      const newC = makeResource({ id: 'c', title: 'C' })
      const merged = mergeResources([oldA, oldB], [newA, newC])
      const byId = new Map(merged.map((r) => [r.id, r]))
      expect(byId.get('a')?.title).toBe('new')
      expect(byId.get('b')?.title).toBe('B')
      expect(byId.get('c')?.title).toBe('C')
      expect(merged).toHaveLength(3)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { createDefaultVideoWorkbenchProject } from './projectTypes'
import { createVideoWorkbenchClipForResource } from './timelineEditing'
import {
  reconcileVideoWorkbenchResourceMissing,
  resolveVideoWorkbenchTaskStatusByResourceId,
  syncVideoWorkbenchSourceResource,
} from './sourceResourceSync'

const sourceResource = {
  id: 'source:workbench',
  source: 'canvas' as const,
  kind: 'video' as const,
  title: '源视频',
  url: 'safe-file:///source.mp4',
  originPath: '/source.mp4',
  importedAt: 1,
  durationSec: 12,
}

describe('syncVideoWorkbenchSourceResource', () => {
  it('registers the source without replacing clips in an edited main track', () => {
    const project = createDefaultVideoWorkbenchProject()
    const editedResource = { ...sourceResource, id: 'video:edited', title: '已编辑素材' }
    project.resources = [editedResource]
    project.tracks[0]!.clips = [createVideoWorkbenchClipForResource(project, editedResource, 3)]

    const result = syncVideoWorkbenchSourceResource(project, sourceResource)

    expect(result.resources.map((resource) => resource.id)).toEqual([
      'video:edited',
      'source:workbench',
    ])
    expect(result.tracks[0]!.clips).toEqual(project.tracks[0]!.clips)
  })

  it('seeds the source clip when the main track is empty', () => {
    const project = createDefaultVideoWorkbenchProject()

    const result = syncVideoWorkbenchSourceResource(project, sourceResource)

    expect(result.tracks[0]!.clips).toEqual([
      expect.objectContaining({ resourceId: sourceResource.id, timelineStartSec: 0 }),
    ])
  })

  it('updates source metadata without duplicating an existing clip', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [sourceResource]
    project.tracks[0]!.clips = [createVideoWorkbenchClipForResource(project, sourceResource, 0)]

    const result = syncVideoWorkbenchSourceResource(project, {
      ...sourceResource,
      durationSec: 18,
    })

    expect(result.resources).toHaveLength(1)
    expect(result.resources[0]?.durationSec).toBe(18)
    expect(result.tracks[0]!.clips).toHaveLength(1)
  })
})

describe('reconcileVideoWorkbenchResourceMissing', () => {
  const canvasResource = {
    ...sourceResource,
    id: 'upstream:node-a',
    kind: 'video' as const,
  }
  const localResource = {
    ...sourceResource,
    id: 'local:/tmp/intro.mp4',
    title: '本机素材',
  }

  it('marks resources whose canvas node disappeared as missing', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [canvasResource, localResource]

    const result = reconcileVideoWorkbenchResourceMissing(project, new Set(['node-b']))

    expect(result.resources.find((r) => r.id === 'upstream:node-a')?.missing).toBe(true)
    expect(result.resources.find((r) => r.id === 'local:/tmp/intro.mp4')?.missing).toBeUndefined()
  })

  it('clears the missing flag when the node comes back', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [{ ...canvasResource, missing: true }]

    const result = reconcileVideoWorkbenchResourceMissing(project, new Set(['node-a']))

    expect(result.resources[0]?.missing).toBeUndefined()
  })

  it('returns the same project reference when nothing changed', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [{ ...canvasResource, missing: true }, localResource]

    const result = reconcileVideoWorkbenchResourceMissing(project, new Set(['node-b']))

    expect(result).toBe(project)
  })

  it('prefers upstreamNodeId over the id prefix', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [{ ...canvasResource, id: 'local:whatever', upstreamNodeId: 'node-x' }]

    const result = reconcileVideoWorkbenchResourceMissing(project, new Set(['node-y']))

    expect(result.resources[0]?.missing).toBe(true)
  })
})

describe('resolveVideoWorkbenchTaskStatusByResourceId', () => {
  it('maps only running/failed statuses onto the referencing resources', () => {
    const project = createDefaultVideoWorkbenchProject()
    project.resources = [
      { ...sourceResource, id: 'upstream:node-a' },
      { ...sourceResource, id: 'canvas:node-b' },
      { ...sourceResource, id: 'local:/tmp/x.mp4' },
    ]

    const map = resolveVideoWorkbenchTaskStatusByResourceId(
      project,
      new Map([
        ['node-a', 'running'],
        ['node-b', 'completed'],
        ['node-c', 'failed'],
      ]),
    )

    expect(map.get('upstream:node-a')).toBe('running')
    expect(map.has('canvas:node-b')).toBe(false)
    expect(map.size).toBe(1)
  })
})

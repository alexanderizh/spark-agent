import { describe, expect, it } from 'vitest'
import { createDefaultVideoWorkbenchProject } from './projectTypes'
import { createVideoWorkbenchClipForResource } from './timelineEditing'
import { syncVideoWorkbenchSourceResource } from './sourceResourceSync'

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

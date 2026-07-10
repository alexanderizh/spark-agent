import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { buildReferenceImageInputRoles, buildTaskInputFiles } from './canvasTaskInputFiles'

function imageNode(id: string, url = `safe-file:///tmp/${id}.png`): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    title: id,
    assetId: `asset-${id}`,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 120,
    height: 120,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: { url, mimeType: 'image/png' },
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
}

describe('canvasTaskInputFiles', () => {
  it('expands one selected image into multiple role-specific input files', () => {
    expect(
      buildTaskInputFiles([imageNode('img-a')], {
        'img-a': ['first_frame', 'last_frame', 'reference'],
      }),
    ).toEqual([
      {
        type: 'image',
        role: 'first_frame',
        url: 'safe-file:///tmp/img-a.png',
        mimeType: 'image/png',
      },
      {
        type: 'image',
        role: 'last_frame',
        url: 'safe-file:///tmp/img-a.png',
        mimeType: 'image/png',
      },
      {
        type: 'image',
        role: 'reference',
        url: 'safe-file:///tmp/img-a.png',
        mimeType: 'image/png',
      },
    ])
  })

  it('deduplicates repeated role assignments before sending input files', () => {
    expect(
      buildTaskInputFiles([imageNode('img-a')], {
        'img-a': ['reference', 'reference'],
      }).map((file) => file.role),
    ).toEqual(['reference'])
  })

  it('marks non-frame image selections as references to avoid implicit first/last frames', () => {
    const inputRoles = buildReferenceImageInputRoles(['img-a', 'img-b'])

    expect(buildTaskInputFiles([imageNode('img-a'), imageNode('img-b')], inputRoles)).toEqual([
      {
        type: 'image',
        role: 'reference',
        url: 'safe-file:///tmp/img-a.png',
        mimeType: 'image/png',
      },
      {
        type: 'image',
        role: 'reference',
        url: 'safe-file:///tmp/img-b.png',
        mimeType: 'image/png',
      },
    ])
  })
})

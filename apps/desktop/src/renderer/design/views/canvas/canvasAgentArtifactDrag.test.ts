import { describe, expect, it, vi } from 'vitest'
import {
  CANVAS_AGENT_ARTIFACT_DRAG_TYPE,
  canDragCanvasAgentArtifact,
  createCanvasAgentArtifactPayload,
  createCanvasAgentAssetPayload,
  hasCanvasAgentArtifactDrag,
  readCanvasAgentArtifactDrag,
  resolveCanvasAgentArtifactAttachment,
  writeCanvasAgentArtifactDrag,
} from './canvasAgentArtifactDrag'
import type { CanvasAsset } from './canvas.types'

function encodeSafeFilePath(filePath: string): string {
  const encoded = Buffer.from(filePath, 'utf8').toString('base64url')
  return `safe-file://x/${encoded}`
}

describe('canvas Agent artifact drag', () => {
  it('writes and reads a versioned artifact payload', () => {
    const store = new Map<string, string>()
    const dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData' | 'getData' | 'types'> = {
      effectAllowed: 'none',
      setData: vi.fn((type: string, value: string) => store.set(type, value)),
      getData: vi.fn((type: string) => store.get(type) ?? ''),
      types: [CANVAS_AGENT_ARTIFACT_DRAG_TYPE],
    }
    const payload = createCanvasAgentArtifactPayload({
      id: 'output-1',
      title: '角色定妆图',
      type: 'image',
      filePath: '/project/assets/character.png',
      taskId: 'task-1',
    })

    writeCanvasAgentArtifactDrag(dataTransfer, payload)

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(hasCanvasAgentArtifactDrag(dataTransfer)).toBe(true)
    expect(readCanvasAgentArtifactDrag(dataTransfer)).toEqual(payload)
  })

  it('rejects malformed optional path fields at the drag protocol boundary', () => {
    const dataTransfer = {
      getData: () =>
        JSON.stringify({
          version: 1,
          kind: 'canvas-artifact',
          id: 'malformed-output',
          title: '异常产物',
          artifactType: 'file',
          filePath: { path: '/tmp/not-a-string.txt' },
        }),
    }

    expect(readCanvasAgentArtifactDrag(dataTransfer)).toBeNull()
  })

  it('resolves absolute, relative and safe-file paths into session attachments', () => {
    const absolute = createCanvasAgentArtifactPayload({
      id: 'image-1',
      title: '图片',
      type: 'image',
      filePath: '/project/assets/image.png',
    })
    const relative = createCanvasAgentArtifactPayload({
      id: 'video-1',
      title: '视频',
      type: 'video',
      filePath: 'assets/video.mp4',
    })
    const safeFile = createCanvasAgentArtifactPayload({
      id: 'audio-1',
      title: '音频',
      type: 'audio',
      url: encodeSafeFilePath('/project/assets/audio.wav'),
    })

    expect(resolveCanvasAgentArtifactAttachment(absolute)).toEqual({
      type: 'image',
      path: '/project/assets/image.png',
    })
    expect(resolveCanvasAgentArtifactAttachment(relative, '/project')).toEqual({
      type: 'file',
      path: '/project/assets/video.mp4',
    })
    expect(resolveCanvasAgentArtifactAttachment(safeFile)).toEqual({
      type: 'file',
      path: '/project/assets/audio.wav',
    })
  })

  it('lets users drag remote-only artifacts but rejects invalid attachments with a visible drop error', () => {
    const payload = createCanvasAgentArtifactPayload({
      id: 'remote-image',
      title: '远程图片',
      type: 'image',
      url: 'https://example.com/image.png',
    })

    expect(canDragCanvasAgentArtifact(payload)).toBe(true)
    expect(resolveCanvasAgentArtifactAttachment(payload, '/project')).toBeNull()
  })

  it('uses the asset file path metadata and project root when storageKey is relative', () => {
    const asset = {
      id: 'asset-1',
      projectId: 'project-1',
      userId: 1,
      type: 'image',
      source: 'ai_generated',
      title: '镜头图',
      storageKey: 'assets/shot.png',
      metadata: {},
      createdAt: '2026-08-24T00:00:00.000Z',
      updatedAt: '2026-08-24T00:00:00.000Z',
    } satisfies CanvasAsset

    expect(
      resolveCanvasAgentArtifactAttachment(createCanvasAgentAssetPayload(asset), '/work'),
    ).toEqual({
      type: 'image',
      path: '/work/assets/shot.png',
    })
  })
})

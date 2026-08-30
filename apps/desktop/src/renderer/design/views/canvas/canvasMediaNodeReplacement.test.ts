import { describe, expect, it, vi } from 'vitest'
import { replaceCanvasVideoNode } from './canvasMediaNodeReplacement'
import type { CanvasNode } from './canvas.types'

const at = '2026-08-01T00:00:00.000Z'

function videoNode(): CanvasNode {
  return {
    id: 'video-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'video',
    x: 100,
    y: 200,
    width: 500,
    height: 300,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
  }
}

describe('replaceCanvasVideoNode', () => {
  it('persists a prepared video into the existing node while preserving its center', async () => {
    const patchNode = vi.fn(async () => undefined)
    const updateNodeData = vi.fn(async () => undefined)
    const file = { name: 'clip.mp4', type: 'video/mp4', size: 1200 } as File

    await replaceCanvasVideoNode({
      node: videoNode(),
      file,
      prepare: vi.fn(async () => ({
        filePath: '/project/assets/clip.mp4',
        fileMimeType: 'video/mp4',
        mediaWidth: 1920,
        mediaHeight: 1080,
        durationMs: 5000,
      })),
      toSafeUrl: () => 'safe-file://clip',
      patchNode,
      updateNodeData,
    })

    expect(patchNode).toHaveBeenCalledWith('video-1', {
      width: 680,
      height: 383,
      x: 10,
      y: 159,
    })
    expect(updateNodeData).toHaveBeenCalledWith('video-1', {
      url: 'safe-file://clip',
      mimeType: 'video/mp4',
      mediaWidth: 1920,
      mediaHeight: 1080,
      durationMs: 5000,
    })
  })

  it('rejects non-video files before preparing them', async () => {
    const prepare = vi.fn()
    await expect(
      replaceCanvasVideoNode({
        node: videoNode(),
        file: { name: 'still.png', type: 'image/png' } as File,
        prepare,
        patchNode: vi.fn(),
        updateNodeData: vi.fn(),
      }),
    ).rejects.toThrow('请选择视频文件')
    expect(prepare).not.toHaveBeenCalled()
  })
})

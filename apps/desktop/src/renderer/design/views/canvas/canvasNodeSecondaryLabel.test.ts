import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { canvasNodeSecondaryLabel } from './canvasNodeSecondaryLabel'

const baseNode: CanvasNode = {
  id: 'node-1',
  projectId: 'project-1',
  boardId: 'board-1',
  userId: 1,
  type: 'image',
  title: '参考图',
  assetId: 'asset-1',
  taskId: null,
  parentNodeId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  zIndex: 0,
  locked: false,
  hidden: false,
  data: {},
  createdAt: '',
  updatedAt: '',
}

const baseAsset: CanvasAsset = {
  id: 'asset-1',
  projectId: 'project-1',
  userId: 1,
  type: 'image',
  source: 'upload',
  title: '参考图',
  metadata: {},
  createdAt: '',
  updatedAt: '',
}

describe('canvasNodeSecondaryLabel', () => {
  it('prefers an original asset filename for prompt tags', () => {
    expect(
      canvasNodeSecondaryLabel(baseNode, {
        ...baseAsset,
        metadata: { originalFilename: 'shot-06-reference.png' },
      }),
    ).toBe('shot-06-reference.png')
  })

  it('reads a filename from the node URL when no asset metadata exists', () => {
    expect(
      canvasNodeSecondaryLabel({
        ...baseNode,
        data: { url: 'safe-file:///project/assets/%E5%8F%82%E8%80%83%E5%9B%BE-01.jpg' },
      }),
    ).toBe('参考图-01.jpg')
  })

  it('does not expose an inline data URL as a filename', () => {
    expect(
      canvasNodeSecondaryLabel({
        ...baseNode,
        assetId: null,
        data: { url: 'data:image/png;base64,AAAA' },
      }),
    ).toBe('图片资产')
  })

  it('falls back to the same semantic summary used by the node footer', () => {
    expect(
      canvasNodeSecondaryLabel({
        ...baseNode,
        type: 'text',
        assetId: null,
        data: { text: '雨夜巷口' },
      }),
    ).toBe('4 字')
    expect(
      canvasNodeSecondaryLabel({
        ...baseNode,
        type: 'text_to_video',
        assetId: null,
        data: { operation: 'text_to_video', modelId: 'video-model-v2' },
      }),
    ).toBe('模型 video-model-v2')
  })
})

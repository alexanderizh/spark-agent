import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasNode } from './canvas.types'
import { materializeCanvasImageScaleCompress } from './canvasImageScaleCompressMaterialization'

const mocks = vi.hoisted(() => ({
  copyLocalArtifactIntoProject: vi.fn(),
}))

vi.mock('./canvasArtifactPersistence', () => ({
  copyLocalArtifactIntoProject: mocks.copyLocalArtifactIntoProject,
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.copyLocalArtifactIntoProject.mockReset()
})

describe('materializeCanvasImageScaleCompress', () => {
  it('uses the encoded format for the new image file and connects the derived node', async () => {
    const unsubscribe = vi.fn()
    const invoke = vi.fn().mockResolvedValue({
      success: true,
      result: {
        path: '/tmp/output.jpg',
        width: 640,
        height: 360,
        format: 'jpeg',
        outputBytes: 12_345,
      },
    })
    const on = vi.fn().mockReturnValue(unsubscribe)
    vi.stubGlobal('window', { spark: { invoke, on } })
    mocks.copyLocalArtifactIntoProject.mockResolvedValue('/project/assets/images/output.jpg')
    const createdNode = { id: 'created-image' } as CanvasNode
    const createImageNode = vi.fn().mockResolvedValue(createdNode)
    const connectDerivedNode = vi.fn()

    const result = await materializeCanvasImageScaleCompress(
      {
        projectId: 'project-1',
        boardId: 'board-1',
        parentNodeId: 'source-1',
        filePath: '/project/assets/images/source.png',
        fileName: 'source.png',
        mimeType: 'image/png',
        scalePercent: 50,
        compressPercent: 60,
        onProgress: vi.fn(),
      },
      {
        parent: { x: 10, y: 20, width: 300 },
        createImageNode,
        connectDerivedNode,
      },
    )

    expect(result).toBe(createdNode)
    expect(invoke).toHaveBeenCalledWith(
      'image:process',
      expect.objectContaining({
        operation: 'scaleCompress',
        input: '/project/assets/images/source.png',
        params: { scalePercent: 50, compressPercent: 60 },
      }),
    )
    expect(
      (invoke.mock.calls[0]?.[1] as { requestId: string }).requestId.length,
    ).toBeLessThanOrEqual(100)
    expect(createImageNode).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/project/assets/images/output.jpg',
        fileSize: 12_345,
        imageWidth: 640,
        imageHeight: 360,
        x: 358,
        y: 20,
      }),
    )
    const file = createImageNode.mock.calls[0]?.[0]?.file as File
    expect(file.name).toBe('source 尺寸压缩.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(connectDerivedNode).toHaveBeenCalledWith(createdNode)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('reports IPC errors without creating a node and still removes the progress listener', async () => {
    const unsubscribe = vi.fn()
    vi.stubGlobal('window', {
      spark: {
        invoke: vi.fn().mockResolvedValue({ success: false, error: '编码失败' }),
        on: vi.fn().mockReturnValue(unsubscribe),
      },
    })
    const createImageNode = vi.fn()
    const connectDerivedNode = vi.fn()

    await expect(
      materializeCanvasImageScaleCompress(
        {
          projectId: 'project-1',
          boardId: 'board-1',
          parentNodeId: 'source-1',
          filePath: '/project/assets/images/source.png',
          fileName: 'source.png',
          scalePercent: 100,
          compressPercent: 50,
          onProgress: vi.fn(),
        },
        {
          parent: { x: 0, y: 0, width: 300 },
          createImageNode,
          connectDerivedNode,
        },
      ),
    ).rejects.toThrow('编码失败')
    expect(createImageNode).not.toHaveBeenCalled()
    expect(connectDerivedNode).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

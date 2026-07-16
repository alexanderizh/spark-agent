import { describe, expect, it } from 'vitest'
import {
  buildCanvasBatchNodeUpdates,
  createCanvasBatchTaskSession,
  findStaleCanvasBatchNodeIds,
  patchCanvasBatchTaskGroup,
  patchCanvasBatchTaskNode,
  summarizeBatchTaskSelection,
} from './canvasBatchTaskModel'
import type { CanvasNode, CanvasNodeData, CanvasNodeType } from './canvas.types'

function node(
  id: string,
  type: CanvasNodeType,
  data: CanvasNodeData = {},
  updatedAt = '2026-07-16T00:00:00.000Z',
): CanvasNode {
  return {
    id,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type,
    title: id,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data,
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt,
  }
}

describe('canvasBatchTaskModel', () => {
  it('enables batch actions only when every selected node is an operation node', () => {
    expect(
      summarizeBatchTaskSelection([
        node('image-task', 'text_to_image'),
        node('video-task', 'text_to_video'),
      ]),
    ).toEqual({
      canBatchConfigure: true,
      canBatchSubmit: true,
      configureReason: null,
      submitReason: null,
      taskNodeIds: ['image-task', 'video-task'],
      operationCount: 2,
    })

    expect(
      summarizeBatchTaskSelection([
        node('image-task', 'text_to_image'),
        node('note', 'text'),
      ]),
    ).toMatchObject({
      canBatchConfigure: false,
      canBatchSubmit: false,
      configureReason: '仅支持同时选择任务节点',
      submitReason: '仅支持同时选择任务节点',
      taskNodeIds: ['image-task'],
    })
  })

  it('applies only touched shared fields and preserves other node values', () => {
    const session = createCanvasBatchTaskSession([
      node('a', 'text_to_image', {
        providerProfileId: 'provider-a',
        modelId: 'old-a',
        modelParams: { size: '1K', seed: 1 },
      }),
      node('b', 'text_to_image', {
        providerProfileId: 'provider-b',
        modelId: 'old-b',
        modelParams: { size: '2K', seed: 2 },
      }),
    ])

    const patched = patchCanvasBatchTaskGroup(session, 'text_to_image', {
      touched: ['modelId', 'modelParams.size'],
      values: {
        modelId: 'shared-model',
        modelParams: { size: '4K' },
      },
    })

    expect(buildCanvasBatchNodeUpdates(patched)).toEqual([
      {
        nodeId: 'a',
        data: {
          modelId: 'shared-model',
          modelParams: { size: '4K', seed: 1 },
        },
      },
      {
        nodeId: 'b',
        data: {
          modelId: 'shared-model',
          modelParams: { size: '4K', seed: 2 },
        },
      },
    ])
  })

  it('lets a node override win over a shared patch', () => {
    const session = createCanvasBatchTaskSession([
      node('a', 'text_to_image', { modelParams: { size: '1K' } }),
      node('b', 'text_to_image', { modelParams: { size: '2K' } }),
    ])
    const shared = patchCanvasBatchTaskGroup(session, 'text_to_image', {
      touched: ['modelParams.size'],
      values: { modelParams: { size: '4K' } },
    })
    const overridden = patchCanvasBatchTaskNode(shared, 'b', {
      touched: ['modelParams.size'],
      values: { modelParams: { size: '8K' } },
    })

    expect(buildCanvasBatchNodeUpdates(overridden)).toEqual([
      { nodeId: 'a', data: { modelParams: { size: '4K' } } },
      { nodeId: 'b', data: { modelParams: { size: '8K' } } },
    ])
  })

  it('detects deleted and externally modified nodes before submit', () => {
    const session = createCanvasBatchTaskSession([
      node('a', 'text_to_image', {}, '2026-07-16T00:00:00.000Z'),
      node('b', 'text_to_video', {}, '2026-07-16T00:00:00.000Z'),
    ])

    expect(
      findStaleCanvasBatchNodeIds(session, [
        node('a', 'text_to_image', {}, '2026-07-16T00:01:00.000Z'),
      ]),
    ).toEqual(['a', 'b'])
  })

})

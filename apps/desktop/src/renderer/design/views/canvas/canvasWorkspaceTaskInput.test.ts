import { describe, expect, it } from 'vitest'
import {
  buildCanvasInputBindingsForRoles,
  buildPipelineSourceText,
  filterExistingCanvasInputNodeIds,
  resolveCanvasPersistableInputNodeIds,
  resolveCanvasPipelineTextSource,
} from './canvasWorkspaceTaskInput'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

const at = '2026-07-16T00:00:00.000Z'

function operationNode(): CanvasNode {
  return {
    id: 'operation-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_rewrite',
    taskId: 'task-screenplay',
    title: '转剧本',
    x: 0,
    y: 0,
    width: 420,
    height: 320,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {
      operation: 'text_rewrite',
      status: 'completed',
      outputPipelineRole: 'screenplay',
    },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayAsset(): CanvasAsset {
  return {
    id: 'asset-screenplay',
    projectId: 'project-1',
    userId: 1,
    type: 'text',
    source: 'ai_generated',
    title: '转剧本结果',
    contentText: '场 1：雨夜车站\n林岚走入候车厅。',
    metadata: { taskId: 'task-screenplay' },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayTask(outputNodeIds: string[]): CanvasTask {
  return {
    id: 'task-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_rewrite',
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds: ['asset-screenplay'],
    modelParams: {},
    createdAt: at,
    updatedAt: at,
  }
}

function snapshotWith(nodes: CanvasNode[], task: CanvasTask): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: nodes.length,
      assetCount: 1,
      taskCount: 1,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes,
    edges: [],
    assets: [screenplayAsset()],
    tasks: [task],
  }
}

describe('resolveCanvasPipelineTextSource', () => {
  it('persists true keyframes as endpoints and design images as references', () => {
    const first = {
      ...operationNode(),
      id: 'first',
      type: 'image' as const,
      data: { url: '1.png' },
    }
    const last = { ...operationNode(), id: 'last', type: 'image' as const, data: { url: '2.png' } }
    const design = {
      ...operationNode(),
      id: 'design',
      type: 'image' as const,
      data: { url: 'design.png' },
    }

    expect(
      buildCanvasInputBindingsForRoles([first, last, design], {
        first: 'first_frame',
        last: 'last_frame',
        design: 'reference',
      }),
    ).toEqual([
      expect.objectContaining({ sourceNodeId: 'first', role: 'first_frame' }),
      expect.objectContaining({ sourceNodeId: 'last', role: 'last_frame' }),
      expect.objectContaining({ sourceNodeId: 'design', role: 'reference' }),
    ])
  })

  it('reads screenplay text from the completed 转剧本 operation primary output node', () => {
    const operation = operationNode()
    const output: CanvasNode = {
      ...operation,
      id: 'node-screenplay-output',
      type: 'text',
      taskId: null,
      assetId: 'asset-screenplay',
      title: '转剧本结果',
      x: 500,
      data: {
        text: '场 1：雨夜车站\n林岚走入候车厅。',
        format: 'markdown',
        origin: 'task_output',
        pipelineRole: 'screenplay',
      },
    }
    const snapshot = snapshotWith([operation, output], screenplayTask([output.id]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: output,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })

  it('uses asset text but keeps the operation node when the output has no persisted node', () => {
    const operation = operationNode()
    const snapshot = snapshotWith([operation], screenplayTask([]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: operation,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })

  it('keeps a single-child group as the downstream lineage source', () => {
    const group: CanvasNode = {
      ...operationNode(),
      id: 'group-screenplay',
      type: 'group',
      taskId: null,
      title: '剧本分组',
      data: {},
    }
    const child: CanvasNode = {
      ...group,
      id: 'node-screenplay-child',
      type: 'text',
      parentNodeId: group.id,
      title: '第一场',
      data: { text: '场 1：雨夜车站' },
    }
    const snapshot = snapshotWith([group, child], screenplayTask([]))

    expect(resolveCanvasPipelineTextSource(group, snapshot)).toEqual({
      sourceNode: group,
      sourceText: '场 1：雨夜车站',
    })
  })

  it('serializes storyboard pipeline input as field-value text instead of a Markdown table', () => {
    const storyboard: CanvasNode = {
      ...operationNode(),
      id: 'storyboard-1',
      type: 'text',
      taskId: null,
      title: '分镜脚本',
      data: {
        pipelineRole: 'shot',
        text: JSON.stringify({
          shots: [
            {
              index: 1,
              title: '烟雾与拒绝',
              sceneName: '狭窄出租房',
              characters: ['苏烬'],
              description: '苏烬面对电脑屏幕缓慢吐出烟雾',
            },
          ],
        }),
      },
    }

    const result = buildPipelineSourceText([storyboard], [])

    expect(result).toContain('名称：烟雾与拒绝')
    expect(result).toContain('角色：苏烬')
    expect(result).toContain('场景：狭窄出租房')
    expect(result).not.toContain('| 镜号 |')
    expect(result).not.toContain('"shots"')
  })
})

describe('resolveCanvasPersistableInputNodeIds', () => {
  it('maps an unmaterialized upstream product view id back to its physical owner node', () => {
    const upstream = operationNode()
    const snapshot = snapshotWith([upstream], screenplayTask([]))

    expect(
      resolveCanvasPersistableInputNodeIds(
        ['operation-output:asset-screenplay'],
        [upstream],
        snapshot,
      ),
    ).toEqual(['operation-screenplay'])
  })

  it('keeps materialized product node ids and passes physical ids through in order', () => {
    const operation = operationNode()
    const output: CanvasNode = {
      ...operation,
      id: 'node-screenplay-output',
      type: 'text',
      taskId: null,
      assetId: 'asset-screenplay',
      title: '转剧本结果',
      x: 500,
      data: {
        text: '场 1：雨夜车站\n林岚走入候车厅。',
        format: 'markdown',
        origin: 'task_output',
        pipelineRole: 'screenplay',
      },
    }
    const image: CanvasNode = {
      ...operation,
      id: 'node-image-1',
      type: 'image',
      taskId: null,
      data: { url: '1.png' },
    }
    const snapshot = snapshotWith([operation, output, image], screenplayTask([output.id]))

    expect(
      resolveCanvasPersistableInputNodeIds(
        ['node-image-1', 'node-screenplay-output'],
        [operation, image],
        snapshot,
      ),
    ).toEqual(['node-image-1', 'node-screenplay-output'])
  })

  it('dedupes ids that remap to the same physical owner node', () => {
    const upstream = operationNode()
    const image: CanvasNode = {
      ...upstream,
      id: 'node-image-1',
      type: 'image',
      taskId: null,
      data: { url: '1.png' },
    }
    const snapshot = snapshotWith([upstream, image], screenplayTask([]))

    expect(
      resolveCanvasPersistableInputNodeIds(
        ['operation-output:asset-screenplay', 'node-image-1', 'operation-output:asset-screenplay'],
        [upstream, image],
        snapshot,
      ),
    ).toEqual(['operation-screenplay', 'node-image-1'])
  })
})

describe('filterExistingCanvasInputNodeIds', () => {
  it('drops source ids that do not exist in the project while preserving order', () => {
    const nodeA: CanvasNode = { ...operationNode(), id: 'node-a' }
    const nodeB: CanvasNode = { ...operationNode(), id: 'node-b' }

    expect(
      filterExistingCanvasInputNodeIds(
        ['node-a', 'operation-output:asset-ghost', 'node-b'],
        [nodeA, nodeB],
        'project-1',
      ),
    ).toEqual(['node-a', 'node-b'])
  })

  it('keeps nodes from other boards of the same project, matching createOperationNode semantics', () => {
    const otherBoardNode: CanvasNode = {
      ...operationNode(),
      id: 'node-other-board',
      boardId: 'board-2',
    }

    expect(
      filterExistingCanvasInputNodeIds(['node-other-board'], [otherBoardNode], 'project-1'),
    ).toEqual(['node-other-board'])
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import { SPECIALIZED_CANVAS_NODE_TOOLS } from './canvasSpecializedNodeTools'

const at = '2026-07-18T00:00:00.000Z'

function baseSnapshot(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '专用节点工具',
      status: 'active',
      settings: {},
      nodeCount: 1,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Canvas',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    activeBoardId: 'board-1',
    nodes: [
      {
        id: 'source-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text',
        title: '章节',
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { text: '第一章：林岚走进茶馆。', pipelineRole: 'chapter' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function tool(name: string) {
  const descriptor = SPECIALIZED_CANVAS_NODE_TOOLS.find((item) => item.name === name)
  if (!descriptor) throw new Error(`missing tool ${name}`)
  return descriptor
}

function fakeContext(snapshot = baseSnapshot()) {
  let assetSequence = 0
  let nodeSequence = 0
  let groupSequence = 0
  let segmentSequence = 0
  const createFilmAsset = vi.fn(async (input: { kind: string; name: string; text?: string }) => {
    const asset: CanvasAsset = {
      id: `asset-${++assetSequence}`,
      projectId: 'project-1',
      userId: 0,
      type: 'text',
      source: 'manual',
      title: input.name,
      contentText: input.text ?? '',
      metadata: { kind: input.kind },
      createdAt: at,
      updatedAt: at,
    }
    snapshot.assets.push(asset)
    return asset
  })
  const insertAsset = vi.fn(async ({ assetId, x, y }: { assetId: string; x: number; y: number }) => {
    const asset = snapshot.assets.find((item) => item.id === assetId)!
    const node: CanvasNode = {
      id: `node-${++nodeSequence}`,
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 0,
      type: 'text',
      title: asset.title ?? null,
      assetId,
      x,
      y,
      width: 320,
      height: 200,
      rotation: 0,
      zIndex: 1,
      locked: false,
      hidden: false,
      data: { text: asset.contentText ?? '' },
      createdAt: at,
      updatedAt: at,
    }
    snapshot.nodes.push(node)
    return node
  })
  const updateNodeData = vi.fn(async (nodeId: string, data: Record<string, unknown>) => {
    const node = snapshot.nodes.find((item) => item.id === nodeId)!
    node.data = { ...node.data, ...data }
  })
  const patchNodes = vi.fn(async (nodeIds: string[], patch: Partial<CanvasNode>) => {
    for (const node of snapshot.nodes.filter((item) => nodeIds.includes(item.id))) Object.assign(node, patch)
  })
  const createTextNode = vi.fn(async ({ text, x, y }: { text: string; x: number; y: number }) => {
    const node: CanvasNode = {
      id: `node-${++nodeSequence}`,
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 0,
      type: 'text',
      title: 'Text',
      x,
      y,
      width: 320,
      height: 200,
      rotation: 0,
      zIndex: 1,
      locked: false,
      hidden: false,
      data: { text },
      createdAt: at,
      updatedAt: at,
    }
    snapshot.nodes.push(node)
    return node
  })
  const createShotGroup = vi.fn(async (input: { name: string }) => ({
    id: `group-${++groupSequence}`,
    name: input.name,
    segments: [],
  }))
  const createShotSegment = vi.fn(async (_groupId: string, input: { title: string }) => ({
    ...input,
    id: `segment-${++segmentSequence}`,
    index: segmentSequence,
  }))
  const createOperationNode = vi.fn(
    async (_input: { systemPrompt?: string; [key: string]: unknown }) => snapshot,
  )
  return {
    context: {
      projectId: 'project-1',
      getSnapshot: () => snapshot,
      workspace: {
        createFilmAsset,
        updateFilmAsset: vi.fn(),
        insertAsset,
        createTextNode,
        updateNodeData,
        patchNodes,
        connectNodes: vi.fn(),
        createShotGroup,
        createShotSegment,
        createOperationNode,
      },
    },
    spies: { createFilmAsset, insertAsset, updateNodeData, createShotGroup, createShotSegment, createOperationNode },
    snapshot,
  }
}

describe('specialized canvas node tools', () => {
  it('exposes a dedicated tool for every approved semantic node capability', () => {
    expect(SPECIALIZED_CANVAS_NODE_TOOLS.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'canvas_create_chapter_node',
        'canvas_create_screenplay_node',
        'canvas_create_character_node',
        'canvas_create_scene_node',
        'canvas_create_prop_node',
        'canvas_create_effect_node',
        'canvas_create_storyboard_node',
        'canvas_create_shot_node',
        'canvas_insert_design_card_node',
        'canvas_insert_keyframe_node',
        'canvas_insert_clip_node',
        'canvas_insert_panorama_node',
        'canvas_create_pipeline_operation_node',
      ]),
    )
  })

  it('creates a screenplay asset and node with the existing screenplay role', async () => {
    const { context, snapshot } = fakeContext()
    const result = await tool('canvas_create_screenplay_node').handler(context, {
      title: '第一集',
      text: '# 场1 内景 茶馆 日\n\n出场人物：林岚\n\n林岚：还有空房吗？',
      sourceNodeIds: ['source-1'],
    })

    expect(result).toMatchObject({ assetId: 'asset-1', nodeId: 'node-1', reused: false })
    expect(snapshot.assets[0]?.metadata.kind).toBe('script')
    expect(snapshot.nodes.find((node) => node.id === 'node-1')?.data).toMatchObject({
      format: 'markdown',
      pipelineRole: 'screenplay',
      productionState: 'draft',
    })
  })

  it('rejects empty semantic names before creating assets', async () => {
    const { context, spies } = fakeContext()

    await expect(
      tool('canvas_create_character_node').handler(context, {
        name: '   ',
        description: '雨夜茶馆里的青年。',
      }),
    ).rejects.toThrow('名称不能为空')
    expect(spies.createFilmAsset).not.toHaveBeenCalled()
  })

  it('validates all storyboard rows before creating groups and segments', async () => {
    const { context, spies } = fakeContext()
    await expect(
      tool('canvas_create_storyboard_node').handler(context, { title: '坏分镜', shots: [] }),
    ).rejects.toThrow('至少需要一个有效镜头')
    expect(spies.createShotGroup).not.toHaveBeenCalled()

    const result = await tool('canvas_create_storyboard_node').handler(context, {
      title: '第一集分镜',
      sourceNodeIds: ['source-1'],
      shots: [
        {
          index: 1,
          groupName: '第一场',
          title: '推门进入',
          durationSec: 4,
          description: '林岚推门进入。',
        },
      ],
    })

    expect(result).toMatchObject({ nodeId: 'node-1', groupIds: ['group-1'], segmentIds: ['segment-1'] })
    expect(spies.createShotSegment).toHaveBeenCalledWith(
      'group-1',
      expect.objectContaining({ title: '推门进入', durationSec: 4 }),
    )
  })

  it('creates a pipeline operation from the shared action contract', async () => {
    const { context, spies } = fakeContext()
    await tool('canvas_create_pipeline_operation_node').handler(context, {
      actionId: 'screenplay.to_shot_script',
      sourceNodeId: 'source-1',
      maxClipSec: 6,
    })

    expect(spies.createOperationNode).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'text_generate',
        inputNodeIds: ['source-1'],
        taskPipelineRole: 'shot',
        outputPipelineRole: 'shot',
        shotScriptConfig: { maxClipSec: 6 },
      }),
    )
    expect(spies.createOperationNode.mock.calls[0]?.[0]?.systemPrompt).toContain(
      '只输出一个完整 JSON 对象',
    )
  })

  it('rejects media nodes with the wrong type or dangling shot references', async () => {
    const snapshot = baseSnapshot()
    snapshot.nodes.push({
      ...snapshot.nodes[0]!,
      id: 'image-1',
      type: 'image',
      title: '关键帧',
      data: { url: 'frame.png' },
    })
    snapshot.project.metadata = {
      film: {
        shotGroups: [
          {
            id: 'group-1',
            name: '第一场',
            sortOrder: 0,
            segments: [{ id: 'segment-1', index: 1, title: '推门进入' }],
          },
        ],
      },
    }
    const { context, spies } = fakeContext(snapshot)

    await expect(
      tool('canvas_insert_clip_node').handler(context, { nodeId: 'image-1' }),
    ).rejects.toThrow('不是video节点')
    await expect(
      tool('canvas_insert_keyframe_node').handler(context, {
        nodeId: 'image-1',
        shotGroupId: 'group-1',
        shotSegmentId: 'missing-segment',
      }),
    ).rejects.toThrow('未找到分镜片段 missing-segment')
    expect(spies.updateNodeData).not.toHaveBeenCalled()
  })

  it('rejects a mismatched media asset before inserting it onto the canvas', async () => {
    const snapshot = baseSnapshot()
    snapshot.assets.push({
      id: 'text-asset',
      projectId: 'project-1',
      userId: 0,
      type: 'text',
      source: 'manual',
      title: '说明',
      contentText: '普通文本',
      metadata: {},
      createdAt: at,
      updatedAt: at,
    })
    const { context, spies } = fakeContext(snapshot)

    await expect(
      tool('canvas_insert_clip_node').handler(context, { assetId: 'text-asset' }),
    ).rejects.toThrow('资产 text-asset 不是video资产')
    expect(spies.insertAsset).not.toHaveBeenCalled()
  })
})

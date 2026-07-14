// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache } from './canvas.api'
import type { CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'

const at = '2026-06-18T00:00:00.000Z'

function seedCanvasDb(db: CanvasDb) {
  // 清除内存缓存，确保 readDb 读到刚写入 localStorage 的最新数据
  __resetCanvasHotCache()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvas operation inheritance', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }),
      },
    })
  })

  it('creates storyboard tasks large and grows them to the completed shot table size', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          settings: {},
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const created = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'text_generate',
      inputNodeIds: [],
      x: 100,
      y: 100,
      taskPipelineRole: 'shot',
      outputPipelineRole: 'shot',
      shotScriptConfig: { maxClipSec: 5 },
    })
    const taskNode = created.nodes.find((node) => node.type === 'text_generate')
    expect(taskNode).toMatchObject({ width: 960, height: 560 })
    if (!taskNode?.taskId) throw new Error('Storyboard task node was not created')

    const shots = Array.from({ length: 5 }, (_, index) => ({
      index: index + 1,
      durationSec: 4,
      description: `第 ${index + 1} 镜画面`,
      shotPrompt: `第 ${index + 1} 镜生成提示词`,
    }))
    const completed = await canvasApi.applyTextTaskResult('project-1', taskNode.taskId, {
      status: 'succeeded',
      providerProfileId: 'provider-1',
      provider: 'openai',
      model: 'gpt-5',
      text: JSON.stringify({ shots }),
    })
    const completedTaskNode = completed.nodes.find((node) => node.id === taskNode?.id)
    const outputNode = completed.nodes.find(
      (node) => node.data.origin === 'task_output' && node.type === 'text',
    )

    expect(completedTaskNode).toMatchObject({ width: 1180, height: 860 })
    expect(outputNode).toMatchObject({ width: 1080, height: 720 })
  })

  it('creates downstream operation nodes with inherited negative prompt and key model params', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          settings: { prompt: 'project prompt', negativePrompt: 'project negative' },
          nodeCount: 1,
          assetCount: 1,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-1',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: 'Source image',
          url: 'file:///source.png',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: 'Source image',
          assetId: 'asset-1',
          taskId: 'task-source',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 240,
          height: 180,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { url: 'file:///source.png' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: 'Source task',
          prompt: 'cinematic portrait',
          negativePrompt: 'blurry, low quality',
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: ['node-source'],
          outputAssetIds: ['asset-1'],
          modelParams: { aspectRatio: '16:9', seed: 1234, internalDebug: true },
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'image_to_image',
      inputNodeIds: ['node-source'],
      x: 310,
      y: 20,
    })

    const operationNode = snapshot.nodes.find((node) => node.type === 'image_to_image')
    expect(operationNode).toBeDefined()
    const pendingTask = snapshot.tasks.find((task) => task.id === operationNode?.taskId)
    expect(pendingTask?.prompt).toBeNull()
    expect(pendingTask?.systemPrompt).not.toContain('cinematic portrait')
    expect(pendingTask?.promptDocument?.blocks).toEqual([])
    expect(pendingTask?.negativePrompt).toBe('blurry, low quality')
    expect(pendingTask?.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
    expect(operationNode?.data.negativePrompt).toBe('blurry, low quality')
    expect(operationNode?.data.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
  })

  it('uses the same prompt-document initialization for right-click nodes and later connections', async () => {
    seedCanvasDb({
      projects: [{
        id: 'project-1', userId: 0, title: 'Project', status: 'active', nodeCount: 1,
        assetCount: 0, taskCount: 0, createdAt: at, updatedAt: at,
      }],
      boards: [{
        id: 'board-1', projectId: 'project-1', userId: 0, name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, createdAt: at, updatedAt: at,
      }],
      assets: [],
      nodes: [{
        id: 'source-text', projectId: 'project-1', boardId: 'board-1', userId: 0,
        type: 'text', title: '场次剧本', assetId: null, taskId: null, parentNodeId: null,
        x: 0, y: 0, width: 320, height: 200, rotation: 0, zIndex: 1, locked: false,
        hidden: false, data: { text: '雨夜里，小满走入车站。', pipelineRole: 'screenplay' },
        createdAt: at, updatedAt: at,
      }],
      edges: [],
      tasks: [],
    })

    const created = await canvasApi.createOperationNode({
      projectId: 'project-1', boardId: 'board-1', operation: 'text_generate',
      inputNodeIds: [], x: 400, y: 0,
    })
    const operationNode = created.nodes.find((node) => node.type === 'text_generate')
    if (!operationNode?.taskId) throw new Error('Operation node was not created')
    expect(operationNode.data.promptDocument?.blocks).toEqual([])
    expect(operationNode.data.prompt).toBeUndefined()
    expect(operationNode.data.systemPrompt).toBeTruthy()

    const connected = await canvasApi.connectNodes('project-1', {
      sourceNodeId: 'source-text', targetNodeId: operationNode.id,
    })
    const connectedNode = connected.nodes.find((node) => node.id === operationNode.id)
    const connectedTask = connected.tasks.find((task) => task.id === operationNode.taskId)
    expect(connectedNode?.data.promptDocument?.blocks).toEqual([
      expect.objectContaining({
        kind: 'reference', source: 'connection', sourceNodeId: 'source-text', relation: 'screenplay',
      }),
      expect.objectContaining({ kind: 'text', text: '' }),
    ])
    expect(connectedTask?.promptDocument).toEqual(connectedNode?.data.promptDocument)
    expect(connectedTask?.prompt).toBeNull()

    const edge = connected.edges.find(
      (item) => item.sourceNodeId === 'source-text' && item.targetNodeId === operationNode.id,
    )
    if (!edge) throw new Error('Input edge was not created')
    const disconnected = await canvasApi.deleteEdges('project-1', [edge.id])
    expect(
      disconnected.nodes
        .find((node) => node.id === operationNode.id)
        ?.data.promptDocument?.blocks.some((block) => block.kind === 'reference'),
    ).toBe(false)
  })

  it('keeps workflow compiled text and hidden system instructions out of the rebound editor', async () => {
    seedCanvasDb({
      projects: [{
        id: 'project-1', userId: 0, title: 'Project', status: 'active', nodeCount: 0,
        assetCount: 0, taskCount: 0, createdAt: at, updatedAt: at,
      }],
      boards: [{
        id: 'board-1', projectId: 'project-1', userId: 0, name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, createdAt: at, updatedAt: at,
      }],
      assets: [], nodes: [], edges: [], tasks: [],
    })
    const created = await canvasApi.createOperationNode({
      projectId: 'project-1', boardId: 'board-1', operation: 'text_generate',
      inputNodeIds: [], x: 100, y: 100,
    })
    const operationNode = created.nodes.find((node) => node.type === 'text_generate')
    if (!operationNode) throw new Error('Operation node was not created')
    const document = {
      version: 2 as const,
      blocks: [{ kind: 'text' as const, id: 'user-text', text: '只提取主要角色' }],
    }

    const started = await canvasApi.startWorkflowTask('project-1', {
      boardId: 'board-1', operation: 'text_generate', title: '提取角色',
      bindToNodeId: operationNode.id,
      prompt: '[剧本 ref-1: 场次剧本]\n雨夜车站',
      userPrompt: '只提取主要角色',
      promptDocument: document,
      compiledUserText: '[剧本 ref-1: 场次剧本]\n雨夜车站',
      systemPrompt: '隐藏的角色提取规则',
    })
    const reboundNode = started.snapshot.nodes.find((node) => node.id === operationNode.id)
    const reboundTask = started.snapshot.tasks.find((task) => task.id === started.taskId)

    expect(reboundNode?.data.prompt).toBe('只提取主要角色')
    expect(reboundNode?.data.promptDocument).toEqual(document)
    expect(reboundNode?.data.systemPrompt).toBe('隐藏的角色提取规则')
    expect(reboundNode?.data.prompt).not.toContain('隐藏的角色提取规则')
    expect(reboundTask?.prompt).toBe('[剧本 ref-1: 场次剧本]\n雨夜车站')
    expect(reboundTask?.promptDocument).toEqual(document)
    expect(reboundTask?.systemPrompt).toBe('隐藏的角色提取规则')
  })

  it('keeps compiled prompt documents out of the legacy operation prefix', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const document = {
      version: 2 as const,
      blocks: [{ kind: 'text' as const, id: 'text-1', text: '用户输入' }],
    }
    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({ status: 'running', assets: [] }),
      },
    })
    await canvasApi.createMediaTask('project-1', {
      operation: 'storyboard_grid',
      prompt: '用户输入',
      promptDocument: document,
    })

    expect(window.spark.invoke).toHaveBeenCalledWith(
      'canvas:task:create-media',
      expect.objectContaining({ prompt: '用户输入', promptDocument: document }),
    )
  })

  it('retries prompt-document tasks from the frozen submission fields', async () => {
    const document = {
      version: 2 as const,
      blocks: [{ kind: 'text' as const, id: 't1', text: '冻结文本' }],
    }
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 1,
          assetCount: 0,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-op',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_generate',
          title: '生成文本',
          assetId: null,
          taskId: 'task-old',
          parentNodeId: null,
          x: 0,
          y: 0,
          width: 240,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { operation: 'text_generate' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-old',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_generate',
          status: 'failed',
          progress: 100,
          title: '生成文本',
          prompt: '冻结文本',
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          promptDocument: document,
          promptSnapshot: { ...document, capturedAt: at },
          compiledUserText: '冻结文本',
          relationManifest: [],
          inputSnapshots: [],
          systemPrompt: '隐藏能力',
          createdAt: at,
          updatedAt: at,
        },
      ],
    })
    Object.assign(window, {
      spark: {
        invoke: vi
          .fn()
          .mockResolvedValue({
            status: 'running',
            providerProfileId: '',
            provider: '',
            model: '',
            text: '',
          }),
      },
    })

    await canvasApi.retryOperationNode('project-1', 'node-op')

    expect(window.spark.invoke).toHaveBeenCalledWith(
      'canvas:task:generate-text',
      expect.objectContaining({
        prompt: '冻结文本',
        promptDocument: document,
        compiledUserText: '冻结文本',
        systemPrompt: '隐藏能力',
      }),
    )
  })

  it('retries media tasks with their relation-derived input roles', async () => {
    const document = {
      version: 2 as const,
      blocks: [
        {
          kind: 'reference' as const,
          id: 'r1',
          source: 'connection' as const,
          sourceNodeId: 'first',
          relation: 'first_frame' as const,
          connectionRelation: 'reference_image' as const,
          label: '首帧',
          order: 0,
        },
      ],
    }
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 2,
          assetCount: 1,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-first',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'upload',
          title: '首帧',
          url: 'https://cdn/first.png',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'first',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: '首帧',
          assetId: 'asset-first',
          taskId: null,
          parentNodeId: null,
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { url: 'https://cdn/first.png', mimeType: 'image/png' },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-op',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image_to_video',
          title: '图片转视频',
          assetId: null,
          taskId: 'task-old',
          parentNodeId: null,
          x: 260,
          y: 0,
          width: 240,
          height: 160,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { operation: 'image_to_video' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-old',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'image_to_video',
          status: 'failed',
          progress: 100,
          title: '图片转视频',
          prompt: '[首帧 ref-1: 首帧]',
          inputNodeIds: ['first'],
          inputAssetIds: ['asset-first'],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          promptDocument: document,
          promptSnapshot: { ...document, capturedAt: at },
          compiledUserText: '[首帧 ref-1: 首帧]',
          relationManifest: [
            { blockId: 'r1', sourceNodeId: 'first', relation: 'first_frame', order: 0 },
          ],
          inputSnapshots: [],
          createdAt: at,
          updatedAt: at,
        },
      ],
    })
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ status: 'running', assets: [] }) },
    })

    await canvasApi.retryOperationNode('project-1', 'node-op')

    expect(window.spark.invoke).toHaveBeenCalledWith(
      'canvas:task:create-media',
      expect.objectContaining({
        inputFiles: [
          {
            type: 'image',
            role: 'first_frame',
            url: 'https://cdn/first.png',
            mimeType: 'image/png',
          },
        ],
      }),
    )
  })

  it('syncs manually connected image inputs into typed operation tasks', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          settings: {},
          nodeCount: 1,
          assetCount: 1,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-1',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: 'Source image',
          url: 'file:///source.png',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: 'Source image',
          assetId: 'asset-1',
          taskId: 'task-source',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 240,
          height: 180,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { url: 'file:///source.png' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: 'Source task',
          prompt: 'source prompt',
          negativePrompt: null,
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: ['node-source'],
          outputAssetIds: ['asset-1'],
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const created = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'image_to_image',
      inputNodeIds: [],
      x: 310,
      y: 20,
    })
    const operationNode = created.nodes.find((node) => node.type === 'image_to_image')

    const connected = await canvasApi.connectNodes('project-1', {
      sourceNodeId: 'node-source',
      targetNodeId: operationNode?.id ?? '',
    })

    const task = connected.tasks.find((item) => item.id === operationNode?.taskId)
    const sourceTask = connected.tasks.find((item) => item.id === 'task-source')
    const edge = connected.edges.find(
      (item) => item.sourceNodeId === 'node-source' && item.targetNodeId === operationNode?.id,
    )

    expect(edge?.type).toBe('used_as_input')
    expect(edge?.taskId).toBe(operationNode?.taskId)
    expect(task?.inputNodeIds).toEqual(['node-source'])
    expect(task?.inputAssetIds).toEqual(['asset-1'])
    expect(sourceTask?.inputNodeIds).toEqual([])
  })

  it('includes connected text asset content when submitting media tasks', async () => {
    const invoke = vi.fn().mockResolvedValue({
      providerProfileId: 'provider-1',
      provider: 'xai',
      model: 'grok-imagine-video',
      mode: 'sync',
      assets: [],
      status: 'failed',
      error: { code: 'test_stop', message: 'stop after capture' },
    })
    Object.assign(window, { spark: { invoke } })
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          settings: {},
          nodeCount: 2,
          assetCount: 2,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-shot',
          projectId: 'project-1',
          userId: 0,
          type: 'text',
          source: 'ai_generated',
          title: '分镜脚本',
          contentText: '| 镜号 | 画面 |\\n| 1 | 夜晚走廊推镜 |',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'asset-image',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: '首帧',
          url: 'safe-file://local/source.png',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-shot',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text',
          title: '分镜脚本',
          assetId: 'asset-shot',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 560,
          height: 240,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { text: '', format: 'markdown', pipelineRole: 'shot' },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-image',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: '首帧',
          assetId: 'asset-image',
          parentNodeId: null,
          x: 600,
          y: 20,
          width: 240,
          height: 180,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { url: 'safe-file://local/source.png' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [],
    })

    await canvasApi.createMediaTask('project-1', {
      operation: 'image_to_video',
      prompt: '根据输入生成镜头视频',
      inputNodeIds: ['node-shot', 'node-image'],
      inputFiles: [{ type: 'image', dataUrl: 'data:image/png;base64,AA==' }],
    })

    expect(invoke).toHaveBeenCalledWith(
      'canvas:task:create-media',
      expect.objectContaining({
        prompt: expect.stringContaining('【分镜脚本｜分镜脚本】'),
      }),
    )
    expect(invoke).toHaveBeenCalledWith(
      'canvas:task:create-media',
      expect.objectContaining({
        prompt: expect.stringContaining('夜晚走廊推镜'),
      }),
    )
  })

  it('applies app-level panorama presets and keeps 2:1 defaults for panorama nodes', async () => {
    window.localStorage.setItem(
      'spark-canvas:operation-presets:v1',
      JSON.stringify({
        panorama_360: {
          prompt: '日落海边栈道，电影感氛围，真实云层与海浪',
          modelParams: { size: '2048x1024' },
        },
      }),
    )
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const snapshot = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'panorama_360',
      inputNodeIds: [],
      x: 320,
      y: 40,
    })

    const operationNode = snapshot.nodes.find((node) => node.type === 'panorama_360')
    const pendingTask = snapshot.tasks.find((task) => task.id === operationNode?.taskId)
    expect(pendingTask?.prompt).toBeNull()
    expect(pendingTask?.systemPrompt).toContain('日落海边栈道，电影感氛围，真实云层与海浪')
    expect(pendingTask?.systemPrompt).toContain('2:1 等距柱状投影')
    expect(pendingTask?.modelParams).toEqual({
      aspect_ratio: '2:1',
      resolution: '2k',
      size: '2048x1024',
    })
    expect(operationNode?.data.modelParams).toEqual({
      aspect_ratio: '2:1',
      resolution: '2k',
      size: '2048x1024',
    })
  })

  it('initializes text operation nodes from app-level runtime presets', async () => {
    window.localStorage.setItem(
      'spark-canvas:operation-presets:v1',
      JSON.stringify({
        text_generate: {
          prompt: '请输出三段式文案结构',
          agentId: 'agent:copywriter',
          providerProfileId: 'provider:text',
          modelId: 'gpt-5',
          skillIds: ['skill:outline'],
          modelParams: { temperature: 0.3 },
        },
      }),
    )
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const snapshot = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'text_generate',
      inputNodeIds: [],
      x: 240,
      y: 80,
    })

    const operationNode = snapshot.nodes.find((node) => node.type === 'text_generate')
    const pendingTask = snapshot.tasks.find((task) => task.id === operationNode?.taskId)
    expect(pendingTask?.prompt).toBeNull()
    expect(pendingTask?.systemPrompt).toContain('请输出三段式文案结构')
    expect(pendingTask?.agentId).toBe('agent:copywriter')
    expect(pendingTask?.providerProfileId).toBe('provider:text')
    expect(pendingTask?.modelId).toBe('gpt-5')
    expect(pendingTask?.skillIds).toEqual(['skill:outline'])
    expect(pendingTask?.modelParams).toEqual({ temperature: 0.3 })
    expect(operationNode?.data.prompt).toBeUndefined()
    expect(operationNode?.data.agentId).toBe('agent:copywriter')
    expect(operationNode?.data.providerProfileId).toBe('provider:text')
    expect(operationNode?.data.modelId).toBe('gpt-5')
    expect(operationNode?.data.skillIds).toEqual(['skill:outline'])
    expect(operationNode?.data.modelParams).toEqual({ temperature: 0.3 })
  })

  it('keeps explicit node runtime overrides ahead of app-level presets', async () => {
    window.localStorage.setItem(
      'spark-canvas:operation-presets:v1',
      JSON.stringify({
        text_generate: {
          agentId: 'agent:copywriter',
          providerProfileId: 'provider:text',
          modelId: 'gpt-5',
          skillIds: ['skill:outline'],
          modelParams: { temperature: 0.3, top_p: 0.8 },
        },
      }),
    )
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const snapshot = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'text_generate',
      inputNodeIds: [],
      x: 260,
      y: 120,
      agentId: 'agent:director',
      providerProfileId: 'provider:override',
      modelId: 'gpt-5.5',
      skillIds: ['skill:rewrite'],
      modelParams: { temperature: 0.6 },
    })

    const operationNode = snapshot.nodes.find((node) => node.type === 'text_generate')
    const pendingTask = snapshot.tasks.find((task) => task.id === operationNode?.taskId)
    expect(pendingTask?.agentId).toBe('agent:director')
    expect(pendingTask?.providerProfileId).toBe('provider:override')
    expect(pendingTask?.modelId).toBe('gpt-5.5')
    expect(pendingTask?.skillIds).toEqual(['skill:rewrite'])
    expect(pendingTask?.modelParams).toEqual({ temperature: 0.6, top_p: 0.8 })
  })

  it('tracks local workflow tasks through completion and output lineage', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          nodeCount: 0,
          assetCount: 1,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-script',
          projectId: 'project-1',
          userId: 0,
          type: 'text',
          source: 'manual',
          title: 'Script',
          contentText: 'INT. ROOM - NIGHT',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const { taskId, snapshot: running } = await canvasApi.startWorkflowTask('project-1', {
      boardId: 'board-1',
      title: '剧本拆解 / 自动分镜',
      inputAssetIds: ['asset-script'],
      message: '正在拆解剧本...',
      modelParams: { workflow: 'script_breakdown' },
    })

    const runningTask = running.tasks.find((task) => task.id === taskId)
    const taskNode = running.nodes.find((node) => node.taskId === taskId)
    expect(runningTask?.status).toBe('running')
    expect(runningTask?.provider).toBe('canvas_workflow')
    expect(taskNode?.data.message).toBe('正在拆解剧本...')

    const outputNode = await canvasApi.createTextNode({
      projectId: 'project-1',
      boardId: 'board-1',
      text: 'Shot #1',
      x: 480,
      y: 120,
    })
    const finished = await canvasApi.finishWorkflowTask('project-1', taskId, {
      status: 'completed',
      outputNodeIds: [outputNode.id],
      message: '已展开 1 个分镜节点到画布',
      rawResponse: { workflow: 'script_breakdown', shotSegmentCount: 1 },
    })

    const completedTask = finished.tasks.find((task) => task.id === taskId)
    expect(completedTask?.status).toBe('completed')
    expect(completedTask?.outputNodeIds).toContain(outputNode.id)
    expect(completedTask?.rawResponse).toEqual({
      workflow: 'script_breakdown',
      shotSegmentCount: 1,
    })
    expect(
      finished.edges.some(
        (edge) =>
          edge.taskId === taskId &&
          edge.sourceNodeId === taskNode?.id &&
          edge.targetNodeId === outputNode.id &&
          edge.type === 'generated',
      ),
    ).toBe(true)
  })

  it('returns a running snapshot before slow text IPC completes', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 1,
          assetCount: 0,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-op',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_generate',
          title: '提取角色',
          taskId: 'task-pending',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { operation: 'text_generate', status: 'pending', progress: 12 },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-pending',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_generate',
          status: 'pending',
          progress: 12,
          title: '提取角色',
          prompt: '',
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })
    const invoke = vi.fn(() => new Promise(() => {}))
    Object.assign(window, { spark: { invoke } })

    const result = await Promise.race([
      canvasApi.createTextTask(
        'project-1',
        {
          operation: 'text_generate',
          prompt: '提取角色',
          taskTitle: '提取角色',
        },
        { bindToNodeId: 'node-op' },
      ),
      new Promise<'still-waiting'>((resolve) => setTimeout(() => resolve('still-waiting'), 0)),
    ])

    expect(result).not.toBe('still-waiting')
    if (result === 'still-waiting') return
    const runningNode = result.nodes.find((node) => node.id === 'node-op')
    const runningTask = result.tasks.find((task) => task.id === runningNode?.taskId)
    expect(runningTask?.status).toBe('running')
    expect(runningNode?.data.status).toBe('running')
    expect(runningNode?.taskId).not.toBe('task-pending')
    expect(result.tasks.some((task) => task.id === 'task-pending')).toBe(false)
    expect(invoke).toHaveBeenCalledWith(
      'canvas:task:generate-text',
      expect.objectContaining({
        waitForCompletion: false,
        projectId: 'project-1',
        clientTaskId: runningNode?.taskId,
      }),
    )
  })

  it('persists text task failure diagnostics for task detail inspection', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 1,
          assetCount: 0,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-op',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_generate',
          title: '生成剧本',
          taskId: 'task-running',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { operation: 'text_generate', status: 'running', progress: 35 },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-running',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_generate',
          status: 'running',
          progress: 35,
          title: '生成剧本',
          prompt: '生成剧本',
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-running', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'openai',
      model: 'gpt-5-codex',
      text: '',
      requestCall: {
        method: 'POST',
        url: 'https://api.openai.com/v1/responses',
        body: { model: 'gpt-5-codex', input: '生成剧本' },
      },
      rawResponse: { errorBody: '{"error":{"message":"bad request"}}' },
      error: {
        code: 'provider_http_error',
        message: 'provider HTTP 400: {"error":{"message":"bad request"}}',
      },
    })

    const failedTask = snapshot.tasks.find((task) => task.id === 'task-running')
    expect(failedTask?.status).toBe('failed')
    expect(failedTask?.requestCall).toEqual({
      method: 'POST',
      url: 'https://api.openai.com/v1/responses',
      body: { model: 'gpt-5-codex', input: '生成剧本' },
    })
    expect(failedTask?.rawResponse).toEqual({ errorBody: '{"error":{"message":"bad request"}}' })
    expect(failedTask?.errorDetail).toContain('bad request')
  })

  it('forwards task pipeline role when submitting storyboard text tasks', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 0,
          assetCount: 0,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [],
      edges: [],
      tasks: [],
    })

    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({
          status: 'running',
          providerProfileId: '',
          provider: '',
          model: '',
          text: '',
        }),
      },
    })

    await canvasApi.createTextTask('project-1', {
      operation: 'text_generate',
      prompt: '把场次拆成分镜',
      taskPipelineRole: 'shot',
    })

    expect(window.spark.invoke).toHaveBeenCalledWith(
      'canvas:task:generate-text',
      expect.objectContaining({
        taskPipelineRole: 'shot',
      }),
    )
  })

  it('does not downgrade a completed media task when a late running acknowledgement arrives', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 2,
          assetCount: 1,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-output',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: '林岚',
          url: 'safe-file://output.png',
          metadata: { taskId: 'task-done' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-task',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成角色身份板 · 林岚',
          taskId: 'task-done',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { operation: 'text_to_image', status: 'completed', progress: 100 },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-output',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: '林岚',
          assetId: 'asset-output',
          taskId: null,
          parentNodeId: null,
          x: 330,
          y: 20,
          width: 320,
          height: 180,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { origin: 'task_output', url: 'safe-file://output.png' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-done',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: '生成角色身份板 · 林岚',
          prompt: '角色身份板',
          negativePrompt: null,
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: ['node-output'],
          outputAssetIds: ['asset-output'],
          requestId: 'runtime-1',
          modelParams: {},
          createdAt: at,
          updatedAt: at,
          completedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.markMediaTaskSubmitted('project-1', 'task-done', {
      status: 'running',
      mode: 'async',
      runtimeTaskId: 'runtime-1',
      requestId: 'runtime-1',
      providerProfileId: 'provider-1',
      provider: 'apimart',
      model: 'image-model',
      assets: [],
    })

    const task = snapshot.tasks.find((item) => item.id === 'task-done')
    const node = snapshot.nodes.find((item) => item.id === 'node-task')
    expect(task?.status).toBe('completed')
    expect(task?.progress).toBe(100)
    expect(node?.data.status).toBe('completed')
    expect(snapshot.nodes.some((item) => item.id === 'node-output')).toBe(true)
  })

  it('keeps completed sibling operation nodes unchanged when running another node from the same source', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 4,
          assetCount: 1,
          taskCount: 2,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [
        {
          id: 'asset-output-1',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: '场景图 1',
          url: 'safe-file://scene-1.png',
          metadata: { taskId: 'task-done-1' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text',
          title: '场景节点',
          taskId: null,
          parentNodeId: null,
          x: 0,
          y: 0,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { text: '雨夜街角，霓虹灯反射在湿润地面上', format: 'plain' },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-op-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成场景图 1',
          taskId: 'task-done-1',
          parentNodeId: null,
          x: 320,
          y: 0,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { operation: 'text_to_image', status: 'completed', progress: 100 },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-output-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: '场景图 1',
          assetId: 'asset-output-1',
          taskId: null,
          parentNodeId: null,
          x: 640,
          y: 0,
          width: 320,
          height: 180,
          rotation: 0,
          zIndex: 3,
          locked: false,
          hidden: false,
          data: { origin: 'task_output', url: 'safe-file://scene-1.png' },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-op-2',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成场景图 2',
          taskId: 'task-pending-2',
          parentNodeId: null,
          x: 320,
          y: 240,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 4,
          locked: false,
          hidden: false,
          data: { operation: 'text_to_image', status: 'pending', progress: 0 },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [
        {
          id: 'edge-input-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'node-source',
          targetNodeId: 'node-op-1',
          type: 'used_as_input',
          taskId: 'task-done-1',
          metadata: {},
          createdAt: at,
        },
        {
          id: 'edge-output-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'node-op-1',
          targetNodeId: 'node-output-1',
          type: 'generated',
          taskId: 'task-done-1',
          metadata: {},
          createdAt: at,
        },
        {
          id: 'edge-input-2',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'node-source',
          targetNodeId: 'node-op-2',
          type: 'used_as_input',
          taskId: 'task-pending-2',
          metadata: {},
          createdAt: at,
        },
      ],
      tasks: [
        {
          id: 'task-done-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: '生成场景图 1',
          prompt: '雨夜街角',
          negativePrompt: null,
          inputNodeIds: ['node-source'],
          inputAssetIds: [],
          outputNodeIds: ['node-output-1'],
          outputAssetIds: ['asset-output-1'],
          requestId: 'runtime-done-1',
          modelParams: {},
          createdAt: at,
          updatedAt: at,
          completedAt: at,
        },
        {
          id: 'task-pending-2',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'pending',
          progress: 0,
          title: '生成场景图 2',
          prompt: '雨夜街角',
          negativePrompt: null,
          inputNodeIds: ['node-source'],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })
    const invoke = vi.fn().mockResolvedValue({
      status: 'running',
      mode: 'async',
      runtimeTaskId: 'runtime-new-2',
      requestId: 'runtime-new-2',
      providerProfileId: 'provider-1',
      provider: 'apimart',
      model: 'image-model',
      assets: [],
    })
    Object.assign(window, { spark: { invoke } })

    const snapshot = await canvasApi.runOperationNode('project-1', 'node-op-2', {
      prompt: '雨夜街角，另一种构图',
      inputNodeIds: ['node-source'],
      userPrompt: '另一种构图',
    })

    const firstNode = snapshot.nodes.find((item) => item.id === 'node-op-1')
    const firstTask = snapshot.tasks.find((item) => item.id === 'task-done-1')
    const secondNode = snapshot.nodes.find((item) => item.id === 'node-op-2')
    const secondTask = snapshot.tasks.find((item) => item.id === secondNode?.taskId)
    expect(firstNode?.data.status).toBe('completed')
    expect(firstNode?.taskId).toBe('task-done-1')
    expect(firstTask?.status).toBe('completed')
    expect(firstTask?.outputNodeIds).toEqual(['node-output-1'])
    expect(secondNode?.data.status).toBe('running')
    expect(secondNode?.data.prompt).toBe('另一种构图')
    expect(secondNode?.taskId).not.toBe('task-pending-2')
    expect(secondTask?.status).toBe('running')
    expect(secondTask?.prompt).toContain('雨夜街角，另一种构图')
    expect(secondTask?.prompt).toContain('画布节点内容')
  })

  it('writes media task outputs through task edges when the node task id was overwritten', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 2,
          assetCount: 0,
          taskCount: 2,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text',
          title: '场景节点',
          taskId: null,
          parentNodeId: null,
          x: 0,
          y: 0,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { text: '雨夜街角', format: 'plain' },
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'node-op',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成场景图',
          taskId: 'task-new',
          parentNodeId: null,
          x: 320,
          y: 0,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { operation: 'text_to_image', status: 'running', progress: 35 },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [
        {
          id: 'edge-old-input',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'node-source',
          targetNodeId: 'node-op',
          type: 'used_as_input',
          taskId: 'task-old',
          metadata: {},
          createdAt: at,
        },
      ],
      tasks: [
        {
          id: 'task-old',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'running',
          progress: 80,
          title: '生成场景图旧任务',
          prompt: '雨夜街角',
          negativePrompt: null,
          inputNodeIds: ['node-source'],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          requestId: 'runtime-old',
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
        {
          id: 'task-new',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'running',
          progress: 35,
          title: '生成场景图新任务',
          prompt: '另一种构图',
          negativePrompt: null,
          inputNodeIds: ['node-source'],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          requestId: 'runtime-new',
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.applyMediaTaskResult('project-1', 'task-old', {
      status: 'succeeded',
      mode: 'async',
      runtimeTaskId: 'runtime-old',
      requestId: 'runtime-old',
      providerProfileId: 'provider-1',
      provider: 'apimart',
      model: 'image-model',
      assets: [
        {
          type: 'image',
          filePath: '/tmp/project-1/assets/images/scene-old.png',
          mimeType: 'image/png',
          width: 1280,
          height: 720,
        },
      ],
    })

    const oldTask = snapshot.tasks.find((item) => item.id === 'task-old')
    const opNode = snapshot.nodes.find((item) => item.id === 'node-op')
    const outputNode = snapshot.nodes.find(
      (item) => item.id !== 'node-op' && item.id !== 'node-source',
    )
    const generatedEdge = snapshot.edges.find(
      (item) =>
        item.type === 'generated' &&
        item.taskId === 'task-old' &&
        item.sourceNodeId === 'node-op' &&
        item.targetNodeId === outputNode?.id,
    )

    expect(oldTask?.status).toBe('completed')
    expect(oldTask?.outputNodeIds).toEqual([outputNode?.id])
    expect(outputNode?.type).toBe('image')
    expect(generatedEdge).toBeDefined()
    expect(opNode?.taskId).toBe('task-new')
    expect(opNode?.data.status).toBe('running')
  })

  it('resets duplicated operation nodes to independent pending drafts', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 1,
          assetCount: 0,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-op-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成场景图',
          taskId: 'task-done-1',
          parentNodeId: null,
          x: 320,
          y: 0,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: {
            operation: 'text_to_image',
            status: 'completed',
            progress: 100,
            prompt: '雨夜街角',
            modelParams: { aspectRatio: '16:9' },
          },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-done-1',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: '生成场景图',
          prompt: '雨夜街角',
          negativePrompt: null,
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          modelParams: { aspectRatio: '16:9' },
          createdAt: at,
          updatedAt: at,
          completedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.duplicateNodes('project-1', ['node-op-1'])
    const duplicated = snapshot.nodes.find((node) => node.id !== 'node-op-1')

    expect(duplicated?.taskId).toBeNull()
    expect(duplicated?.data.status).toBe('pending')
    expect(duplicated?.data.progress).toBe(0)
    expect(duplicated?.data.prompt).toBe('雨夜街角')
    expect(duplicated?.data.modelParams).toEqual({ aspectRatio: '16:9' })
  })

  it('keeps current project assets when restoring a board snapshot for undo', async () => {
    const currentAsset = {
      id: 'asset-current',
      projectId: 'project-1',
      userId: 0,
      type: 'image' as const,
      source: 'ai_generated' as const,
      title: '当前资产',
      url: 'safe-file://current.png',
      metadata: { version: 'current' },
      createdAt: at,
      updatedAt: at,
    }
    const historicalAsset = {
      ...currentAsset,
      title: '历史资产',
      url: 'safe-file://historical.png',
      metadata: { version: 'historical' },
    }
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 1,
          assetCount: 1,
          taskCount: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [currentAsset],
      nodes: [],
      edges: [],
      tasks: [],
    })

    const snapshot = await canvasApi.restoreBoardSnapshot('project-1', {
      project: {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        nodeCount: 1,
        assetCount: 1,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
      board: {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
      boards: [],
      activeBoardId: 'board-1',
      nodes: [],
      edges: [],
      assets: [historicalAsset],
      tasks: [],
    })

    const asset = snapshot.assets.find((item) => item.id === 'asset-current')
    expect(asset?.title).toBe('当前资产')
    expect(asset?.url).toBe('safe-file://current.png')
    expect(asset?.metadata).toEqual({ version: 'current' })
  })

  it('uses operation outputTitle for generated media asset and node names', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          rootPath: '/tmp/project-1',
          nodeCount: 1,
          assetCount: 0,
          taskCount: 1,
          createdAt: at,
          updatedAt: at,
        },
      ],
      boards: [
        {
          id: 'board-1',
          projectId: 'project-1',
          userId: 0,
          name: 'Board',
          viewport: { x: 0, y: 0, zoom: 1 },
          settings: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      assets: [],
      nodes: [
        {
          id: 'node-task',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'text_to_image',
          title: '生成角色身份板 · 林岚',
          taskId: 'task-running',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 260,
          height: 160,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: {
            operation: 'text_to_image',
            status: 'running',
            progress: 35,
            outputPipelineRole: 'design_card',
            outputTitle: '林岚',
          },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-running',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'running',
          progress: 35,
          title: '生成角色身份板 · 林岚',
          prompt: '角色身份板',
          negativePrompt: null,
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: [],
          outputAssetIds: [],
          requestId: 'runtime-1',
          modelParams: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.applyMediaTaskResult('project-1', 'task-running', {
      status: 'succeeded',
      mode: 'async',
      runtimeTaskId: 'runtime-1',
      requestId: 'runtime-1',
      providerProfileId: 'provider-1',
      provider: 'apimart',
      model: 'image-model',
      assets: [
        {
          type: 'image',
          filePath: '/tmp/project-1/assets/images/linlan.png',
          mimeType: 'image/png',
          width: 1280,
          height: 720,
        },
      ],
    })

    const asset = snapshot.assets.find((item) => item.metadata.taskId === 'task-running')
    const outputNode = snapshot.nodes.find((item) => item.assetId === asset?.id)
    expect(asset?.title).toBe('林岚')
    expect(outputNode?.title).toBe('林岚')
    expect(outputNode?.data.pipelineRole).toBe('design_card')
  })
})

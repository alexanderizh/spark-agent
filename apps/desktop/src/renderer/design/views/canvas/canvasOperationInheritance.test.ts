// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi } from './canvas.api'
import type { CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'

const at = '2026-06-18T00:00:00.000Z'

function seedCanvasDb(db: CanvasDb) {
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
    expect(pendingTask?.prompt).toBe('cinematic portrait')
    expect(pendingTask?.negativePrompt).toBe('blurry, low quality')
    expect(pendingTask?.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
    expect(operationNode?.data.negativePrompt).toBe('blurry, low quality')
    expect(operationNode?.data.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
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
    expect(pendingTask?.prompt).toContain('日落海边栈道，电影感氛围，真实云层与海浪')
    expect(pendingTask?.prompt).toContain('2:1 等距柱状投影')
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
    expect(pendingTask?.prompt).toBe('请输出三段式文案结构')
    expect(pendingTask?.agentId).toBe('agent:copywriter')
    expect(pendingTask?.providerProfileId).toBe('provider:text')
    expect(pendingTask?.modelId).toBe('gpt-5')
    expect(pendingTask?.skillIds).toEqual(['skill:outline'])
    expect(pendingTask?.modelParams).toEqual({ temperature: 0.3 })
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
})

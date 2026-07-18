// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-18T00:00:00.000Z'

function seedSemanticTask(outputPipelineRole: 'screenplay' | 'shot'): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: '语义文本产物',
        status: 'active',
        settings: {},
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
        name: 'Canvas',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes: [
      {
        id: 'task-node',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text_generate',
        title: outputPipelineRole === 'shot' ? '生成分镜脚本' : '转剧本',
        assetId: null,
        taskId: 'task-1',
        parentNodeId: null,
        x: 100,
        y: 100,
        width: 520,
        height: 320,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: {
          operation: 'text_generate',
          status: 'running',
          outputPipelineRole,
        },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [],
    assets: [],
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        operation: 'text_generate',
        status: 'running',
        progress: 50,
        title: outputPipelineRole === 'shot' ? '生成分镜脚本' : '转剧本',
        prompt: '生成',
        negativePrompt: null,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  __resetCanvasHotCache()
}

const responseBase = {
  status: 'succeeded' as const,
  providerProfileId: 'provider-1',
  provider: 'test',
  model: 'model-1',
}

describe('semantic canvas text task output', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('window', window)
    Object.assign(window, { spark: { invoke: vi.fn().mockResolvedValue({}) } })
  })

  it('rejects invalid specialized output without creating a typed result node', async () => {
    seedSemanticTask('screenplay')

    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', {
      ...responseBase,
      text: '这是一个自由格式故事梗概。',
      rawResponse: { text: '这是一个自由格式故事梗概。' },
    })

    expect(snapshot.tasks[0]).toMatchObject({
      status: 'failed',
      errorMsg: 'invalid_screenplay_output',
    })
    expect(snapshot.tasks[0]?.outputNodeIds).toEqual([])
    expect(snapshot.tasks[0]?.modelOutputText).toBe('这是一个自由格式故事梗概。')
    expect(snapshot.tasks[0]?.completedAt).toBeTruthy()
    expect(snapshot.nodes.some((node) => node.data.pipelineRole === 'screenplay')).toBe(false)
  })

  it('keeps model output separate when runtime diagnostics already exist', async () => {
    seedSemanticTask('shot')
    const modelText = JSON.stringify({ episode: 1, characters: [{ name: '苏烬' }] })

    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', {
      ...responseBase,
      text: modelText,
      rawResponse: { executionPath: 'session-runtime', adapter: 'codex' },
    })

    expect(snapshot.tasks[0]).toMatchObject({
      status: 'failed',
      modelOutputText: modelText,
      rawResponse: { executionPath: 'session-runtime', adapter: 'codex' },
    })
  })

  it('normalizes valid storyboard JSON and writes shot groups before creating the result node', async () => {
    seedSemanticTask('shot')

    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', {
      ...responseBase,
      text: JSON.stringify({
        shots: [
          {
            index: 1,
            title: '推门进入',
            groupName: '第一场',
            durationSec: 4,
            shotSize: '全景',
            description: '林岚推门进入。',
            shotPrompt: '雨夜茶馆全景',
          },
        ],
      }),
    })

    const resultNode = snapshot.nodes.find((node) => node.data.pipelineRole === 'shot')
    expect(snapshot.tasks[0]?.status).toBe('completed')
    expect(resultNode?.data.text).toContain('| 镜号 |')
    const film = snapshot.project.metadata?.film as {
      shotGroups?: Array<{ name: string; segments: Array<{ durationSec?: number }> }>
    }
    expect(film.shotGroups?.[0]).toMatchObject({
      name: '第一场',
      segments: [{ durationSec: 4 }],
    })
  })

  it('materializes a completed storyboard task only once when completion is delivered twice', async () => {
    seedSemanticTask('shot')
    const response = {
      ...responseBase,
      text: JSON.stringify({
        shots: [{ index: 1, title: '推门进入', groupName: '第一场', durationSec: 4 }],
      }),
    }

    await canvasApi.applyTextTaskResult('project-1', 'task-1', response)
    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', response)
    const film = snapshot.project.metadata?.film as { shotGroups?: unknown[] }

    expect(film.shotGroups).toHaveLength(1)
    expect(snapshot.nodes.filter((node) => node.data.pipelineRole === 'shot')).toHaveLength(1)
    expect(snapshot.tasks[0]?.outputNodeIds).toHaveLength(1)
  })
})

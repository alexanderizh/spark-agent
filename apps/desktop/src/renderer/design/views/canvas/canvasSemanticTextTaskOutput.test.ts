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

function validStoryboardShot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index: 1,
    title: '推门进入',
    durationSec: 1,
    shotSize: '全景',
    angle: '机位高 150cm，平视',
    movement: '固定镜头',
    description: '林岚推门进入。',
    lighting: '主光 4300K，辅光 3200K，光比 4:1',
    composition: '九宫格右侧落点，前中后景 2:5:3',
    blocking: '林岚距镜头 300cm，距门 20cm',
    actionBeats: '0.0–0.5s：抬手；0.5–1.0s：推门',
    transition: '入：硬切；出：动作匹配硬切',
    firstFrame: '林岚在门外，手靠近门把手。',
    lastFrame: '林岚站在门内，视线朝画左。',
    continuity: '保持人物、光向、视线和道具手位。',
    shotPrompt: '雨夜茶馆全景，身份稳定，真实物理运动。',
    negativePrompt: '错误角色、畸形手指、文字水印、闪烁。',
    ...overrides,
  }
}

function validStoryboardOutput(shots: Record<string, unknown>[]): string {
  return JSON.stringify({
    shots,
    summary: {
      shotCount: shots.length,
      totalDurationSec: shots.reduce(
        (total, shot) => total + (typeof shot.durationSec === 'number' ? shot.durationSec : 0),
        0,
      ),
    },
  })
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
      text: validStoryboardOutput([validStoryboardShot({ groupName: '第一场' })]),
    })

    const resultNode = snapshot.nodes.find((node) => node.data.pipelineRole === 'shot')
    expect(snapshot.tasks[0]?.status).toBe('completed')
    expect(resultNode?.data.text).toContain('| 镜号 |')
    const film = snapshot.project.metadata?.film as {
      shotGroups?: Array<{
        id: string
        name: string
        segments: Array<{ id: string; durationSec?: number }>
      }>
    }
    expect(film.shotGroups?.[0]).toMatchObject({
      name: '第一场',
      segments: [{ durationSec: 1 }],
    })
    expect(resultNode?.data.shotGroupId).toBe(film.shotGroups?.[0]?.id)
    expect(resultNode?.data.shotSegmentId).toBe(film.shotGroups?.[0]?.segments[0]?.id)
  })

  it('materializes a completed storyboard task only once when completion is delivered twice', async () => {
    seedSemanticTask('shot')
    const response = {
      ...responseBase,
      text: validStoryboardOutput([validStoryboardShot({ groupName: '第一场' })]),
    }

    await canvasApi.applyTextTaskResult('project-1', 'task-1', response)
    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', response)
    const film = snapshot.project.metadata?.film as { shotGroups?: unknown[] }

    expect(film.shotGroups).toHaveLength(1)
    expect(snapshot.nodes.filter((node) => node.data.pipelineRole === 'shot')).toHaveLength(1)
    expect(snapshot.tasks[0]?.outputNodeIds).toHaveLength(1)
  })

  it('links a multi-shot result to its group without pretending it is one segment', async () => {
    seedSemanticTask('shot')
    const snapshot = await canvasApi.applyTextTaskResult('project-1', 'task-1', {
      ...responseBase,
      text: validStoryboardOutput([
        validStoryboardShot({ index: 1, groupName: '第一场' }),
        validStoryboardShot({ index: 2, title: '落座', groupName: '第一场' }),
      ]),
    })

    const resultNode = snapshot.nodes.find((node) => node.data.pipelineRole === 'shot')
    const film = snapshot.project.metadata?.film as {
      shotGroups?: Array<{ id: string; segments: unknown[] }>
    }
    expect(film.shotGroups?.[0]?.segments).toHaveLength(2)
    expect(resultNode?.data.shotGroupId).toBe(film.shotGroups?.[0]?.id)
    expect(resultNode?.data.shotSegmentId).toBeUndefined()
  })
})

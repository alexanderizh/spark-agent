import { describe, expect, it } from 'vitest'
import {
  buildStoryboardShotNodeDrafts,
  buildStoryboardShotNodeText,
  resolveStoryboardSplitSourceNode,
  splitStoryboardNode,
} from './canvasStoryboardNodeSplit'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode } from './canvas.types'

const storyboardText =
  '| 镜号 | 景别 | 画面 |\n| --- | --- | --- |\n| 1 | 远景 | 城市夜景 |\n| 2 | 特写 | 手握门把 |'

describe('canvasStoryboardNodeSplit', () => {
  it('creates one readable markdown node per shot', () => {
    const source = {
      id: 'storyboard',
      type: 'text',
      x: 100,
      y: 80,
      width: 560,
      height: 300,
      data: {
        text: storyboardText,
      },
    } as CanvasNode
    const drafts = buildStoryboardShotNodeDrafts(source)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]?.text).toContain('城市夜景')
    expect(drafts[1]?.text).toContain('手握门把')
    expect(drafts.every((draft) => draft.x > source.x + source.width)).toBe(true)
  })

  it('keeps each node limited to one shot', () => {
    const text = buildStoryboardShotNodeText({ title: '开场', description: '门打开' }, 0)
    expect(text).toContain('# 镜 01')
    expect(text).toContain('门打开')
  })

  it('uses a storyboard task primary text output as the split source', () => {
    const taskNode = {
      id: 'storyboard-task',
      type: 'text_generate',
      x: 100,
      y: 80,
      width: 560,
      height: 300,
      data: { operation: 'text_generate', outputPipelineRole: 'shot' },
    } as CanvasNode
    const primaryOutput = {
      id: 'storyboard-output',
      type: 'text',
      title: '分镜脚本',
      text: storyboardText,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    } satisfies CanvasOperationOutputView

    const source = resolveStoryboardSplitSourceNode(taskNode, primaryOutput)

    expect(source).toMatchObject({
      id: 'storyboard-task',
      type: 'text',
      data: { text: storyboardText, format: 'markdown' },
    })
    if (!source) throw new Error('Expected a storyboard split source')
    expect(buildStoryboardShotNodeDrafts(source)).toHaveLength(2)
  })

  it('does not enable task splitting for ordinary text outputs', () => {
    const taskNode = {
      id: 'text-task',
      type: 'text_generate',
      data: { operation: 'text_generate' },
    } as CanvasNode
    const primaryOutput = {
      id: 'plain-output',
      type: 'text',
      title: '普通文本',
      text: '这不是分镜脚本。',
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    } satisfies CanvasOperationOutputView

    expect(resolveStoryboardSplitSourceNode(taskNode, primaryOutput)).toBeNull()
  })

  it('connects split shots as downstream references instead of task outputs', async () => {
    const source = {
      id: 'storyboard-task',
      type: 'text',
      x: 100,
      y: 80,
      width: 560,
      height: 300,
      data: { text: storyboardText },
    } as CanvasNode
    const connected: Array<{ sourceNodeId: string; targetNodeId: string; type?: string }> = []
    let sequence = 0

    const created = await splitStoryboardNode({
      source,
      createTextNode: async (draft) =>
        ({
          ...source,
          id: `shot-${++sequence}`,
          x: draft.x,
          y: draft.y,
          data: { text: draft.text, format: draft.format },
        }) as CanvasNode,
      patchNodes: async () => undefined,
      connectNodes: async (edge) => {
        connected.push(edge)
      },
    })

    expect(created.map((node) => node.id)).toEqual(['shot-1', 'shot-2'])
    expect(connected).toEqual([
      { sourceNodeId: 'storyboard-task', targetNodeId: 'shot-1', type: 'references' },
      { sourceNodeId: 'storyboard-task', targetNodeId: 'shot-2', type: 'references' },
    ])
  })
})

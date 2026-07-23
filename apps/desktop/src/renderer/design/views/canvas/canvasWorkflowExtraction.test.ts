import { describe, expect, it } from 'vitest'
import { extractCanvasWorkflowDraft } from './canvasWorkflowExtraction'
import type { CanvasEdge, CanvasNode } from './canvas.types'

const at = '2026-07-23T00:00:00.000Z'

function node(
  id: string,
  type: CanvasNode['type'],
  x: number,
  overrides: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type,
    title: id,
    x,
    y: x / 2,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function edge(id: string, sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    sourceNodeId,
    targetNodeId,
    type: 'used_as_input',
    metadata: {},
    createdAt: at,
  }
}

describe('extractCanvasWorkflowDraft', () => {
  it('extracts internal topology and normalizes node positions', () => {
    const input = node('prompt', 'text', 100, { title: '商品描述' })
    const operation = node('generate', 'text_to_image', 500, {
      title: '生成主图',
      data: { operation: 'text_to_image', modelParams: { size: '1024x1024' } },
    })
    const output = node('image', 'image', 900, { title: '商品主图' })

    const draft = extractCanvasWorkflowDraft({
      projectId: 'project-1',
      boardId: 'board-1',
      selectedNodes: [input, operation, output],
      allNodes: [input, operation, output],
      allEdges: [edge('edge-1', 'prompt', 'generate'), edge('edge-2', 'generate', 'image')],
    })

    expect(draft.package.graph.nodes.map((item) => item.kind)).toEqual([
      'canvas_input',
      'canvas_operation',
      'canvas_output',
    ])
    expect(draft.package.graph.edges).toHaveLength(2)
    expect(Math.min(...draft.package.graph.nodes.map((item) => item.position.x))).toBe(0)
    expect(draft.package.contract.inputs[0]?.name).toBe('商品描述')
    expect(draft.package.contract.outputs[0]?.name).toBe('商品主图')
    expect(draft.package.provenance?.sourceNodeIds).toEqual(['prompt', 'generate', 'image'])
  })

  it('turns crossing edges into explicit workflow inputs and outputs', () => {
    const externalInput = node('reference', 'image', 0, { title: '角色参考图' })
    const operation = node('edit', 'image_edit', 400, { title: '统一角色风格' })
    const result = node('result', 'image', 800, { title: '角色定稿' })
    const externalConsumer = node('video', 'image_to_video', 1200, { title: '生成视频' })

    const draft = extractCanvasWorkflowDraft({
      projectId: 'project-1',
      boardId: 'board-1',
      selectedNodes: [operation, result],
      allNodes: [externalInput, operation, result, externalConsumer],
      allEdges: [
        edge('incoming', 'reference', 'edit'),
        edge('internal', 'edit', 'result'),
        edge('outgoing', 'result', 'video'),
      ],
    })

    expect(draft.package.graph.edges.map((item) => item.id)).toEqual(['internal'])
    expect(draft.package.contract.inputs).toEqual([
      expect.objectContaining({ name: '角色参考图', valueType: 'image', targetNodeId: 'edit' }),
    ])
    expect(draft.package.contract.outputs).toEqual([
      expect.objectContaining({ name: '角色定稿', valueType: 'image', sourceNodeId: 'result' }),
    ])
  })

  it('preserves port handles and operation runtime configuration', () => {
    const prompt = node('prompt', 'text', 0, { title: '提示词' })
    const operation = node('generate', 'text_to_image', 400, {
      title: '生成主图',
      data: {
        operation: 'text_to_image',
        modelParams: { size: '1024x1024', count: 2 },
        providerProfileId: 'provider-1',
        manifestId: 'manifest-1',
        modelId: 'model-1',
        inputBindings: [
          {
            id: 'binding-1',
            sourceNodeId: 'prompt',
            origin: 'connection',
            kind: 'text',
            relation: 'generic',
            role: 'input',
            enabled: true,
            order: 0,
          },
        ],
        outputMode: 'candidates',
        outputTitle: '主视觉候选',
      },
    })
    const output = node('output', 'image', 800, { title: '主视觉' })
    const firstEdge = edge('edge-1', 'prompt', 'generate')
    firstEdge.metadata = { sourceHandle: 'text', targetHandle: 'prompt' }
    const secondEdge = edge('edge-2', 'generate', 'output')
    secondEdge.type = 'generated'
    secondEdge.metadata = { sourceHandle: 'image', targetHandle: 'value' }

    const draft = extractCanvasWorkflowDraft({
      projectId: 'project-1',
      boardId: 'board-1',
      selectedNodes: [prompt, operation, output],
      allNodes: [prompt, operation, output],
      allEdges: [firstEdge, secondEdge],
    })

    expect(draft.package.graph.edges).toEqual([
      expect.objectContaining({
        type: 'used_as_input',
        sourceHandle: 'text',
        targetHandle: 'prompt',
      }),
      expect.objectContaining({
        type: 'generated',
        sourceHandle: 'image',
        targetHandle: 'value',
      }),
    ])
    expect(draft.package.graph.nodes[1]?.config).toEqual(
      expect.objectContaining({
        inputBindings: [expect.objectContaining({ sourceNodeId: 'prompt', role: 'input' })],
        outputMode: 'candidates',
        outputTitle: '主视觉候选',
      }),
    )
  })

  it('rejects selections that are too small or span another project', () => {
    const first = node('first', 'text', 0)
    expect(() =>
      extractCanvasWorkflowDraft({
        projectId: 'project-1',
        boardId: 'board-1',
        selectedNodes: [first],
        allNodes: [first],
        allEdges: [],
      }),
    ).toThrow(/至少选择 2 个节点/)

    const foreign = node('foreign', 'image', 100, { projectId: 'project-2' })
    expect(() =>
      extractCanvasWorkflowDraft({
        projectId: 'project-1',
        boardId: 'board-1',
        selectedNodes: [first, foreign],
        allNodes: [first, foreign],
        allEdges: [],
      }),
    ).toThrow(/同一项目/)
  })
})

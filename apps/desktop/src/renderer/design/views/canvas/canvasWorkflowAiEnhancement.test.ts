import { describe, expect, it } from 'vitest'
import type { CanvasWorkflowDraft } from './canvasWorkflowExtraction'
import { enhanceCanvasWorkflowDraftWithAi } from './canvasWorkflowAiEnhancement'

const draft: CanvasWorkflowDraft = {
  name: '生成图片',
  description: '由 3 个节点提取',
  tags: [],
  package: {
    schemaVersion: 1,
    graph: {
      nodes: [
        { id: 'input', kind: 'canvas_input', label: '文本', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'generate',
          kind: 'canvas_operation',
          label: '生成',
          position: { x: 200, y: 0 },
          config: { operation: 'text_to_image' },
        },
      ],
      edges: [{ id: 'edge-1', sourceNodeId: 'input', targetNodeId: 'generate' }],
    },
    contract: {
      inputs: [{ id: 'input-1', name: '文本', valueType: 'text', required: true, targetNodeId: 'input' }],
      outputs: [{ id: 'output-1', name: '图片', valueType: 'image', sourceNodeId: 'generate' }],
      exposedParams: [],
    },
    dependencies: { modelCapabilities: ['text_to_image'], canvasNodeKinds: ['text', 'image'] },
  },
}

describe('enhanceCanvasWorkflowDraftWithAi', () => {
  it('applies semantic suggestions without changing graph topology', async () => {
    const enhanced = await enhanceCanvasWorkflowDraftWithAi(draft, async () =>
      JSON.stringify({
        name: '商品主视觉生成',
        description: '根据商品描述生成可复用主视觉',
        tags: ['电商', '主视觉'],
        inputNames: { 'input-1': '商品描述' },
        outputNames: { 'output-1': '商品主视觉' },
        exposedParams: [
          {
            id: 'param-count',
            name: '候选数量',
            valueType: 'number',
            nodeId: 'generate',
            path: 'modelParams.count',
            defaultValue: 1,
          },
        ],
      }),
    )

    expect(enhanced.name).toBe('商品主视觉生成')
    expect(enhanced.package.contract.inputs[0]?.name).toBe('商品描述')
    expect(enhanced.package.contract.exposedParams[0]?.nodeId).toBe('generate')
    expect(enhanced.package.graph).toEqual(draft.package.graph)
  })

  it('rejects suggestions that reference missing nodes', async () => {
    await expect(
      enhanceCanvasWorkflowDraftWithAi(draft, async () =>
        JSON.stringify({
          name: '错误建议',
          description: '错误',
          tags: [],
          inputNames: {},
          outputNames: {},
          exposedParams: [
            {
              id: 'bad',
              name: '错误参数',
              valueType: 'text',
              nodeId: 'missing',
              path: 'prompt',
            },
          ],
        }),
      ),
    ).rejects.toThrow(/不存在的节点/)
    expect(draft.package.contract.exposedParams).toEqual([])
  })

  it('extracts JSON from fenced model output', async () => {
    const enhanced = await enhanceCanvasWorkflowDraftWithAi(
      draft,
      async () =>
        '```json\n{"name":"镜头视觉","description":"生成镜头图","tags":[],"inputNames":{},"outputNames":{},"exposedParams":[]}\n```',
    )
    expect(enhanced.name).toBe('镜头视觉')
  })
})

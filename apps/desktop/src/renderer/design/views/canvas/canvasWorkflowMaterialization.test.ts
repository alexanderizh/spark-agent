import { describe, expect, it } from 'vitest'
import type { CanvasWorkflowPackage } from '@spark/protocol'
import { buildCanvasWorkflowTemplateBlueprint } from './canvasWorkflowMaterialization'

function workflowPackage(): CanvasWorkflowPackage {
  return {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: 'prompt-source',
          kind: 'canvas_input',
          label: '产品描述',
          sourceNodeType: 'prompt',
          position: { x: 0, y: 20 },
          config: { text: '一只玻璃香水瓶', format: 'prompt' },
        },
        {
          id: 'image-generator',
          kind: 'canvas_operation',
          label: '产品图生成',
          sourceNodeType: 'text_to_image',
          position: { x: 360, y: 0 },
          config: {
            operation: 'text_to_image',
            prompt: '商业产品摄影',
            modelId: 'image-model',
            modelParams: { aspectRatio: '1:1', steps: 28 },
          },
        },
      ],
      edges: [
        {
          id: 'workflow-edge',
          sourceNodeId: 'prompt-source',
          targetNodeId: 'image-generator',
          type: 'generated',
          sourceHandle: 'output-text',
          targetHandle: 'input-prompt',
        },
      ],
    },
    contract: { inputs: [], outputs: [], exposedParams: [] },
    dependencies: {
      modelCapabilities: ['text_to_image'],
      canvasNodeKinds: ['prompt', 'text_to_image'],
    },
    provenance: {
      extractedFromProjectId: 'source-project',
      extractedFromCanvasId: 'source-board',
      sourceNodeIds: ['prompt-source', 'image-generator'],
    },
  }
}

describe('buildCanvasWorkflowTemplateBlueprint', () => {
  it('copies editable nodes, relative layout, configuration, and edge handles', () => {
    const result = buildCanvasWorkflowTemplateBlueprint(workflowPackage())

    expect(result).toEqual({
      nodes: [
        {
          ref: 'prompt-source',
          type: 'prompt',
          title: '产品描述',
          x: 0,
          y: 20,
          data: { text: '一只玻璃香水瓶', format: 'prompt' },
        },
        {
          ref: 'image-generator',
          type: 'text_to_image',
          title: '产品图生成',
          x: 360,
          y: 0,
          data: {
            operation: 'text_to_image',
            prompt: '商业产品摄影',
            modelId: 'image-model',
            modelParams: { aspectRatio: '1:1', steps: 28 },
          },
        },
      ],
      edges: [
        {
          from: 'prompt-source',
          to: 'image-generator',
          type: 'generated',
          sourceHandle: 'output-text',
          targetHandle: 'input-prompt',
        },
      ],
    })
    expect(JSON.stringify(result)).not.toContain('source-project')
    expect(JSON.stringify(result)).not.toContain('source-board')
  })

  it('infers a typed operation node from config when sourceNodeType is absent', () => {
    const input = workflowPackage()
    delete input.graph.nodes[1]!.sourceNodeType

    expect(buildCanvasWorkflowTemplateBlueprint(input).nodes[1]?.type).toBe('text_to_image')
  })

  it('rejects duplicate node ids before mutating the canvas', () => {
    const input = workflowPackage()
    input.graph.nodes[1]!.id = 'prompt-source'

    expect(() => buildCanvasWorkflowTemplateBlueprint(input)).toThrow('节点 ID 重复')
  })

  it('rejects edges whose endpoints are missing', () => {
    const input = workflowPackage()
    input.graph.edges[0]!.targetNodeId = 'missing-node'

    expect(() => buildCanvasWorkflowTemplateBlueprint(input)).toThrow('引用了不存在的节点')
  })

  it('rejects unsupported source node types', () => {
    const input = workflowPackage()
    input.graph.nodes[0]!.sourceNodeType = 'unknown-canvas-node'

    expect(() => buildCanvasWorkflowTemplateBlueprint(input)).toThrow('不支持的画布节点类型')
  })

  it('rejects operation nodes whose source type conflicts with their operation', () => {
    const input = workflowPackage()
    input.graph.nodes[1]!.sourceNodeType = 'text_to_video'

    expect(() => buildCanvasWorkflowTemplateBlueprint(input)).toThrow('节点类型与 operation 不一致')
  })
})

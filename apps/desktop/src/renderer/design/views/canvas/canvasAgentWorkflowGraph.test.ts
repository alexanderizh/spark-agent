import { describe, expect, it } from 'vitest'
import {
  buildCanvasAgentWorkflowBlueprint,
  validateCanvasAgentWorkflowGraph,
  type CanvasAgentWorkflowGraphSpec,
} from './canvasAgentWorkflowGraph'

const imageFlow = (): CanvasAgentWorkflowGraphSpec => ({
  name: '参考图转视频',
  nodes: [
    { ref: 'image-input', role: 'input', type: 'image', title: '上传参考图' },
    {
      ref: 'animate',
      role: 'operation',
      operation: 'image_to_video',
      title: '生成视频',
      prompt: '保持主体一致，添加自然镜头运动',
      dependsOn: ['image-input'],
      isOutput: true,
      expectedOutputTypes: ['video'],
    },
  ],
})

describe('canvas agent reusable workflow graph', () => {
  it('accepts an empty image input placeholder connected to a compatible output operation', () => {
    const result = validateCanvasAgentWorkflowGraph(imageFlow())

    expect(result.valid).toBe(true)
    expect(result.inputRefs).toEqual(['image-input'])
    expect(result.outputRefs).toEqual(['animate'])
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
  })

  it('rejects duplicate refs, missing endpoints, self dependencies, and cycles', () => {
    const spec: CanvasAgentWorkflowGraphSpec = {
      name: '坏图',
      nodes: [
        { ref: 'input', role: 'input', type: 'prompt', title: '输入' },
        {
          ref: 'op',
          role: 'operation',
          operation: 'text_generate',
          title: '步骤 A',
          dependsOn: ['missing', 'op', 'op-b'],
        },
        {
          ref: 'op-b',
          role: 'operation',
          operation: 'text_generate',
          title: '步骤 B',
          dependsOn: ['op'],
          isOutput: true,
        },
        { ref: 'op-b', role: 'note', type: 'text', title: '重复' },
      ],
    }

    const codes = validateCanvasAgentWorkflowGraph(spec).diagnostics.map((item) => item.code)

    expect(codes).toContain('duplicate_ref')
    expect(codes).toContain('missing_dependency')
    expect(codes).toContain('self_dependency')
    expect(codes).toContain('cycle')
  })

  it('allows independent notes but rejects disconnected operation nodes', () => {
    const spec = imageFlow()
    spec.nodes.push(
      { ref: 'note', role: 'note', type: 'text', title: '使用说明', content: '替换输入图后运行' },
      {
        ref: 'orphan',
        role: 'operation',
        operation: 'text_to_image',
        title: '孤立步骤',
        prompt: '未接入主流程',
      },
    )

    const result = validateCanvasAgentWorkflowGraph(spec)

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ nodeRef: 'note', severity: 'error' })]),
    )
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'operation_not_reachable_from_input', nodeRef: 'orphan' }),
        expect.objectContaining({ code: 'operation_cannot_reach_output', nodeRef: 'orphan' }),
      ]),
    )
  })

  it('validates operation input and expected output types', () => {
    const spec = imageFlow()
    spec.nodes[0] = { ref: 'image-input', role: 'input', type: 'audio', title: '错误输入' }
    const operation = spec.nodes[1]
    if (operation?.role === 'operation') operation.expectedOutputTypes = ['image']

    const codes = validateCanvasAgentWorkflowGraph(spec).diagnostics.map((item) => item.code)

    expect(codes).toContain('incompatible_input_type')
    expect(codes).toContain('incompatible_output_type')
  })

  it('supports branches, merges, multiple inputs, and multiple terminal outputs', () => {
    const spec: CanvasAgentWorkflowGraphSpec = {
      name: '商品内容套件',
      nodes: [
        { ref: 'product', role: 'input', type: 'image', title: '商品图' },
        { ref: 'brief', role: 'input', type: 'prompt', title: '创作要求', content: '输入卖点' },
        {
          ref: 'copy', role: 'operation', operation: 'text_generate', title: '生成文案',
          prompt: '生成商品文案', dependsOn: ['brief'], isOutput: true,
          expectedOutputTypes: ['text'],
        },
        {
          ref: 'poster', role: 'operation', operation: 'image_edit', title: '生成海报',
          prompt: '合成商业海报', dependsOn: ['product', 'brief'], isOutput: true,
          expectedOutputTypes: ['image'],
        },
      ],
    }

    const result = validateCanvasAgentWorkflowGraph(spec)

    expect(result.valid).toBe(true)
    expect(result.inputRefs).toEqual(['product', 'brief'])
    expect(result.outputRefs).toEqual(['copy', 'poster'])
  })

  it('builds deterministic left-to-right layout without overlaps', () => {
    const first = buildCanvasAgentWorkflowBlueprint(imageFlow(), {
      obstacles: [{ id: 'existing', x: 0, y: 0, width: 900, height: 700 }],
    })
    const second = buildCanvasAgentWorkflowBlueprint(imageFlow(), {
      obstacles: [{ id: 'existing', x: 0, y: 0, width: 900, height: 700 }],
    })

    expect(first).toEqual(second)
    expect(first.originX).toBeGreaterThanOrEqual(964)
    expect(first.nodes[0]).toMatchObject({ ref: 'image-input', type: 'image' })
    expect(first.nodes[0]?.data).toMatchObject({ subtype: 'workflow_input', productionState: 'empty' })
    expect(first.nodes[1]!.x).toBeGreaterThan(first.nodes[0]!.x + first.nodes[0]!.width!)
    expect(first.edges).toEqual([
      expect.objectContaining({ from: 'image-input', to: 'animate', type: 'used_as_input' }),
    ])
  })

  it('places merge operations after their deepest dependency and separates same-layer branches', () => {
    const spec: CanvasAgentWorkflowGraphSpec = {
      name: '分支汇合',
      nodes: [
        { ref: 'brief', role: 'input', type: 'prompt', title: '需求' },
        { ref: 'a', role: 'operation', operation: 'text_generate', title: 'A', dependsOn: ['brief'] },
        { ref: 'b', role: 'operation', operation: 'text_generate', title: 'B', dependsOn: ['brief'] },
        {
          ref: 'merge', role: 'operation', operation: 'text_generate', title: '汇总',
          dependsOn: ['a', 'b'], isOutput: true,
        },
      ],
    }

    const result = buildCanvasAgentWorkflowBlueprint(spec)
    const positions = Object.fromEntries(result.nodes.map((node) => [node.ref, node]))

    expect(positions.a!.x).toBe(positions.b!.x)
    expect(positions.a!.y).not.toBe(positions.b!.y)
    expect(positions.merge!.x).toBeGreaterThan(positions.a!.x)
    expect(positions.merge!.y).toBeGreaterThan(positions.a!.y)
    expect(positions.merge!.y).toBeLessThan(positions.b!.y)
  })
})

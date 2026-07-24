import type { CanvasToolContext, CanvasToolDescriptor } from './canvas.tools'
import {
  buildCanvasAgentWorkflowBlueprint,
  validateCanvasAgentWorkflowGraph,
  validateCanvasWorkflowSubgraph,
  type CanvasAgentWorkflowGraphSpec,
  type CanvasWorkflowGraphDiagnostic,
} from './canvasAgentWorkflowGraph'

type JSONSchema = Record<string, unknown>

const inputNodeSchema: JSONSchema = {
  type: 'object',
  required: ['ref', 'role', 'type', 'title'],
  additionalProperties: false,
  properties: {
    ref: { type: 'string', description: '图内唯一引用名，例如 product_image' },
    role: { type: 'string', enum: ['input'] },
    type: { type: 'string', enum: ['text', 'prompt', 'image', 'video', 'audio'] },
    title: { type: 'string' },
    content: { type: 'string', description: '文本/Prompt 默认内容；媒体输入省略以创建空占位' },
    optional: { type: 'boolean', description: '是否为可选输入' },
  },
}

const operationNodeSchema: JSONSchema = {
  type: 'object',
  required: ['ref', 'role', 'operation', 'title', 'dependsOn'],
  additionalProperties: false,
  properties: {
    ref: { type: 'string', description: '图内唯一引用名' },
    role: { type: 'string', enum: ['operation'] },
    operation: {
      type: 'string',
      enum: [
        'text_to_image', 'image_to_image', 'image_edit', 'image_compose', 'storyboard_grid',
        'panorama_360', 'text_generate', 'text_rewrite', 'prompt_optimize', 'text_to_video',
        'image_to_video', 'video_edit', 'video_extend', 'text_to_audio', 'audio_transcribe',
      ],
    },
    title: { type: 'string' },
    dependsOn: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string' },
      description: '上游 input/operation 节点 ref；工具会据此创建真实连线',
    },
    prompt: { type: 'string', description: '可复用默认提示词' },
    negativePrompt: { type: 'string' },
    systemPrompt: { type: 'string' },
    modelParams: { type: 'object', additionalProperties: true },
    providerProfileId: { type: 'string' },
    manifestId: { type: 'string' },
    modelId: { type: 'string' },
    agentId: { type: 'string' },
    isOutput: { type: 'boolean', description: '标记为流程终点；省略时自动推断无下游操作的节点' },
    expectedOutputTypes: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string', enum: ['text', 'prompt', 'image', 'video', 'audio'] },
    },
  },
}

const noteNodeSchema: JSONSchema = {
  type: 'object',
  required: ['ref', 'role', 'title'],
  additionalProperties: false,
  properties: {
    ref: { type: 'string' },
    role: { type: 'string', enum: ['note'] },
    type: { type: 'string', enum: ['text', 'prompt'] },
    title: { type: 'string' },
    content: { type: 'string' },
  },
}

const graphSchema: JSONSchema = {
  type: 'object',
  required: ['name', 'nodes'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', description: '本次画布工作流图名称，不会自动保存到工作流库' },
    description: { type: 'string' },
    nodes: {
      type: 'array',
      minItems: 2,
      items: { oneOf: [inputNodeSchema, operationNodeSchema, noteNodeSchema] },
    },
  },
}

function requireGraphSpec(input: unknown): CanvasAgentWorkflowGraphSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工作流图参数必须是对象')
  }
  const record = input as Record<string, unknown>
  if (typeof record.name !== 'string' || !record.name.trim()) {
    throw new Error('工作流图 name 不能为空')
  }
  if (!Array.isArray(record.nodes)) throw new Error('工作流图 nodes 必须是数组')
  return input as CanvasAgentWorkflowGraphSpec
}

function activeBoardId(ctx: CanvasToolContext): string {
  const snapshot = ctx.getSnapshot()
  if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试。')
  return snapshot.activeBoardId ?? snapshot.board.id
}

function selectionEmptyDiagnostic(): CanvasWorkflowGraphDiagnostic {
  return {
    severity: 'error',
    code: 'selection_empty',
    message: '没有可校验的工作流节点',
    suggestion: '框选流程节点，或在 nodeIds 中明确提供节点 id。',
  }
}

const createTool: CanvasToolDescriptor = {
  name: 'canvas_create_reusable_workflow_graph',
  description:
    '首选工具：在当前无限画布中原子创建完整可复用流程。根据语义依赖自动创建空媒体输入占位、真实节点、任务、连线和从左到右布局，并在创建前后校验输入/输出与链路。不会自动保存到工作流库。',
  paramsSchema: graphSchema,
  handler: async (ctx, rawInput) => {
    const input = requireGraphSpec(rawInput)
    const snapshot = ctx.getSnapshot()
    if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试。')
    const preflight = validateCanvasAgentWorkflowGraph(input)
    if (!preflight.valid) {
      return {
        created: false,
        ...preflight,
        instruction: '存在阻断错误，修正语义图后重新调用；不要声称工作流已经创建完成。',
      }
    }
    const boardId = activeBoardId(ctx)
    const blueprint = buildCanvasAgentWorkflowBlueprint(input, {
      obstacles: snapshot.nodes
        .filter((node) => node.boardId === boardId && !node.hidden)
        .map((node) => ({
          id: node.id,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        })),
    })
    const beforeIds = new Set(snapshot.nodes.map((node) => node.id))
    const next = await ctx.workspace.applyTemplate({
      boardId,
      originX: blueprint.originX,
      originY: blueprint.originY,
      nodes: blueprint.nodes,
      edges: blueprint.edges,
    })
    const createdNodes = next.nodes.filter((node) => !beforeIds.has(node.id))
    const createdIds = new Set(createdNodes.map((node) => node.id))
    const createdEdges = next.edges.filter(
      (edge) => createdIds.has(edge.sourceNodeId) && createdIds.has(edge.targetNodeId),
    )
    const postflight = validateCanvasWorkflowSubgraph(createdNodes, createdEdges)
    const refToNodeId = new Map<string, string>()
    blueprint.nodes.forEach((node, index) => {
      const created = createdNodes[index]
      if (created) refToNodeId.set(node.ref, created.id)
    })
    const diagnostics = [...preflight.diagnostics, ...postflight.diagnostics]
    if (createdNodes.length !== blueprint.nodes.length) {
      diagnostics.push({
        severity: 'error',
        code: 'materialization_node_count_mismatch',
        message: `计划创建 ${blueprint.nodes.length} 个节点，实际创建 ${createdNodes.length} 个`,
        suggestion: '保留返回的 createdNodeIds，并重新校验或删除后重试。',
      })
    }
    const valid = !diagnostics.some((item) => item.severity === 'error')
    return {
      created: true,
      valid,
      name: input.name,
      createdNodeIds: createdNodes.map((node) => node.id),
      inputNodeIds: blueprint.inputRefs
        .map((ref) => refToNodeId.get(ref))
        .filter((id): id is string => Boolean(id)),
      outputNodeIds: blueprint.outputRefs
        .map((ref) => refToNodeId.get(ref))
        .filter((id): id is string => Boolean(id)),
      edgeCount: createdEdges.length,
      diagnostics,
      instruction: valid
        ? '工作流子图已创建并复核，可继续局部修改；只有用户明确要求时才保存到工作流库。'
        : '创建后复核发现阻断错误，必须先修复并再次调用 canvas_validate_workflow_graph。',
    }
  },
}

const validateTool: CanvasToolDescriptor = {
  name: 'canvas_validate_workflow_graph',
  description:
    '只读检查指定或当前选中的无限画布工作流子图：输入/输出边界、操作配置、连线完整性、类型兼容、环路和节点重叠。不会要求画布上的备注或其他无关节点必须连线。',
  paramsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nodeIds: {
        type: 'array',
        uniqueItems: true,
        items: { type: 'string' },
        description: '要校验的流程节点 id；省略时使用当前画布选区',
      },
    },
  },
  handler: async (ctx, input: { nodeIds?: string[] }) => {
    const snapshot = ctx.getSnapshot()
    if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试。')
    const requestedIds = input.nodeIds?.length ? input.nodeIds : (ctx.getSelectedNodeIds?.() ?? [])
    if (requestedIds.length === 0) {
      return {
        valid: false,
        checkedNodeIds: [],
        inputNodeIds: [],
        outputNodeIds: [],
        diagnostics: [selectionEmptyDiagnostic()],
      }
    }
    const requested = new Set(requestedIds)
    const nodes = snapshot.nodes.filter((node) => requested.has(node.id) && !node.hidden)
    const result = validateCanvasWorkflowSubgraph(nodes, snapshot.edges)
    const missing = requestedIds.filter((id) => !nodes.some((node) => node.id === id))
    if (missing.length === 0) return result
    const diagnostics = [
      ...result.diagnostics,
      {
        severity: 'error' as const,
        code: 'node_not_found',
        message: `未找到节点：${missing.join('、')}`,
        relatedRefs: missing,
        suggestion: '重新查询画布节点并使用当前有效 id。',
      },
    ]
    return { ...result, valid: false, diagnostics }
  },
}

export const CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS: ReadonlyArray<CanvasToolDescriptor> = [
  createTool,
  validateTool,
]

export async function executeCanvasAgentWorkflowGraphTool(
  ctx: CanvasToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = CANVAS_AGENT_WORKFLOW_GRAPH_TOOLS.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`未知画布工作流图工具：${name}`)
  return tool.handler(ctx, input)
}

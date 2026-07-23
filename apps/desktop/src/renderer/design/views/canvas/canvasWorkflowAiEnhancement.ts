import { z } from 'zod'
import { CanvasWorkflowExposedParamSchema } from '@spark/protocol'
import type { CanvasWorkflowDraft } from './canvasWorkflowExtraction'

const EnhancementSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000),
  tags: z.array(z.string().trim().min(1).max(60)).max(12),
  inputNames: z.record(z.string(), z.string().trim().min(1).max(160)),
  outputNames: z.record(z.string(), z.string().trim().min(1).max(160)),
  exposedParams: z.array(CanvasWorkflowExposedParamSchema).max(30),
})

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 未返回可解析的工作流语义 JSON')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new Error('AI 返回的工作流语义 JSON 无效')
  }
}

function buildPrompt(draft: CanvasWorkflowDraft): string {
  const topology = {
    nodes: draft.package.graph.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      label: node.label,
      sourceNodeType: node.sourceNodeType,
      operation: typeof node.config.operation === 'string' ? node.config.operation : undefined,
      configKeys: Object.keys(node.config).filter(
        (key) => !['prompt', 'systemPrompt', 'negativePrompt'].includes(key),
      ),
    })),
    edges: draft.package.graph.edges,
    inputs: draft.package.contract.inputs,
    outputs: draft.package.contract.outputs,
    dependencies: draft.package.dependencies,
  }
  return [
    '你是专业内容创作平台的画布工作流设计师。',
    '请只补充语义，不得改变节点、连线、节点 ID、契约 ID 或依赖。',
    '为工作流给出准确名称、用途说明、标签、输入输出名称，并只暴露创作者高频需要调整的参数。',
    'exposedParams.nodeId 必须来自 nodes；path 必须是现有配置中的稳定路径，例如 modelParams.count。',
    '只返回 JSON：{"name":"","description":"","tags":[],"inputNames":{"input-id":"名称"},"outputNames":{"output-id":"名称"},"exposedParams":[]}',
    JSON.stringify(topology),
  ].join('\n')
}

export async function enhanceCanvasWorkflowDraftWithAi(
  draft: CanvasWorkflowDraft,
  generate: (prompt: string) => Promise<string>,
): Promise<CanvasWorkflowDraft> {
  const response = await generate(buildPrompt(draft))
  const parsed = EnhancementSchema.parse(extractJson(response))
  const nodeIds = new Set(draft.package.graph.nodes.map((node) => node.id))
  const inputIds = new Set(draft.package.contract.inputs.map((input) => input.id))
  const outputIds = new Set(draft.package.contract.outputs.map((output) => output.id))
  for (const param of parsed.exposedParams) {
    if (!nodeIds.has(param.nodeId)) {
      throw new Error(`AI 建议参数“${param.name}”引用了不存在的节点 ${param.nodeId}`)
    }
  }
  for (const id of Object.keys(parsed.inputNames)) {
    if (!inputIds.has(id)) throw new Error(`AI 建议引用了不存在的输入 ${id}`)
  }
  for (const id of Object.keys(parsed.outputNames)) {
    if (!outputIds.has(id)) throw new Error(`AI 建议引用了不存在的输出 ${id}`)
  }

  return {
    name: parsed.name,
    description: parsed.description,
    tags: parsed.tags,
    package: {
      ...draft.package,
      graph: draft.package.graph,
      contract: {
        inputs: draft.package.contract.inputs.map((input) => ({
          ...input,
          name: parsed.inputNames[input.id] ?? input.name,
        })),
        outputs: draft.package.contract.outputs.map((output) => ({
          ...output,
          name: parsed.outputNames[output.id] ?? output.name,
        })),
        exposedParams: parsed.exposedParams,
      },
    },
  }
}

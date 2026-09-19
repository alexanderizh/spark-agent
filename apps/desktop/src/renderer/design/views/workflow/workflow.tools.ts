/**
 * 工作流 Agent 工具注册表（E2-2，对称 canvas.tools.ts）
 *
 * 设计：每个工具是纯描述符（name + description + JSON Schema + handler）。
 * Handler 在渲染进程执行，通过 `WorkflowToolContext` 拿到当前编辑器的
 * graph 状态与落库封装。E2-1 的 spark_workflow MCP 桥把 SDK 工具调用
 * 经主进程转发到这里。
 *
 * 工具命名：`workflow_<verb>_<noun>`（snake_case，便于 LLM 调用）。
 * 写模型：「整图提交 + updatedAt 乐观锁」——LLM 先 workflow_get_graph 读
 * 最新图与 baseVersion，改完提交全图；baseVersion 与库内 updatedAt 不符
 * 时 patch 拒绝（用户可能手动改过），强制重新读图，绝不静默覆盖。
 * 落库走 workflow:create / workflow:update，保存闸门（WorkflowGraphSchema
 * + 拓扑检测）自动生效。
 */
import type { WorkflowGraph } from '@spark/protocol'
import type { WorkflowValidateResponse } from '@spark/protocol'

type JSONSchema = Record<string, unknown>

/** 工作流编辑器当前状态的只读视图（由编辑器/面板提供，graph 为实时引用） */
export interface WorkflowEditorState {
  /** 当前编辑器打开的工作流 id；新建尚未落库时为 null */
  workflowId: string | null
  name: string
  graph: WorkflowGraph
}

export interface WorkflowToolContext {
  /** 读取当前编辑器状态；编辑器未就绪时返回 null */
  getEditorState: () => WorkflowEditorState | null
  /** 新建工作流并落库（workflow:create；保存闸门自动生效） */
  createWorkflow: (input: {
    name: string
    graph: WorkflowGraph
  }) => Promise<{ workflowId: string; updatedAt: string }>
  /** 更新工作流（workflow:update） */
  updateWorkflow: (input: {
    id: string
    name?: string
    graph: WorkflowGraph
  }) => Promise<{ updatedAt: string }>
  /** 读取库内工作流的最新 updatedAt（乐观锁比对用）；工作流不存在时返回 null */
  getWorkflowUpdatedAt: (id: string) => Promise<string | null>
  /** 只读校验（workflow:validate；形状层 + 拓扑层结构化诊断） */
  validateGraph: (graph: WorkflowGraph) => Promise<WorkflowValidateResponse>
  /** 新工作流落库成功后把编辑器切换到该工作流（可选；面板接线时提供） */
  onWorkflowCreated?: (workflowId: string) => void
}

export interface WorkflowToolDescriptor {
  name: string
  description: string
  paramsSchema: JSONSchema
  handler: (ctx: WorkflowToolContext, input: object) => Promise<unknown>
}

const emptyObjectSchema: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
}

function requireObject(input: unknown): Record<string, unknown> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工具参数必须是对象')
  }
  return input as Record<string, unknown>
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`参数 ${key} 必须是非空字符串`)
  }
  return value
}

function requireGraph(input: Record<string, unknown>): WorkflowGraph {
  const graph = input.graph
  if (graph == null || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error('参数 graph 必须是工作流图对象')
  }
  return graph as WorkflowGraph
}

const getGraphTool: WorkflowToolDescriptor = {
  name: 'workflow_get_graph',
  description:
    '只读读取工作流编辑器当前打开的图。每次修改前必须先调用本工具获取最新图与 baseVersion（反上下文腐化：你记忆中的图可能已过期）；patch 提交时需原样携带 baseVersion。',
  paramsSchema: emptyObjectSchema,
  handler: async (ctx) => {
    const state = ctx.getEditorState()
    if (!state) throw new Error('工作流编辑器尚未就绪，无法读取当前图。')
    const baseVersion =
      state.workflowId != null ? await ctx.getWorkflowUpdatedAt(state.workflowId) : null
    return {
      workflowId: state.workflowId,
      name: state.name,
      nodeCount: state.graph.nodes.length,
      edgeCount: state.graph.edges.length,
      graph: state.graph,
      baseVersion,
      instruction:
        state.workflowId == null
          ? '当前编辑器是一张未保存的新图；首次提交请用 workflow_generate。'
          : '基于本图修改后，用 workflow_patch 提交并原样携带 baseVersion。',
    }
  },
}

const validateTool: WorkflowToolDescriptor = {
  name: 'workflow_validate',
  description:
    '只读校验工作流图：节点 kind 枚举、config 字段白名单、边条件结构、循环依赖、条件引用（与保存闸门同一套规则）。返回结构化 diagnostics；提交前自检，全部通过再落库。',
  paramsSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      graph: {
        type: 'object',
        description: '要校验的工作流图；省略时校验当前编辑器打开的图',
      },
    },
  },
  handler: async (ctx, rawInput) => {
    const input = requireObject(rawInput)
    const state = ctx.getEditorState()
    const graph = (input.graph ?? state?.graph) as WorkflowGraph | undefined
    if (graph == null) throw new Error('没有可校验的图：传入 graph 参数或先打开一个工作流。')
    return ctx.validateGraph(graph)
  },
}

const generateTool: WorkflowToolDescriptor = {
  name: 'workflow_generate',
  description:
    '首次创建：把完整工作流图落库为新工作流（name + 全量 graph）。编辑器已绑定工作流时不会重复创建，会返回引导信息要求走 workflow_get_graph + workflow_patch 路径。提交前请先 workflow_validate 自检。',
  paramsSchema: {
    type: 'object',
    required: ['name', 'graph'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', description: '工作流名称' },
      graph: { type: 'object', description: '完整工作流图（nodes + edges）' },
    },
  },
  handler: async (ctx, rawInput) => {
    const input = requireObject(rawInput)
    const name = requireString(input, 'name')
    const graph = requireGraph(input)
    const state = ctx.getEditorState()
    if (!state) throw new Error('工作流编辑器尚未就绪，无法创建工作流。')
    if (state.workflowId != null) {
      return {
        created: false,
        workflowId: state.workflowId,
        instruction:
          '当前编辑器已绑定工作流，本次调用未创建新工作流。请先 workflow_get_graph 读取最新图与 baseVersion，再基于最新状态用 workflow_patch 提交修改。',
      }
    }
    const created = await ctx.createWorkflow({ name, graph })
    ctx.onWorkflowCreated?.(created.workflowId)
    return {
      created: true,
      workflowId: created.workflowId,
      baseVersion: created.updatedAt,
      instruction:
        '工作流已创建并落库，编辑器已切换到新图。后续修改请先 workflow_get_graph，再用 workflow_patch 提交（携带读取时返回的 baseVersion）。',
    }
  },
}

const patchTool: WorkflowToolDescriptor = {
  name: 'workflow_patch',
  description:
    '提交对当前工作流的修改：携带 workflow_get_graph 返回的 baseVersion 与修改后的全量 graph。baseVersion 与库内不一致时拒绝（期间图被修改过），此时必须重新读图再改，不要凭记忆重试。',
  paramsSchema: {
    type: 'object',
    required: ['baseVersion', 'graph'],
    additionalProperties: false,
    properties: {
      baseVersion: { type: 'string', description: 'workflow_get_graph 返回的 baseVersion' },
      name: { type: 'string', description: '可选：同时更新工作流名称' },
      graph: { type: 'object', description: '修改后的完整工作流图（全量，不是增量）' },
    },
  },
  handler: async (ctx, rawInput) => {
    const input = requireObject(rawInput)
    const baseVersion = requireString(input, 'baseVersion')
    const graph = requireGraph(input)
    const state = ctx.getEditorState()
    if (!state) throw new Error('工作流编辑器尚未就绪，无法提交修改。')
    if (state.workflowId == null) {
      throw new Error('当前编辑器尚未绑定已保存的工作流，请先用 workflow_generate 创建。')
    }
    const latest = await ctx.getWorkflowUpdatedAt(state.workflowId)
    if (latest == null) {
      return {
        updated: false,
        reason: 'workflow_not_found',
        instruction: '绑定的下游工作流已不存在（可能被删除）。请用 workflow_generate 重新创建。',
      }
    }
    if (latest !== baseVersion) {
      return {
        updated: false,
        reason: 'graph_changed_since_read',
        currentBaseVersion: latest,
        instruction:
          '工作流在你读取后被修改过（用户手动编辑或其他来源）。请重新 workflow_get_graph 获取最新图与 baseVersion，基于最新状态修改后再提交；不要凭记忆覆盖。',
      }
    }
    const updated = await ctx.updateWorkflow({
      id: state.workflowId,
      ...(typeof input.name === 'string' && input.name.trim() ? { name: input.name } : {}),
      graph,
    })
    return {
      updated: true,
      workflowId: state.workflowId,
      baseVersion: updated.updatedAt,
      instruction: '修改已落库。后续修改请重新 workflow_get_graph 获取新 baseVersion。',
    }
  },
}

export const WORKFLOW_AGENT_TOOLS: ReadonlyArray<WorkflowToolDescriptor> = [
  getGraphTool,
  validateTool,
  generateTool,
  patchTool,
]

const WORKFLOW_TOOL_INDEX = new Map(WORKFLOW_AGENT_TOOLS.map((tool) => [tool.name, tool]))

/** 只读工具白名单：只读编辑器状态、不落库，可安全并行执行（对称 canvas-tool-host） */
export const READONLY_WORKFLOW_TOOL_NAMES = new Set<string>([
  'workflow_get_graph',
  'workflow_validate',
])

/** 渲染端工具 schema 导出：透传给主进程 spark_workflow MCP server（E2-1 桥） */
export function getWorkflowToolSchemas(): {
  name: string
  description: string
  inputSchema: JSONSchema
}[] {
  return WORKFLOW_AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.paramsSchema,
  }))
}

/** 渲染进程统一入口：执行某个工作流工具 */
export async function executeWorkflowTool(
  ctx: WorkflowToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = WORKFLOW_TOOL_INDEX.get(name)
  if (!tool) throw new Error(`未知工作流工具: ${name}`)
  return await tool.handler(ctx, (input ?? {}) as object)
}

import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowPackage,
  CanvasWorkflowRun,
} from '@spark/protocol'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { extractCanvasWorkflowDraft } from './canvasWorkflowExtraction'
import type {
  CanvasToolContext,
  CanvasToolDescriptor,
  CanvasWorkspaceActions,
} from './canvas.tools'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'

type JSONSchema = Record<string, unknown>
type WorkflowToolInput = Record<string, unknown>

type WorkflowExecutionAction = NonNullable<CanvasWorkspaceActions['runCanvasWorkflow']>

const workflowIdSchema: JSONSchema = {
  type: 'string',
  description: '画布工作流 id，不是应用工作台 workflow id',
}

const packageSchema: JSONSchema = {
  type: 'object',
  description: 'CanvasWorkflowPackage，必须是无限画布节点图格式',
  additionalProperties: true,
}

const valueMapSchema: JSONSchema = {
  type: 'object',
  description: '工作流输入或暴露参数的键值对象',
  additionalProperties: true,
}

function inputRecord(input: unknown): WorkflowToolInput {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('工作流工具参数必须是对象')
  }
  return input as WorkflowToolInput
}

function requiredString(input: WorkflowToolInput, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`缺少工作流参数：${key}`)
  }
  return value.trim()
}

function optionalString(input: WorkflowToolInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function optionalRecord(input: WorkflowToolInput, key: string): Record<string, unknown> {
  const value = input[key]
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`工作流参数 ${key} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function optionalNumber(input: WorkflowToolInput, key: string): number | undefined {
  const value = input[key]
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`工作流参数 ${key} 必须是有限数字`)
  }
  return value
}

function confirmed(input: WorkflowToolInput): boolean {
  return input.confirmed === true
}

function confirmation(
  action: string,
  message: string,
  details: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    requiresConfirmation: true,
    action,
    message,
    confirmationInstruction: '请先向用户展示这项操作并等待明确确认，再将 confirmed=true 重试。',
    ...details,
  }
}

function activeBoardId(snapshot: CanvasSnapshot): string {
  return snapshot.activeBoardId ?? snapshot.board.id
}

function defaultPlacement(snapshot: CanvasSnapshot): { x: number; y: number } {
  const nodes = snapshot.nodes.filter(
    (node) => node.boardId === activeBoardId(snapshot) && !node.hidden,
  )
  if (nodes.length === 0) return { x: 80, y: 80 }
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const y = Math.round(nodes.reduce((total, node) => total + node.y, 0) / nodes.length)
  return { x: right + 40, y }
}

function summarizeWorkflow(workflow: CanvasWorkflowDefinition) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    scope: workflow.scope,
    projectId: workflow.projectId,
    status: workflow.status,
    version: workflow.version,
    tags: workflow.tags,
    nodeCount: workflow.package.graph.nodes.length,
    edgeCount: workflow.package.graph.edges.length,
    inputCount: workflow.package.contract.inputs.length,
    outputCount: workflow.package.contract.outputs.length,
    exposedParamCount: workflow.package.contract.exposedParams.length,
    updatedAt: workflow.updatedAt,
  }
}

function summarizeRun(run: CanvasWorkflowRun) {
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    projectId: run.projectId,
    status: run.status,
    outputs: run.outputs,
    error: run.error,
    stepCount: run.steps.length,
    completedSteps: run.steps.filter((step) => step.status === 'completed').length,
    updatedAt: run.updatedAt,
  }
}

async function getWorkflowForCanvas(
  ctx: CanvasToolContext,
  workflowId: string,
): Promise<CanvasWorkflowDefinition> {
  const workflow = await canvasWorkflowApi.get(workflowId)
  if (!workflow) throw new Error(`找不到画布工作流：${workflowId}`)
  if (workflow.scope === 'project' && workflow.projectId !== ctx.projectId) {
    throw new Error('该项目级画布工作流不属于当前画布项目')
  }
  return workflow
}

async function listVisibleWorkflows(
  ctx: CanvasToolContext,
  input: WorkflowToolInput,
): Promise<CanvasWorkflowDefinition[]> {
  const scope = optionalString(input, 'scope') as 'project' | 'library' | 'builtin' | undefined
  const query = optionalString(input, 'query')
  const requestedLimit = optionalNumber(input, 'limit')
  const limit =
    requestedLimit == null ? 40 : Math.max(1, Math.min(200, Math.round(requestedLimit)))
  const common = {
    ...(query ? { query } : {}),
    limit,
    offset: 0,
  }
  const requests =
    scope === 'project'
      ? [canvasWorkflowApi.list({ ...common, scope: 'project', projectId: ctx.projectId })]
      : scope === 'library' || scope === 'builtin'
        ? [canvasWorkflowApi.list({ ...common, scope })]
        : [
            canvasWorkflowApi.list({ ...common, scope: 'project', projectId: ctx.projectId }),
            canvasWorkflowApi.list({ ...common, scope: 'library' }),
            canvasWorkflowApi.list({ ...common, scope: 'builtin' }),
          ]
  const pages = await Promise.all(requests)
  const byId = new Map<string, CanvasWorkflowDefinition>()
  for (const page of pages) {
    for (const workflow of page) byId.set(workflow.id, workflow)
  }
  return [...byId.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

function ensureRunBelongsToCanvas(ctx: CanvasToolContext, run: CanvasWorkflowRun): CanvasWorkflowRun {
  if (run.projectId !== ctx.projectId) {
    throw new Error('该画布工作流运行记录不属于当前画布项目')
  }
  return run
}

async function getRunForCanvas(
  ctx: CanvasToolContext,
  runId: string,
): Promise<CanvasWorkflowRun | null> {
  const run = await canvasWorkflowApi.getRun(runId)
  return run ? ensureRunBelongsToCanvas(ctx, run) : null
}

function requirePackage(input: WorkflowToolInput): CanvasWorkflowPackage {
  const value = input.package
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('缺少有效的 CanvasWorkflowPackage：package')
  }
  return value as CanvasWorkflowPackage
}

function requireNodeIds(input: WorkflowToolInput): string[] {
  const values = input.nodeIds
  if (!Array.isArray(values) || values.length < 2) {
    throw new Error('至少提供 2 个 nodeIds 才能提取画布工作流')
  }
  const ids = values.filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  )
  if (ids.length !== values.length) throw new Error('nodeIds 必须全部是非空字符串')
  return [...new Set(ids)]
}

function findSelectedNodes(snapshot: CanvasSnapshot, nodeIds: string[]): CanvasNode[] {
  const nodes = nodeIds.map((id) => snapshot.nodes.find((node) => node.id === id))
  if (nodes.some((node) => node == null)) throw new Error('选区包含不存在的画布节点')
  return nodes as CanvasNode[]
}

function runAction(workspace: CanvasWorkspaceActions): WorkflowExecutionAction {
  if (!workspace.runCanvasWorkflow) throw new Error('当前画布 Agent 尚未连接工作流运行器')
  return workspace.runCanvasWorkflow
}

const tools: CanvasToolDescriptor[] = [
  {
    name: 'canvas_workflow_list',
    description:
      '列出无限画布工作流（项目、个人库和内置模板）。这是 CanvasWorkflow 工具，不是应用工作台 Workflow。',
    paramsSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['project', 'library', 'builtin'] },
        query: { type: 'string', description: '名称、描述或标签搜索词' },
        limit: { type: 'integer', description: '返回数量，默认 40' },
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflows = await listVisibleWorkflows(ctx, input)
      return {
        projectId: ctx.projectId,
        workflows: workflows.map(summarizeWorkflow),
        total: workflows.length,
      }
    },
  },
  {
    name: 'canvas_workflow_get',
    description: '读取一个无限画布工作流的完整定义、节点图、输入契约和暴露参数。',
    paramsSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: { workflowId: workflowIdSchema },
    },
    handler: async (ctx, rawInput) => {
      const workflow = await getWorkflowForCanvas(
        ctx,
        requiredString(inputRecord(rawInput), 'workflowId'),
      )
      return { workflow: summarizeWorkflow(workflow), package: workflow.package }
    },
  },
  {
    name: 'canvas_workflow_create',
    description: '创建一个无限画布工作流定义。scope=project 时只能创建到当前画布项目。',
    paramsSchema: {
      type: 'object',
      required: ['name', 'scope', 'package'],
      properties: {
        name: { type: 'string', description: '工作流名称' },
        description: { type: 'string' },
        scope: { type: 'string', enum: ['project', 'library'] },
        tags: { type: 'array', items: { type: 'string' } },
        package: packageSchema,
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const name = requiredString(input, 'name')
      const scope = requiredString(input, 'scope') as 'project' | 'library'
      if (scope !== 'project' && scope !== 'library') throw new Error('scope 只能是 project 或 library')
      const tags = Array.isArray(input.tags)
        ? input.tags.filter(
            (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0,
          )
        : []
      const description = optionalString(input, 'description')
      const created = await canvasWorkflowApi.create({
        name,
        scope,
        ...(description ? { description } : {}),
        ...(scope === 'project' ? { projectId: ctx.projectId } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        package: requirePackage(input),
      })
      return { workflow: summarizeWorkflow(created) }
    },
  },
  {
    name: 'canvas_workflow_update',
    description: '更新无限画布工作流的名称、描述、标签、状态或完整节点图 package。',
    paramsSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: workflowIdSchema,
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        tags: { type: 'array', items: { type: 'string' } },
        package: packageSchema,
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflowId = requiredString(input, 'workflowId')
      await getWorkflowForCanvas(ctx, workflowId)
      const name = optionalString(input, 'name')
      const description =
        input.description !== undefined ? optionalString(input, 'description') ?? null : undefined
      const status = optionalString(input, 'status') as
        | 'draft'
        | 'published'
        | 'archived'
        | undefined
      const updated = await canvasWorkflowApi.update({
        id: workflowId,
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status ? { status } : {}),
        ...(Array.isArray(input.tags) ? { tags: input.tags.filter((tag): tag is string => typeof tag === 'string') } : {}),
        ...(input.package !== undefined ? { package: requirePackage(input) } : {}),
      })
      return { workflow: summarizeWorkflow(updated) }
    },
  },
  {
    name: 'canvas_workflow_extract_selection',
    description:
      '把当前画布的一组节点和内部连线提取为可复用的无限画布工作流，并保存到当前项目。AI 可先根据返回草案优化名称和描述，再用 update 工具修改。',
    paramsSchema: {
      type: 'object',
      required: ['nodeIds'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: '框选节点 id，至少 2 个' },
        name: { type: 'string', description: '可选的工作流名称' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const snapshot = ctx.getSnapshot()
      if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试')
      const nodeIds = requireNodeIds(input)
      const draft = extractCanvasWorkflowDraft({
        projectId: ctx.projectId,
        boardId: activeBoardId(snapshot),
        selectedNodes: findSelectedNodes(snapshot, nodeIds),
        allNodes: snapshot.nodes,
        allEdges: snapshot.edges,
      })
      const created = await canvasWorkflowApi.create({
        name: optionalString(input, 'name') ?? draft.name,
        description: optionalString(input, 'description') ?? draft.description,
        scope: 'project',
        projectId: ctx.projectId,
        tags: Array.isArray(input.tags)
          ? input.tags.filter(
              (tag): tag is string => typeof tag === 'string' && tag.trim().length > 0,
            )
          : draft.tags,
        package: draft.package,
      })
      return { workflow: summarizeWorkflow(created), package: created.package }
    },
  },
  {
    name: 'canvas_workflow_delete',
    description: '删除一个无限画布工作流。内置模板不可删除，执行前必须取得用户明确确认。',
    paramsSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: { workflowId: workflowIdSchema, confirmed: { type: 'boolean' } },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflow = await getWorkflowForCanvas(ctx, requiredString(input, 'workflowId'))
      if (workflow.scope === 'builtin') throw new Error('内置画布工作流不可删除')
      if (!confirmed(input)) {
        return confirmation('delete_workflow', `删除画布工作流“${workflow.name}”？此操作不可撤销。`, {
          workflow: summarizeWorkflow(workflow),
        })
      }
      const deleted = await canvasWorkflowApi.delete(workflow.id)
      return { deleted, workflowId: workflow.id }
    },
  },
  {
    name: 'canvas_workflow_apply',
    description:
      '把无限画布工作流展开为当前画布中的真实普通节点和连线。展开后与工作流定义完全脱离，可自由编辑；执行前必须确认。',
    paramsSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: workflowIdSchema,
        x: { type: 'number', description: '画布坐标 x，省略时放在空白区域' },
        y: { type: 'number', description: '画布坐标 y，省略时放在空白区域' },
        confirmed: { type: 'boolean' },
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflow = await getWorkflowForCanvas(ctx, requiredString(input, 'workflowId'))
      const snapshot = ctx.getSnapshot()
      if (!snapshot) throw new Error('画布尚未加载完成，请稍后重试')
      const position = {
        x: optionalNumber(input, 'x') ?? defaultPlacement(snapshot).x,
        y: optionalNumber(input, 'y') ?? defaultPlacement(snapshot).y,
      }
      if (!confirmed(input)) {
        return confirmation('apply_workflow', `将“${workflow.name}”展开到当前画布。`, {
          workflow: summarizeWorkflow(workflow),
          placement: position,
          independence: '展开后生成普通节点和连线，不保留工作流来源、版本或 provenance。',
        })
      }
      if (!ctx.workspace.materializeWorkflow) throw new Error('当前画布不支持展开工作流')
      const previousIds = new Set(snapshot.nodes.map((node) => node.id))
      const next = await ctx.workspace.materializeWorkflow({
        boardId: activeBoardId(snapshot),
        originX: position.x,
        originY: position.y,
        workflowPackage: workflow.package,
      })
      return {
        applied: true,
        workflowId: workflow.id,
        nodeIds: next.nodes.filter((node) => !previousIds.has(node.id)).map((node) => node.id),
        edgeCount: next.edges.length - snapshot.edges.length,
      }
    },
  },
  {
    name: 'canvas_workflow_run',
    description:
      '按无限画布工作流的 DAG 流程运行，使用自定义 inputs 和 exposedParams，并把产物写回当前画布项目。执行前必须确认。',
    paramsSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: workflowIdSchema,
        workflowVersion: { type: 'integer' },
        inputs: valueMapSchema,
        exposedParams: valueMapSchema,
        idempotencyKey: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflow = await getWorkflowForCanvas(ctx, requiredString(input, 'workflowId'))
      const inputs = optionalRecord(input, 'inputs')
      const exposedParams = optionalRecord(input, 'exposedParams')
      if (!confirmed(input)) {
        return confirmation('run_workflow', `按流程运行画布工作流“${workflow.name}”。`, {
          workflow: summarizeWorkflow(workflow),
          inputs,
          exposedParams,
          outputCount: workflow.package.contract.outputs.length,
        })
      }
      const created = await canvasWorkflowApi.createRun({
        workflowId: workflow.id,
        projectId: ctx.projectId,
        inputs,
        exposedParams,
        ...(typeof input.workflowVersion === 'number' ? { workflowVersion: input.workflowVersion } : {}),
        idempotencyKey:
          optionalString(input, 'idempotencyKey') ??
          `canvas-agent-${workflow.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      const finalRun = await runAction(ctx.workspace)({
        workflow,
        run: created.run,
        plan: created.plan,
        signal: new AbortController().signal,
      })
      return { run: summarizeRun(finalRun) }
    },
  },
  {
    name: 'canvas_workflow_run_list',
    description: '列出当前画布项目的无限画布工作流运行记录，可按工作流或状态筛选。',
    paramsSchema: {
      type: 'object',
      properties: {
        workflowId: workflowIdSchema,
        status: {
          type: 'string',
          enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'],
        },
        limit: { type: 'integer', description: '返回数量，默认 20' },
      },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const workflowId = optionalString(input, 'workflowId')
      const status = optionalString(input, 'status') as
        | 'queued'
        | 'running'
        | 'paused'
        | 'completed'
        | 'failed'
        | 'cancelled'
        | undefined
      const limit = optionalNumber(input, 'limit')
      const runs = await canvasWorkflowApi.listRuns({
        projectId: ctx.projectId,
        ...(workflowId ? { workflowId } : {}),
        ...(status ? { status } : {}),
        ...(limit ? { limit: Math.max(1, Math.min(200, Math.round(limit))) } : {}),
        offset: 0,
      })
      return { projectId: ctx.projectId, runs: runs.map(summarizeRun), total: runs.length }
    },
  },
  {
    name: 'canvas_workflow_run_get',
    description: '查询无限画布工作流运行记录和步骤状态。',
    paramsSchema: {
      type: 'object',
      required: ['runId'],
      properties: { runId: { type: 'string', description: 'canvas_workflow_run id' } },
    },
    handler: async (ctx, rawInput) => {
      const run = await getRunForCanvas(ctx, requiredString(inputRecord(rawInput), 'runId'))
      return { run: run ? summarizeRun(run) : null }
    },
  },
  {
    name: 'canvas_workflow_run_cancel',
    description: '取消一个正在运行的无限画布工作流。',
    paramsSchema: {
      type: 'object',
      required: ['runId'],
      properties: { runId: { type: 'string' } },
    },
    handler: async (ctx, rawInput) => {
      const runId = requiredString(inputRecord(rawInput), 'runId')
      const existing = await getRunForCanvas(ctx, runId)
      if (!existing) throw new Error(`找不到画布工作流运行记录：${runId}`)
      const run = await canvasWorkflowApi.cancelRun(runId)
      return { run: summarizeRun(run) }
    },
  },
  {
    name: 'canvas_workflow_run_retry',
    description: '重试一个失败的无限画布工作流步骤。',
    paramsSchema: {
      type: 'object',
      required: ['runId', 'nodeId'],
      properties: { runId: { type: 'string' }, nodeId: { type: 'string' } },
    },
    handler: async (ctx, rawInput) => {
      const input = inputRecord(rawInput)
      const runId = requiredString(input, 'runId')
      const existing = await getRunForCanvas(ctx, runId)
      if (!existing) throw new Error(`找不到画布工作流运行记录：${runId}`)
      const run = await canvasWorkflowApi.retryRunStep(
        runId,
        requiredString(input, 'nodeId'),
      )
      return { run: summarizeRun(run) }
    },
  },
  {
    name: 'canvas_workflow_run_resume',
    description: '恢复一个可恢复的无限画布工作流运行，并继续执行剩余 DAG 步骤。',
    paramsSchema: {
      type: 'object',
      required: ['runId'],
      properties: { runId: { type: 'string' } },
    },
    handler: async (ctx, rawInput) => {
      const runId = requiredString(inputRecord(rawInput), 'runId')
      const existing = await getRunForCanvas(ctx, runId)
      if (!existing) throw new Error(`找不到画布工作流运行记录：${runId}`)
      const resumed = await canvasWorkflowApi.resumeRun(runId)
      ensureRunBelongsToCanvas(ctx, resumed.run)
      const workflow = await getWorkflowForCanvas(ctx, resumed.run.workflowId)
      const finalRun = await runAction(ctx.workspace)({
        workflow,
        run: resumed.run,
        plan: resumed.plan,
        signal: new AbortController().signal,
      })
      return { run: summarizeRun(finalRun) }
    },
  },
]

export const CANVAS_WORKFLOW_TOOLS: ReadonlyArray<CanvasToolDescriptor> = tools

export type CanvasWorkflowToolSchema = {
  name: string
  description: string
  inputSchema: JSONSchema
}

export function getCanvasWorkflowToolSchemas(): CanvasWorkflowToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.paramsSchema,
  }))
}

export async function executeCanvasWorkflowTool(
  ctx: CanvasToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = tools.find((item) => item.name === name)
  if (!tool) throw new Error(`未知画布工作流工具：${name}`)
  return tool.handler(ctx, input)
}

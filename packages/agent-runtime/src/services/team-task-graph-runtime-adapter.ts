import { z } from 'zod'
import { TaskGraphService } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { TaskAcceptanceStatus, TaskNodeStatus } from '@spark/protocol'
import type { TeamToolDefinition, TeamToolHandlerResult } from './team-mcp-http-bridge.js'

const ID = z.string().trim().min(1).max(160)
const TITLE = z.string().trim().min(1).max(500)
const DESCRIPTION = z.string().max(2_000).optional()
const VERSION = z.number().int().positive()
const JSON_VALUE = z.unknown().superRefine((value, context) => {
  const issue = inspectTaskGraphJson(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})
const OP_ID = ID.optional()

const createNodeInput = z.object({
  id: ID, title: TITLE, description: DESCRIPTION, assigneeId: ID.optional(), inputs: JSON_VALUE.optional(),
  maxRetries: z.number().int().min(0).max(10).optional(), opId: OP_ID,
}).strict()
const addEdgeInput = z.object({ id: ID, fromNodeId: ID, toNodeId: ID, type: z.enum(['dependency', 'parallel']).optional(), opId: OP_ID }).strict()
const transitionInput = z.object({ id: ID, expectedVersion: VERSION, outputs: JSON_VALUE.optional(), acceptanceStatus: z.enum(['pending', 'accepted', 'rejected']).optional(), opId: OP_ID }).strict()
const retryInput = z.object({ id: ID, expectedVersion: VERSION, opId: OP_ID }).strict()
const reassignInput = z.object({ id: ID, expectedVersion: VERSION, assigneeId: ID.nullable(), opId: OP_ID }).strict()

export interface TeamTaskGraphRuntimeContext {
  /** Trusted host-bound session identity. Tool arguments cannot override it. */
  sessionId: string
  /** Trusted host-bound discussion identity. Tool arguments cannot override it. */
  discussionId: string
  actorId: string
  capability: 'agent' | 'system' | 'user'
}

/** Runtime/MCP boundary for discussion-scoped task DAGs. */
export class TeamTaskGraphRuntimeAdapter {
  private readonly service: TaskGraphService

  constructor(db: SparkDatabase, private readonly context: TeamTaskGraphRuntimeContext) {
    const scope = {
      sessionId: context.sessionId,
      roomId: `team-room:${context.sessionId}`,
      discussionId: context.discussionId,
      actorId: context.actorId,
    }
    this.service = context.capability === 'agent'
      ? TaskGraphService.forAgent(db, scope)
      : context.capability === 'user' ? TaskGraphService.forUser(db, scope) : TaskGraphService.forSystem(db, scope)
  }

  buildToolDefinitions(): TeamToolDefinition[] {
    const read: TeamToolDefinition = {
      name: 'team_task_graph_read',
      description: 'Read the task DAG for the current team discussion.',
      schema: {},
      handler: async (args) => this.read(args),
    }
    const createNode: TeamToolDefinition = {
      name: 'team_task_graph_create_node',
      description: 'Create a ready task node in the current discussion task DAG.',
      schema: createNodeInput.shape,
      handler: async (args) => this.mutate(args, createNodeInput, (input) => this.service.createNode({
        id: input.id,
        title: input.title,
        opId: operationId(this.context.actorId, input.opId),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.inputs !== undefined ? { inputs: input.inputs } : {}),
        ...(input.maxRetries !== undefined ? { maxRetries: input.maxRetries } : {}),
      })),
    }
    const addEdge: TeamToolDefinition = {
      name: 'team_task_graph_add_edge',
      description: 'Add a dependency or parallel edge between current discussion task nodes.',
      schema: addEdgeInput.shape,
      handler: async (args) => this.mutate(args, addEdgeInput, (input) => this.service.createEdge({
        id: input.id,
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        ...(input.type !== undefined ? { type: input.type } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const transition = (status: Extract<TaskNodeStatus, 'running' | 'completed' | 'failed'>, name: string, description: string): TeamToolDefinition => ({
      name,
      description,
      schema: transitionInput.shape,
      handler: async (args) => this.mutate(args, transitionInput, (input) => this.service.transition({
        id: input.id,
        expectedVersion: input.expectedVersion,
        status,
        ...(input.outputs !== undefined ? { outputs: input.outputs } : {}),
        ...(input.acceptanceStatus !== undefined ? { acceptanceStatus: input.acceptanceStatus as TaskAcceptanceStatus } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    })
    const retry: TeamToolDefinition = {
      name: 'team_task_graph_retry',
      description: 'Retry a failed task node when its retry quota permits.',
      schema: retryInput.shape,
      handler: async (args) => this.mutate(args, retryInput, (input) => this.service.retry({
        ...input,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const reassign: TeamToolDefinition = {
      name: 'team_task_graph_reassign',
      description: 'Reassign a task node. This governance operation requires user or system capability.',
      schema: reassignInput.shape,
      handler: async (args) => this.mutate(args, reassignInput, (input) => this.service.reassign({
        ...input,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const definitions = [
      read,
      createNode,
      addEdge,
      transition('running', 'team_task_graph_start', 'Start a ready task node.'),
      transition('completed', 'team_task_graph_complete', 'Complete a running task node with optional outputs.'),
      transition('failed', 'team_task_graph_fail', 'Mark a running task node as failed with optional outputs.'),
      retry,
      reassign,
    ]
    return this.context.capability === 'agent' ? definitions.filter((definition) => definition !== reassign) : definitions
  }

  private async read(args: Record<string, unknown>): Promise<TeamToolHandlerResult> {
    if (Object.keys(args).length !== 0) return this.error('Task graph read does not accept scope or other arguments.')
    return this.result(this.service.snapshot())
  }

  private async mutate<T extends z.ZodTypeAny>(args: Record<string, unknown>, schema: T, build: (input: z.infer<T>) => unknown): Promise<TeamToolHandlerResult> {
    const parsed = schema.safeParse(args)
    if (!parsed.success) return this.error(formatIssues(parsed.error))
    try {
      return this.result(build(parsed.data))
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error))
    }
  }

  private result(value: unknown): TeamToolHandlerResult {
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> }
  }

  private error(message: string): TeamToolHandlerResult {
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

function operationId(actorId: string, opId: string | undefined): string { return opId ?? `${actorId}:${crypto.randomUUID()}` }
function formatIssues(error: z.ZodError): string { return error.issues.map((issue) => issue.message).join('; ') }

function inspectTaskGraphJson(value: unknown): string | undefined {
  const seen = new Set<object>()
  let count = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (typeof current === 'string') { bytes += current.length + 2; return }
    if (current === null || typeof current === 'boolean' || (typeof current === 'number' && Number.isFinite(current))) { bytes += 8; return }
    if (typeof current !== 'object') throw new Error('Task graph JSON must contain JSON values')
    if (seen.has(current)) throw new Error('Task graph JSON must not contain cycles')
    if (depth >= 10) throw new Error('Task graph JSON exceeds maximum nesting depth')
    seen.add(current)
    count += 1
    if (count > 200) throw new Error('Task graph JSON exceeds maximum node count')
    for (const [key, item] of Array.isArray(current) ? current.entries() : Object.entries(current)) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
    }
    seen.delete(current)
  }
  try {
    visit(value, 0)
    return bytes > 16_000 ? 'Task graph JSON exceeds serialized size limit' : undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

import { z } from 'zod'
import { EvidenceCostService } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { TeamToolDefinition, TeamToolHandlerResult } from './team-mcp-http-bridge.js'

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(4_000)
const OP_ID = ID.optional()
const VERSION = z.number().int().nonnegative()
const LINKS = z.array(z.object({
  type: z.enum(['claim', 'task', 'handoff', 'deliberation', 'ledger']),
  id: ID,
}).strict()).max(100)
const SOURCE = z.object({
  type: z.enum(['file', 'test', 'tool', 'url', 'manual']),
  ref: z.string().trim().min(1).max(500),
}).strict()
const evidenceAddInput = z.object({
  id: ID,
  claim: TEXT,
  links: LINKS.optional(),
  source: SOURCE,
  version: z.string().max(160).nullable().optional(),
  summary: TEXT,
  hash: z.string().max(256).nullable().optional(),
  opId: OP_ID,
}).strict()
const evidenceVersionedInput = z.object({ id: ID, expectedVersion: VERSION, opId: OP_ID }).strict()
const evidenceInvalidateInput = evidenceVersionedInput.extend({ reason: TEXT }).strict()
const usageInput = z.object({
  id: ID,
  taskId: ID.nullable().optional(),
  agentId: ID.nullable().optional(),
  dispatchId: ID.nullable().optional(),
  tokens: z.number().int().nonnegative().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().max(16).nullable().optional(),
  latencyMs: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(['estimated', 'recorded', 'failed', 'unknown']),
  source: z.string().trim().max(500).nullable().optional(),
  opId: OP_ID,
}).strict()
const budgetInput = z.object({
  expectedVersion: VERSION,
  tokens: z.number().int().nonnegative().nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().max(16).nullable().optional(),
  opId: OP_ID,
}).strict()

export interface TeamEvidenceCostRuntimeContext {
  /** Trusted host-bound session identity. Tool arguments cannot override it. */
  sessionId: string
  /** Trusted host-bound discussion identity. Tool arguments cannot override it. */
  discussionId: string
  actorId: string
  capability: 'agent' | 'system' | 'user'
}

/** Runtime/MCP boundary for discussion-scoped evidence and usage accounting. */
export class TeamEvidenceCostRuntimeAdapter {
  private readonly service: EvidenceCostService

  constructor(db: SparkDatabase, private readonly context: TeamEvidenceCostRuntimeContext) {
    const scope = {
      sessionId: context.sessionId,
      roomId: `team-room:${context.sessionId}`,
      discussionId: context.discussionId,
      actorId: context.actorId,
    }
    this.service = context.capability === 'agent'
      ? EvidenceCostService.forAgent(db, scope)
      : context.capability === 'user'
        ? EvidenceCostService.forUser(db, scope)
        : EvidenceCostService.forSystem(db, scope)
  }

  buildToolDefinitions(): TeamToolDefinition[] {
    const read: TeamToolDefinition = {
      name: 'team_evidence_cost_read',
      description: 'Read evidence, usage events, aggregates, and budget for the current team discussion.',
      schema: {},
      handler: async (args) => this.read(args),
    }
    const addEvidence: TeamToolDefinition = {
      name: 'team_evidence_add',
      description: 'Add bounded, unverified evidence to the current team discussion.',
      schema: evidenceAddInput.shape,
      handler: async (args) => this.mutate(args, evidenceAddInput, (input) => this.service.addEvidence({
        id: input.id,
        claim: input.claim,
        links: input.links ?? [],
        source: input.source,
        ...(input.version !== undefined ? { version: input.version } : {}),
        summary: input.summary,
        ...(input.hash !== undefined ? { hash: input.hash } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const recordUsage: TeamToolDefinition = {
      name: 'team_cost_record_usage',
      description: 'Record actual usage. Unknown values remain unknown and are never estimated here.',
      schema: usageInput.shape,
      handler: async (args) => this.mutate(args, usageInput, (input) => this.service.recordUsage({
        id: input.id,
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.dispatchId !== undefined ? { dispatchId: input.dispatchId } : {}),
        ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.latencyMs !== undefined ? { latencyMs: input.latencyMs } : {}),
        status: input.status,
        ...(input.source !== undefined ? { source: input.source } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const verify: TeamToolDefinition = {
      name: 'team_evidence_verify',
      description: 'Verify evidence; requires user or system governance capability.',
      schema: evidenceVersionedInput.shape,
      handler: async (args) => this.mutate(args, evidenceVersionedInput, (input) => this.service.verifyEvidence({
        ...input,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const invalidate: TeamToolDefinition = {
      name: 'team_evidence_invalidate',
      description: 'Invalidate evidence with an audit reason; requires governance capability.',
      schema: evidenceInvalidateInput.shape,
      handler: async (args) => this.mutate(args, evidenceInvalidateInput, (input) => this.service.invalidateEvidence({
        ...input,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const setBudget: TeamToolDefinition = {
      name: 'team_cost_set_budget',
      description: 'Set the discussion budget with an optimistic-concurrency version.',
      schema: budgetInput.shape,
      handler: async (args) => this.mutate(args, budgetInput, (input) => this.service.setBudget({
        expectedVersion: input.expectedVersion,
        ...(input.tokens !== undefined ? { tokens: input.tokens } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const definitions = [read, addEvidence, recordUsage, verify, invalidate, setBudget]
    return this.context.capability === 'agent' ? definitions.slice(0, 3) : definitions
  }

  private async read(args: Record<string, unknown>): Promise<TeamToolHandlerResult> {
    if (Object.keys(args).length !== 0) return this.error('Evidence/cost read does not accept scope or other arguments.')
    const budget = this.service.budget()
    return this.result({
      evidence: this.service.listEvidence(100),
      costs: this.service.listCosts(100),
      aggregates: this.service.aggregate(),
      budget: budget == null ? null : { tokens: budget.tokens, amount: budget.amount, currency: budget.currency, version: budget.version },
    })
  }

  private async mutate<T extends z.ZodTypeAny>(args: Record<string, unknown>, schema: T, build: (input: z.infer<T>) => unknown): Promise<TeamToolHandlerResult> {
    const parsed = schema.safeParse(args)
    if (!parsed.success) return this.error(formatIssues(parsed.error))
    try { return this.result(build(parsed.data)) } catch (error) { return this.error(error instanceof Error ? error.message : String(error)) }
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

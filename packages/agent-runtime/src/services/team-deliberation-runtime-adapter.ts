import { z } from 'zod'
import {
  DeliberationService,
  type DeliberationLedgerWriter,
  type DeliberationRecord,
} from '../../../storage/src/deliberation.service.js'
import type { SparkDatabase } from '@spark/storage'
import type { DeliberationProposal } from '@spark/protocol'
import type { TeamToolDefinition, TeamToolHandlerResult } from './team-mcp-http-bridge.js'

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(4_000)
const VERSION = z.number().int().positive()
const OP_ID = ID.optional()
const PROPOSAL = z.object({
  claim: TEXT,
  position: z.enum(['support', 'oppose', 'conditional']),
  rationale: TEXT,
}).strict()
const EVIDENCE = z.object({
  summary: TEXT,
  sourceRef: ID,
  polarity: z.enum(['supports', 'challenges', 'neutral']),
}).strict()
const ALTERNATIVE = z.object({ title: TEXT, summary: TEXT, tradeoffs: z.array(TEXT).max(8) }).strict()
const RISK = z.object({ title: TEXT, severity: z.enum(['low', 'medium', 'high', 'critical']), mitigation: TEXT }).strict()
const LEDGER_VALUE = z.custom<unknown>((value) => inspectJson(value) == null, {
  message: 'Deliberation JSON must contain valid JSON values',
}).superRefine((value, context) => {
  const issue = inspectJson(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})

const createInput = z.object({ id: ID, topic: TEXT, proposal: PROPOSAL, opId: OP_ID }).strict()
const versionedInput = z.object({ id: ID, expectedVersion: VERSION, opId: OP_ID }).strict()
const evidenceInput = versionedInput.extend({ evidence: EVIDENCE })
const alternativeInput = versionedInput.extend({ alternative: ALTERNATIVE })
const riskInput = versionedInput.extend({ risk: RISK })
const voteInput = versionedInput.extend({
  vote: z.enum(['support', 'oppose', 'conditional']),
  reason: TEXT,
  sourceRef: ID.optional(),
})
const decideInput = versionedInput.extend({
  decision: z.object({
    outcome: z.enum(['approved', 'rejected', 'conditional']),
    reason: TEXT,
    ledgerWrite: z.object({ logicalKey: ID, value: LEDGER_VALUE, reason: TEXT }).nullable(),
  }).strict(),
})
const resolveInput = versionedInput.extend({ conflictingRecordId: ID, reason: TEXT })

export interface TeamDeliberationRuntimeContext {
  /** Trusted host-bound session identity. Tool arguments cannot override it. */
  sessionId: string
  /** Trusted host-bound discussion identity. Tool arguments cannot override it. */
  discussionId: string
  actorId: string
  capability: 'agent' | 'system' | 'user'
  /** Optional Ledger integration; decision writes are never accepted from tool scope. */
  ledgerWriter?: DeliberationLedgerWriter
}

/** Runtime/MCP boundary for discussion-scoped deliberations. */
export class TeamDeliberationRuntimeAdapter {
  private readonly service: DeliberationService

  constructor(db: SparkDatabase, private readonly context: TeamDeliberationRuntimeContext) {
    const scope = {
      sessionId: context.sessionId,
      roomId: `team-room:${context.sessionId}`,
      discussionId: context.discussionId,
      actorId: context.actorId,
    }
    const options = context.ledgerWriter == null ? undefined : { ledgerWriter: context.ledgerWriter }
    this.service = context.capability === 'agent'
      ? DeliberationService.forAgent(db, scope, options)
      : context.capability === 'user'
        ? DeliberationService.forUser(db, scope, options)
        : DeliberationService.forSystem(db, scope, options)
  }

  buildToolDefinitions(): TeamToolDefinition[] {
    const read: TeamToolDefinition = {
      name: 'team_deliberation_read',
      description: 'Read deliberations and conflicts for the current team discussion.',
      schema: {},
      handler: async (args) => this.read(args),
    }
    const propose: TeamToolDefinition = {
      name: 'team_deliberation_propose',
      description: 'Create a proposal in the current team discussion.',
      schema: createInput.shape,
      handler: async (args) => this.mutate(args, createInput, (input) => this.service.create({
        ...input, proposal: input.proposal as DeliberationProposal, opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const addEvidence: TeamToolDefinition = {
      name: 'team_deliberation_add_evidence',
      description: 'Attach bounded evidence to a proposed deliberation.',
      schema: evidenceInput.shape,
      handler: async (args) => this.mutate(args, evidenceInput, (input) => this.service.addEvidence({
        id: input.id, expectedVersion: input.expectedVersion, evidence: input.evidence,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const addAlternative: TeamToolDefinition = {
      name: 'team_deliberation_add_alternative',
      description: 'Attach a bounded alternative to a proposed deliberation.',
      schema: alternativeInput.shape,
      handler: async (args) => this.mutate(args, alternativeInput, (input) => this.service.addAlternative({
        id: input.id, expectedVersion: input.expectedVersion, alternative: input.alternative,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const addRisk: TeamToolDefinition = {
      name: 'team_deliberation_add_risk',
      description: 'Attach a bounded risk to a proposed deliberation.',
      schema: riskInput.shape,
      handler: async (args) => this.mutate(args, riskInput, (input) => this.service.addRisk({
        id: input.id, expectedVersion: input.expectedVersion, risk: input.risk,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const vote: TeamToolDefinition = {
      name: 'team_deliberation_vote',
      description: 'Record a vote as auditable evidence on a proposed deliberation.',
      schema: voteInput.shape,
      handler: async (args) => this.mutate(args, voteInput, (input) => this.service.addEvidence({
        id: input.id,
        expectedVersion: input.expectedVersion,
        evidence: {
          summary: `Vote: ${input.vote}; ${input.reason}`,
          sourceRef: input.sourceRef ?? `vote:${this.context.actorId}`,
          polarity: input.vote === 'oppose' ? 'challenges' : input.vote === 'support' ? 'supports' : 'neutral',
        },
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const decide: TeamToolDefinition = {
      name: 'team_deliberation_decide',
      description: 'Resolve a proposal with a user or system governance decision.',
      schema: decideInput.shape,
      handler: async (args) => this.mutate(args, decideInput, (input) => this.service.decide({
        id: input.id, expectedVersion: input.expectedVersion,
        decision: {
          outcome: input.decision.outcome,
          reason: input.decision.reason,
          ledgerWrite: input.decision.ledgerWrite == null ? null : {
            logicalKey: input.decision.ledgerWrite.logicalKey,
            value: input.decision.ledgerWrite.value,
            reason: input.decision.ledgerWrite.reason,
          },
        },
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const resolve: TeamToolDefinition = {
      name: 'team_deliberation_resolve',
      description: 'Resolve a contradictory proposal with a user or system governance ruling.',
      schema: resolveInput.shape,
      handler: async (args) => this.mutate(args, resolveInput, (input) => this.service.resolve({
        id: input.id, expectedVersion: input.expectedVersion, conflictingRecordId: input.conflictingRecordId,
        reason: input.reason, opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const definitions = [read, propose, addEvidence, addAlternative, addRisk, vote, decide, resolve]
    return this.context.capability === 'agent' ? definitions.slice(0, 6) : definitions
  }

  private async read(args: Record<string, unknown>): Promise<TeamToolHandlerResult> {
    if (Object.keys(args).length !== 0) return this.error('Deliberation read does not accept scope or other arguments.')
    return this.result(this.service.snapshot())
  }

  private async mutate<T extends z.ZodTypeAny>(args: Record<string, unknown>, schema: T, build: (input: z.infer<T>) => DeliberationRecord): Promise<TeamToolHandlerResult> {
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

function inspectJson(value: unknown): string | undefined {
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current == null) { bytes += 4; return }
    if (typeof current === 'string') { bytes += current.length + 2; return }
    if (typeof current === 'boolean') { bytes += current ? 4 : 5; return }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('Deliberation JSON must contain finite numbers')
      bytes += String(current).length
      return
    }
    if (typeof current !== 'object') throw new Error('Deliberation JSON must contain JSON values')
    if (seen.has(current)) throw new Error('Deliberation JSON must not contain cycles')
    if (depth >= 8) throw new Error('Deliberation JSON exceeds maximum depth')
    seen.add(current)
    if (++nodes > 160) throw new Error('Deliberation JSON exceeds maximum node count')
    for (const [key, item] of Array.isArray(current) ? current.entries() : Object.entries(current)) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
    }
    seen.delete(current)
  }
  try {
    visit(value, 0)
    return bytes > 12_000 ? 'Deliberation JSON exceeds serialized byte limit' : undefined
  } catch (error) { return error instanceof Error ? error.message : String(error) }
}

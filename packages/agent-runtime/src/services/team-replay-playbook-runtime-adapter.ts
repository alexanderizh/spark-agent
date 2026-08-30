import { z } from 'zod'
import { ReplayPlaybookService } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { TeamToolDefinition, TeamToolHandlerResult } from './team-mcp-http-bridge.js'

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(2_000)
const OP_ID = ID.optional()
const LIMIT = z.number().int().min(1).max(100).optional()
const VERSION = z.number().int().positive()
const CURSOR = z.string().regex(/^\d+$/).optional()
const JSON_VALUE = z.unknown().superRefine((value, context) => {
  const issue = inspectReplayJson(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})

const timelineInput = z.object({ cursor: CURSOR, limit: LIMIT, opId: OP_ID }).strict()
const diffInput = z.object({ fromSeq: z.number().int().positive(), toSeq: z.number().int().positive(), limit: LIMIT, opId: OP_ID }).strict()
const forkInput = z.object({
  branchId: ID,
  sourceSeq: z.number().int().nonnegative(),
  reason: TEXT,
  expectedVersion: VERSION.optional(),
  opId: OP_ID,
}).strict()
const playbookListInput = z.object({ id: ID, limit: LIMIT }).strict()
const playbookProposeInput = z.object({
  id: ID,
  name: TEXT,
  graph: JSON_VALUE,
  roles: JSON_VALUE,
  handoffRules: JSON_VALUE,
  gateRules: JSON_VALUE,
  deliberationRules: JSON_VALUE,
  expectedVersion: VERSION.optional(),
  opId: OP_ID,
}).strict()
const playbookVersionInput = z.object({ id: ID, expectedVersion: VERSION, opId: OP_ID }).strict()
const playbookApplyInput = playbookVersionInput.extend({ targetDiscussionId: ID }).strict()

export interface TeamReplayPlaybookRuntimeContext {
  /** Trusted host-bound session identity. Tool arguments cannot override it. */
  sessionId: string
  /** Trusted host-bound discussion identity. Tool arguments cannot override it. */
  discussionId: string
  actorId: string
  capability: 'agent' | 'system' | 'user'
}

/** Runtime/MCP boundary for discussion-scoped replay timelines and playbooks. */
export class TeamReplayPlaybookRuntimeAdapter {
  private readonly service: ReplayPlaybookService

  constructor(db: SparkDatabase, private readonly context: TeamReplayPlaybookRuntimeContext) {
    const scope = {
      sessionId: context.sessionId,
      roomId: `team-room:${context.sessionId}`,
      discussionId: context.discussionId,
      actorId: context.actorId,
    }
    this.service = context.capability === 'agent'
      ? ReplayPlaybookService.forAgent(db, scope)
      : context.capability === 'user'
        ? ReplayPlaybookService.forUser(db, scope)
        : ReplayPlaybookService.forSystem(db, scope)
  }

  buildToolDefinitions(): TeamToolDefinition[] {
    const timeline: TeamToolDefinition = {
      name: 'team_replay_read',
      description: 'Read the append-only replay timeline for the current team discussion.',
      schema: timelineInput.shape,
      handler: async (args) => this.mutate(args, timelineInput, (input) => this.service.timeline({
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      })),
    }
    const diff: TeamToolDefinition = {
      name: 'team_replay_diff',
      description: 'Read a bounded replay diff for the current team discussion.',
      schema: diffInput.shape,
      handler: async (args) => this.mutate(args, diffInput, (input) => this.service.diff({
        fromSeq: input.fromSeq,
        toSeq: input.toSeq,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      })),
    }
    const fork: TeamToolDefinition = {
      name: 'team_replay_fork',
      description: 'Record replay branch lineage for the current discussion without copying or mutating source events.',
      schema: forkInput.shape,
      handler: async (args) => this.mutate(args, forkInput, (input) => this.service.fork({
        branchId: input.branchId,
        sourceSeq: input.sourceSeq,
        reason: input.reason,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const playbookList: TeamToolDefinition = {
      name: 'team_playbook_list',
      description: 'Read the current playbook, bounded versions, and application audit records.',
      schema: playbookListInput.shape,
      handler: async (args) => this.mutate(args, playbookListInput, (input) => ({
        playbook: this.service.current(input.id) ?? null,
        versions: this.service.listVersions(input.id, input.limit),
        applications: this.service.listApplications(input.id, input.limit),
      })),
    }
    const propose: TeamToolDefinition = {
      name: 'team_playbook_propose',
      description: 'Propose a bounded playbook version for the current team discussion.',
      schema: playbookProposeInput.shape,
      handler: async (args) => this.mutate(args, playbookProposeInput, (input) => this.service.propose({
        id: input.id,
        name: input.name,
        graph: input.graph,
        roles: input.roles,
        handoffRules: input.handoffRules,
        gateRules: input.gateRules,
        deliberationRules: input.deliberationRules,
        ...(input.expectedVersion !== undefined ? { expectedVersion: input.expectedVersion } : {}),
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const publish: TeamToolDefinition = {
      name: 'team_playbook_publish',
      description: 'Publish a proposed playbook version; requires user or system governance capability.',
      schema: playbookVersionInput.shape,
      handler: async (args) => this.mutate(args, playbookVersionInput, (input) => this.service.publish({
        id: input.id,
        expectedVersion: input.expectedVersion,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const apply: TeamToolDefinition = {
      name: 'team_playbook_apply',
      description: 'Record a playbook application audit record only; this does not instantiate TaskGraph nodes or events.',
      schema: playbookApplyInput.shape,
      handler: async (args) => this.mutate(args, playbookApplyInput, (input) => this.service.apply({
        id: input.id,
        expectedVersion: input.expectedVersion,
        targetDiscussionId: input.targetDiscussionId,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }
    const archive: TeamToolDefinition = {
      name: 'team_playbook_archive',
      description: 'Archive a playbook version; requires user or system governance capability.',
      schema: playbookVersionInput.shape,
      handler: async (args) => this.mutate(args, playbookVersionInput, (input) => this.service.archive({
        id: input.id,
        expectedVersion: input.expectedVersion,
        opId: operationId(this.context.actorId, input.opId),
      })),
    }

    const definitions = [timeline, diff, fork, playbookList, propose, publish, apply, archive]
    return this.context.capability === 'agent' ? definitions.slice(0, 5) : definitions
  }

  private async mutate<T extends z.ZodTypeAny>(
    args: Record<string, unknown>,
    schema: T,
    build: (input: z.infer<T>) => unknown,
  ): Promise<TeamToolHandlerResult> {
    const parsed = schema.safeParse(args)
    if (!parsed.success) return this.error(formatIssues(parsed.error))
    try {
      return this.result(build(parsed.data))
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error))
    }
  }

  private result(value: unknown): TeamToolHandlerResult {
    return { content: [{ type: 'text', text: stableJson(value) }], structuredContent: value as Record<string, unknown> }
  }

  private error(message: string): TeamToolHandlerResult {
    return { content: [{ type: 'text', text: message }], isError: true }
  }
}

function operationId(actorId: string, opId: string | undefined): string {
  return opId ?? `${actorId}:${crypto.randomUUID()}`
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function inspectReplayJson(value: unknown): string | undefined {
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current == null) { bytes += 4; return }
    if (typeof current === 'string') { bytes += current.length + 2; return }
    if (typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current)) throw new Error('Replay JSON must contain finite numbers')
      bytes += 8
      return
    }
    if (typeof current !== 'object') throw new Error('Replay JSON must contain JSON values')
    if (seen.has(current)) throw new Error('Replay JSON must not contain cycles')
    if (depth >= 8) throw new Error('Replay JSON exceeds maximum nesting depth')
    seen.add(current)
    nodes += 1
    if (nodes > 160) throw new Error('Replay JSON exceeds maximum node count')
    for (const [key, item] of Array.isArray(current) ? current.entries() : Object.entries(current)) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
    }
    seen.delete(current)
  }
  try {
    visit(value, 0)
    return bytes > 12_000 ? 'Replay JSON exceeds serialized size limit' : undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

import { z } from 'zod'
import { inspectTeamP1Json } from '@spark/protocol'
import { SteeringGateService, TeamHandoffService, type SteeringGateRecord, type TeamHandoffRecord } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { TeamToolDefinition, TeamToolHandlerResult } from './team-mcp-http-bridge.js'

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(2_000)
const SENSITIVITY = z.enum(['public', 'internal', 'confidential', 'restricted'])
const IMPACT = z.enum(['low', 'medium', 'high', 'critical'])
const TARGET = z.enum(['ledger', 'record', 'artifact', 'handoff', 'task'])
const P1_JSON = z.unknown().superRefine((value, context) => {
  const issue = inspectTeamP1Json(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})
const scope = { id: ID, expectedVersion: z.number().int().positive().optional() }

export interface TeamP1RuntimeContext {
  sessionId: string
  discussionId: string
  actorId: string
  capability: 'agent' | 'system' | 'user'
}

/** Runtime/MCP boundary for typed handoffs and steering gates. Scope is host-bound. */
export class TeamP1RuntimeAdapter {
  private readonly roomId: string
  private readonly handoffs: TeamHandoffService
  private readonly gates: SteeringGateService

  constructor(db: SparkDatabase, private readonly context: TeamP1RuntimeContext) {
    this.roomId = `team-room:${context.sessionId}`
    const scope = { sessionId: context.sessionId, roomId: this.roomId, discussionId: context.discussionId, actorId: context.actorId }
    this.handoffs = context.capability === 'user'
      ? TeamHandoffService.forUser(db, scope)
      : context.capability === 'system' ? TeamHandoffService.forSystem(db, scope) : TeamHandoffService.forAgent(db, scope)
    this.gates = context.capability === 'user'
      ? SteeringGateService.forUser(db, scope)
      : context.capability === 'system' ? SteeringGateService.forSystem(db, scope) : SteeringGateService.forAgent(db, scope)
  }

  buildToolDefinitions(): TeamToolDefinition[] {
    const read: TeamToolDefinition = {
      name: 'team_p1_read',
      description: 'Read typed handoffs and steering gates for the current team discussion.',
      schema: {},
      handler: async () => this.result({ handoffs: this.handoffs.list(100, 0).items, gates: this.gates.list(100, 0).items }),
    }
    const createHandoff: TeamToolDefinition = {
      name: 'team_handoff_create',
      description: 'Create a typed draft handoff for the current team discussion.',
      schema: { id: ID, opId: ID.optional(), recipientId: ID, purpose: TEXT, inputs: P1_JSON, expectedOutput: TEXT, acceptanceCriteria: z.array(TEXT).max(50), sensitivity: SENSITIVITY, taskId: ID.optional(), dispatchId: ID.optional(), deadline: z.string().max(80).optional(), attachments: z.array(z.string().max(500)).max(20).optional() },
      handler: async (args) => this.run(() => {
        const input = z.object({ id: ID, opId: ID.optional(), recipientId: ID, purpose: TEXT, inputs: P1_JSON, expectedOutput: TEXT, acceptanceCriteria: z.array(TEXT).max(50), sensitivity: SENSITIVITY, taskId: ID.optional(), dispatchId: ID.optional(), deadline: z.string().max(80).optional(), attachments: z.array(z.string().max(500)).max(20).optional() }).safeParse({ ...args, opId: typeof args.opId === 'string' ? args.opId : `${this.context.actorId}:${crypto.randomUUID()}` })
        if (!input.success) throw new Error(input.error.message)
        const opId = input.data.opId ?? `${this.context.actorId}:${crypto.randomUUID()}`
        return this.handoffs.create({
          id: input.data.id, recipientId: input.data.recipientId, purpose: input.data.purpose,
          inputs: input.data.inputs, expectedOutput: input.data.expectedOutput,
          acceptanceCriteria: input.data.acceptanceCriteria, sensitivity: input.data.sensitivity, opId,
          ...(input.data.taskId !== undefined ? { taskId: input.data.taskId } : {}),
          ...(input.data.dispatchId !== undefined ? { dispatchId: input.data.dispatchId } : {}),
          ...(input.data.deadline !== undefined ? { deadline: input.data.deadline } : {}),
          ...(input.data.attachments !== undefined ? { attachments: input.data.attachments } : {}),
        })
      }),
    }
    const createGate: TeamToolDefinition = {
      name: 'team_steering_gate_create',
      description: 'Create a waiting steering gate for a high-impact decision.',
      schema: { id: ID, opId: ID.optional(), targetType: TARGET, targetId: ID, trigger: TEXT, reason: TEXT, impact: IMPACT, budgetSnapshot: P1_JSON, recommendedAction: TEXT },
      handler: async (args) => this.run(() => {
        const input = z.object({ id: ID, opId: ID.optional(), targetType: TARGET, targetId: ID, trigger: TEXT, reason: TEXT, impact: IMPACT, budgetSnapshot: P1_JSON, recommendedAction: TEXT }).safeParse({ ...args, opId: typeof args.opId === 'string' ? args.opId : `${this.context.actorId}:${crypto.randomUUID()}` })
        if (!input.success) throw new Error(input.error.message)
        const opId = input.data.opId ?? `${this.context.actorId}:${crypto.randomUUID()}`
        return this.gates.create({
          id: input.data.id, targetType: input.data.targetType, targetId: input.data.targetId,
          trigger: input.data.trigger, reason: input.data.reason, impact: input.data.impact,
          budgetSnapshot: input.data.budgetSnapshot ?? null, recommendedAction: input.data.recommendedAction, opId,
        })
      }),
    }
    const handoffTransition = (action: 'submit' | 'accept' | 'requestClarification' | 'reject' | 'complete' | 'cancel'): TeamToolDefinition => ({
      name: `team_handoff_${action === 'requestClarification' ? 'request_clarification' : action}`,
      description: `Transition a handoff to ${action}.`,
      schema: { ...scope, opId: ID.optional() },
      handler: async (args) => this.run(() => {
        const input = z.object(scope).extend({ opId: ID.optional() }).safeParse({ ...args, opId: typeof args.opId === 'string' ? args.opId : `${this.context.actorId}:${crypto.randomUUID()}` })
        if (!input.success) throw new Error(input.error.message)
        return this.handoffs[action](input.data as never)
      }),
    })
    const gateDecision = (action: 'approve' | 'revise' | 'stop' | 'expire'): TeamToolDefinition => ({
      name: `team_steering_gate_${action}`,
      description: `Apply the ${action} decision to a steering gate.`,
      schema: { ...scope, opId: ID.optional(), reason: z.string().max(1000).optional() },
      handler: async (args) => this.run(() => {
        const input = z.object(scope).extend({ reason: z.string().max(1000).optional(), opId: ID.optional() }).safeParse({ ...args, opId: typeof args.opId === 'string' ? args.opId : `${this.context.actorId}:${crypto.randomUUID()}` })
        if (!input.success) throw new Error(input.error.message)
        return this.gates[action](input.data as never)
      }),
    })
    const definitions = [read, createHandoff, createGate, handoffTransition('submit'), handoffTransition('accept'), handoffTransition('requestClarification'), handoffTransition('reject'), handoffTransition('complete'), handoffTransition('cancel'), gateDecision('approve'), gateDecision('revise'), gateDecision('stop'), gateDecision('expire')]
    return this.context.capability === 'agent' ? [read, createHandoff, createGate] : definitions
  }

  private async run(build: () => TeamHandoffRecord | SteeringGateRecord): Promise<TeamToolHandlerResult> {
    try { return this.result(build()) } catch (error) { return this.error(error instanceof Error ? error.message : String(error)) }
  }
  private result(value: unknown): TeamToolHandlerResult { return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> } }
  private error(message: string): TeamToolHandlerResult { return { content: [{ type: 'text', text: message }], isError: true } }
}

import { z } from 'zod'
import type { SessionId } from './events/index.js'

export type TeamHandoffStatus = 'draft' | 'submitted' | 'accepted' | 'needs_clarification' | 'rejected' | 'completed' | 'canceled'
export type TeamHandoffSensitivity = 'public' | 'internal' | 'confidential' | 'restricted'
export type SteeringGateStatus = 'waiting' | 'approved' | 'revise' | 'stopped' | 'expired'
export type SteeringGateImpact = 'low' | 'medium' | 'high' | 'critical'

export interface TeamP1Handoff {
  id: string; taskId: string | null; dispatchId: string | null; senderId: string; recipientId: string
  purpose: string; inputs: unknown; attachments: string[]; expectedOutput: string; acceptanceCriteria: string[]
  deadline: string | null; sensitivity: TeamHandoffSensitivity; status: TeamHandoffStatus
  artifactRefs: string[]; evidenceRefs: string[]; version: number; createdAt: string; updatedAt: string
}
export interface TeamP1Gate {
  id: string; targetType: 'ledger' | 'record' | 'artifact' | 'handoff' | 'task'; targetId: string
  trigger: string; reason: string; impact: SteeringGateImpact; budgetSnapshot: unknown; recommendedAction: string
  status: SteeringGateStatus; capability: 'agent' | 'system' | 'user'; version: number; createdAt: string; updatedAt: string
}
export interface TeamP1Snapshot {
  sessionId: SessionId
  discussionId: string | null
  handoffs: TeamP1Handoff[]
  gates: TeamP1Gate[]
  syncedAt: string
}
export interface TeamP1GetRequest { sessionId: SessionId }
export type TeamP1OperationId = string
export type TeamP1HandoffAction = 'submit' | 'accept' | 'request_clarification' | 'reject' | 'complete' | 'cancel'
export type TeamP1GateAction = 'approve' | 'revise' | 'stop' | 'expire'
export type TeamP1Mutation =
  | { sessionId: SessionId; expectedDiscussionId: string; opId: TeamP1OperationId; kind: 'handoff'; action: 'create'; id: string; recipientId: string; purpose: string; inputs: unknown; expectedOutput: string; acceptanceCriteria: string[]; sensitivity: TeamHandoffSensitivity; taskId?: string; dispatchId?: string; deadline?: string; attachments?: string[] }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: TeamP1OperationId; kind: 'handoff'; action: TeamP1HandoffAction; id: string; expectedVersion: number; artifactRefs?: string[]; evidenceRefs?: string[] }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: TeamP1OperationId; kind: 'gate'; action: 'create'; id: string; targetType: TeamP1Gate['targetType']; targetId: string; trigger: string; reason: string; impact: SteeringGateImpact; budgetSnapshot: unknown; recommendedAction: string }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: TeamP1OperationId; kind: 'gate'; action: TeamP1GateAction; id: string; expectedVersion: number; reason?: string }
export interface TeamP1MutateResponse { snapshot: TeamP1Snapshot }
export interface TeamP1IpcChannelMap {
  'team-p1:get': [TeamP1GetRequest, TeamP1Snapshot]
  'team-p1:mutate': [TeamP1Mutation, TeamP1MutateResponse]
}

const session = z.string().uuid()
const scope = { sessionId: session, expectedDiscussionId: z.string().min(1).max(160) }
const transition = { id: z.string().min(1).max(160), expectedVersion: z.number().int().positive() }
const operationId = z.string().trim().min(1).max(160)
const handoffBase = { ...scope, opId: operationId, kind: z.literal('handoff'), id: z.string().min(1).max(160) }
const gateBase = { ...scope, opId: operationId, kind: z.literal('gate'), id: z.string().min(1).max(160) }
const sensitivity = z.enum(['public', 'internal', 'confidential', 'restricted'])
const impact = z.enum(['low', 'medium', 'high', 'critical'])
const targetType = z.enum(['ledger', 'record', 'artifact', 'handoff', 'task'])

export const TEAM_P1_JSON_MAX_DEPTH = 10
export const TEAM_P1_JSON_MAX_NODES = 200
export const TEAM_P1_JSON_MAX_BYTES = 16_000

/** Validate untrusted P1 payloads without serializing an attacker-controlled object. */
export function inspectTeamP1Json(value: unknown): string | undefined {
  const sizeIssue = (size: number): string | undefined => size > TEAM_P1_JSON_MAX_BYTES
    ? 'P1 JSON exceeds the serialized size limit'
    : undefined
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): string | undefined => {
    if (current === null) { bytes += 4; return sizeIssue(bytes) }
    if (typeof current === 'string') { bytes += current.length + 2; return sizeIssue(bytes) }
    if (typeof current === 'boolean') { bytes += current ? 4 : 5; return sizeIssue(bytes) }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'P1 JSON must contain only finite JSON values'
      bytes += String(current).length
      return sizeIssue(bytes)
    }
    if (typeof current !== 'object') return 'P1 JSON must contain only JSON values'
    if (seen.has(current)) return 'P1 JSON must not contain cycles'
    if (depth >= TEAM_P1_JSON_MAX_DEPTH) return 'P1 JSON exceeds the maximum nesting depth'
    seen.add(current)
    nodes += 1
    if (nodes > TEAM_P1_JSON_MAX_NODES) return 'P1 JSON exceeds the maximum node count'
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current)
    for (const [key, item] of entries) {
      bytes += String(key).length + 3
      const issue = visit(item, depth + 1)
      if (issue != null) return issue
    }
    seen.delete(current)
    return sizeIssue(bytes)
  }
  return visit(value, 0)
}

const p1Json = z.unknown().superRefine((value, context) => {
  const issue = inspectTeamP1Json(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})
export const TeamP1IpcSchemaRegistry = {
  'team-p1:get': z.object({ sessionId: session }).strict(),
  'team-p1:mutate': z.union([
    z.discriminatedUnion('action', [
      z.object({ ...handoffBase, action: z.literal('create'), recipientId: z.string().min(1).max(160), purpose: z.string().min(1).max(1000), inputs: p1Json, expectedOutput: z.string().min(1).max(2000), acceptanceCriteria: z.array(z.string().min(1).max(500)).max(50), sensitivity, taskId: z.string().max(160).optional(), dispatchId: z.string().max(160).optional(), deadline: z.string().max(80).optional(), attachments: z.array(z.string().max(500)).max(20).optional() }).strict(),
      z.object({ ...handoffBase, action: z.enum(['submit', 'accept', 'request_clarification', 'reject', 'complete', 'cancel']), ...transition, artifactRefs: z.array(z.string().max(500)).max(20).optional(), evidenceRefs: z.array(z.string().max(500)).max(20).optional() }).strict(),
    ]),
    z.discriminatedUnion('action', [
      z.object({ ...gateBase, action: z.literal('create'), targetType, targetId: z.string().min(1).max(160), trigger: z.string().min(1).max(300), reason: z.string().min(1).max(1000), impact, budgetSnapshot: p1Json, recommendedAction: z.string().min(1).max(1000) }).strict(),
      z.object({ ...gateBase, action: z.enum(['approve', 'revise', 'stop', 'expire']), ...transition, reason: z.string().max(1000).optional() }).strict(),
    ]),
  ]),
} as const

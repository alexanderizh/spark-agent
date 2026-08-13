import { z } from 'zod'

export type DeliberationCapability = 'agent' | 'system' | 'user'
export type DeliberationProposalPosition = 'support' | 'oppose' | 'conditional'
export type DeliberationDecisionOutcome = 'approved' | 'rejected' | 'conditional'
export type DeliberationStatus = 'proposed' | 'decided' | 'conflicted' | 'superseded'
export type DeliberationOperation =
  | 'create'
  | 'evidence'
  | 'alternative'
  | 'risk'
  | 'decide'
  | 'resolve'
  | 'owner'

export interface DeliberationEvidence {
  id: string
  summary: string
  sourceRef: string
  polarity: 'supports' | 'challenges' | 'neutral'
}

export interface DeliberationAlternative {
  id: string
  title: string
  summary: string
  tradeoffs: string[]
}

export interface DeliberationRisk {
  id: string
  title: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  mitigation: string
}

export interface DeliberationProposal {
  claim: string
  position: DeliberationProposalPosition
  rationale: string
}

export interface DeliberationDecision {
  outcome: DeliberationDecisionOutcome
  reason: string
  resolverId: string
  resolvedAt: string
  ledgerWrite: DeliberationLedgerWrite | null
}

/** Contract only: the storage/runtime layer may hand this to the Ledger adapter. */
export interface DeliberationLedgerWrite {
  logicalKey: string
  value: unknown
  reason: string
}

export interface DeliberationConflict {
  id: string
  topic: string
  recordIds: string[]
  reason: string
  resolvedBy: string | null
  resolvedAt: string | null
}

export interface DeliberationRecord {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  topic: string
  proposal: DeliberationProposal
  evidence: DeliberationEvidence[]
  alternatives: DeliberationAlternative[]
  risks: DeliberationRisk[]
  decision: DeliberationDecision | null
  ownerId: string | null
  deadline: string | null
  status: DeliberationStatus
  capability: DeliberationCapability
  conflict: DeliberationConflict | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface DeliberationAuditEvent {
  id: string
  deliberationId: string
  operation: DeliberationOperation
  actorId: string
  capability: DeliberationCapability
  request: Record<string, unknown>
  record: DeliberationRecord
  createdAt: string
}

export interface DeliberationSnapshot {
  sessionId: string
  discussionId: string
  records: DeliberationRecord[]
  conflicts: DeliberationConflict[]
  syncedAt: string
}

export type DeliberationMutationAction =
  | 'create'
  | 'evidence'
  | 'alternative'
  | 'risk'
  | 'decide'
  | 'resolve'
  | 'owner'
  | 'vote'

export interface DeliberationGetRequest { sessionId: string }
export interface DeliberationMutateRequest {
  sessionId: string
  expectedDiscussionId: string
  expectedRecordId?: string
  expectedVersion?: number
  action: DeliberationMutationAction
  opId: string
  id: string
  topic?: string
  proposal?: DeliberationProposal
  evidence?: Omit<DeliberationEvidence, 'id'>
  alternative?: Omit<DeliberationAlternative, 'id'>
  risk?: Omit<DeliberationRisk, 'id'>
  decision?: Omit<DeliberationDecision, 'resolverId' | 'resolvedAt'>
  conflictingRecordId?: string
  ownerId?: string | null
  deadline?: string | null
  reason?: string
  vote?: { position: DeliberationProposalPosition; reason: string; sourceRef?: string }
}

export interface DeliberationMutateResponse {
  record: DeliberationRecord
  snapshot: DeliberationSnapshot
}

export interface DeliberationIpcChannelMap {
  'deliberation:get': [DeliberationGetRequest, DeliberationSnapshot | null]
  'deliberation:mutate': [DeliberationMutateRequest, DeliberationMutateResponse]
}

const id = z.string().trim().min(1).max(160)
const text = z.string().trim().min(1).max(4_000)
const boundedJson = z.unknown().superRefine((value, context) => {
  try { assertDeliberationJson(value) } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Invalid JSON' })
  }
})

export const DeliberationProposalSchema = z.object({
  claim: text,
  position: z.enum(['support', 'oppose', 'conditional']),
  rationale: text,
}).strict()

export const DeliberationEvidenceSchema = z.object({
  summary: text,
  sourceRef: id,
  polarity: z.enum(['supports', 'challenges', 'neutral']),
}).strict()

export const DeliberationAlternativeSchema = z.object({
  title: text,
  summary: text,
  tradeoffs: z.array(text).max(8),
}).strict()

export const DeliberationRiskSchema = z.object({
  title: text,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  mitigation: text,
}).strict()

const mutationBase = z.object({
  sessionId: z.string().uuid(),
  expectedDiscussionId: id,
  id,
  expectedRecordId: id.optional(),
  expectedVersion: z.number().int().positive().optional(),
  opId: id,
}).strict()

export const DeliberationIpcSchemaRegistry = {
  'deliberation:get': z.object({ sessionId: z.string().uuid() }).strict(),
  'deliberation:mutate': z.discriminatedUnion('action', [
    mutationBase.extend({ action: z.literal('create'), topic: text, proposal: DeliberationProposalSchema, ownerId: id.optional(), deadline: z.string().datetime().nullable().optional() }),
    mutationBase.extend({ action: z.literal('evidence'), evidence: DeliberationEvidenceSchema }),
    mutationBase.extend({ action: z.literal('alternative'), alternative: DeliberationAlternativeSchema }),
    mutationBase.extend({ action: z.literal('risk'), risk: DeliberationRiskSchema }),
    mutationBase.extend({
      action: z.literal('decide'),
      decision: z.object({ outcome: z.enum(['approved', 'rejected', 'conditional']), reason: text, ledgerWrite: z.object({ logicalKey: id, value: boundedJson, reason: text }).nullable() }).strict(),
    }),
    mutationBase.extend({ action: z.literal('resolve'), conflictingRecordId: id, reason: text }),
    mutationBase.extend({ action: z.literal('owner'), ownerId: id.nullable(), deadline: z.string().datetime().nullable() }),
    mutationBase.extend({ action: z.literal('vote'), vote: z.object({ position: z.enum(['support', 'oppose', 'conditional']), reason: text, sourceRef: id.optional() }).strict() }),
  ]),
} as const

export function assertDeliberationJson(value: unknown): void {
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
    nodes += 1
    if (nodes > 160) throw new Error('Deliberation JSON exceeds maximum node count')
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current)
    for (const [key, item] of entries) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
      if (bytes > 12_000) throw new Error('Deliberation JSON exceeds serialized byte limit')
    }
    seen.delete(current)
  }
  visit(value, 0)
  if (bytes > 12_000) throw new Error('Deliberation JSON exceeds serialized byte limit')
}

import { z } from 'zod'

export type EvidenceSourceType = 'file' | 'test' | 'tool' | 'url' | 'manual'
export type EvidenceStatus = 'verified' | 'invalid' | 'unknown'
export type EvidenceLinkType = 'claim' | 'task' | 'handoff' | 'deliberation' | 'ledger'
export type CostStatus = 'estimated' | 'recorded' | 'failed' | 'unknown'
export type CostDimension = 'room' | 'task' | 'agent' | 'dispatch'

export interface EvidenceRecord {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  claim: string
  links: Array<{ type: EvidenceLinkType; id: string }>
  source: { type: EvidenceSourceType; ref: string }
  version: string | null
  summary: string
  hash: string | null
  status: EvidenceStatus
  verifiedBy: string | null
  verifiedAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  versionNumber: number
}

export interface CostEvent {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  taskId: string | null
  agentId: string | null
  dispatchId: string | null
  tokens: number | null
  amount: number | null
  currency: string | null
  latencyMs: number | null
  status: CostStatus
  source: string | null
  createdAt: string
}

export interface CostAggregate {
  dimension: CostDimension
  key: string
  tokens: number | null
  amount: number | null
  latencyMs: number | null
  eventCount: number
  unknown: boolean
}

export interface EvidenceCostSnapshot {
  sessionId: string
  roomId: string
  discussionId: string | null
  evidence: EvidenceRecord[]
  costs: CostEvent[]
  aggregates: CostAggregate[]
  budgetTokens: number | null
  budgetAmount: number | null
  budgetCurrency: string | null
  syncedAt: string
}

export type EvidenceCostMutationRequest =
  | (z.infer<typeof EvidenceCostIpcSchemaRegistry['evidence-cost:evidence:add']>)
  | (z.infer<typeof EvidenceCostIpcSchemaRegistry['evidence-cost:evidence:verify']>)
  | (z.infer<typeof EvidenceCostIpcSchemaRegistry['evidence-cost:evidence:invalidate']>)
  | (z.infer<typeof EvidenceCostIpcSchemaRegistry['evidence-cost:usage:record']>)
  | (z.infer<typeof EvidenceCostIpcSchemaRegistry['evidence-cost:budget:set']>)

export interface EvidenceCostIpcChannelMap {
  'evidence-cost:get': [{ sessionId: string; expectedDiscussionId: string }, EvidenceCostSnapshot]
  'evidence-cost:mutate': [EvidenceCostMutationRequest, EvidenceCostSnapshot]
}

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(4_000)
const boundedList = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(100)
export const EvidenceCostIpcSchemaRegistry = {
  'evidence-cost:get': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID }).strict(),
  'evidence-cost:evidence:add': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID, opId: ID, id: ID, claim: TEXT, links: boundedList(z.object({ type: z.enum(['claim', 'task', 'handoff', 'deliberation', 'ledger']), id: ID }).strict()), source: z.object({ type: z.enum(['file', 'test', 'tool', 'url', 'manual']), ref: z.string().trim().min(1).max(500) }).strict(), version: z.string().max(160).nullable().optional(), summary: TEXT, hash: z.string().max(256).nullable().optional() }).strict(),
  'evidence-cost:evidence:verify': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID, opId: ID, id: ID, expectedVersion: z.number().int().positive() }).strict(),
  'evidence-cost:evidence:invalidate': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID, opId: ID, id: ID, expectedVersion: z.number().int().positive(), reason: TEXT }).strict(),
  'evidence-cost:usage:record': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID, opId: ID, id: ID, taskId: ID.nullable().optional(), agentId: ID.nullable().optional(), dispatchId: ID.nullable().optional(), tokens: z.number().int().nonnegative().nullable().optional(), amount: z.number().nonnegative().nullable().optional(), currency: z.string().trim().max(16).nullable().optional(), latencyMs: z.number().int().nonnegative().nullable().optional(), status: z.enum(['estimated', 'recorded', 'failed', 'unknown']), source: z.string().trim().max(500).nullable().optional() }).strict(),
  'evidence-cost:budget:set': z.object({ sessionId: z.string().uuid(), expectedDiscussionId: ID, opId: ID, expectedVersion: z.number().int().positive(), tokens: z.number().int().nonnegative().nullable().optional(), amount: z.number().nonnegative().nullable().optional(), currency: z.string().trim().max(16).nullable().optional() }).strict(),
} as const

export function aggregateCost(events: CostEvent[]): CostAggregate[] {
  const dimensions: Array<[CostDimension, (event: CostEvent) => string | null]> = [
    ['room', (event) => event.roomId], ['task', (event) => event.taskId], ['agent', (event) => event.agentId], ['dispatch', (event) => event.dispatchId],
  ]
  return dimensions.flatMap(([dimension, keyOf]) => {
    const groups = new Map<string, CostEvent[]>()
    for (const event of events) { const key = keyOf(event); if (key != null) groups.set(key, [...(groups.get(key) ?? []), event]) }
    return [...groups].map(([key, group]) => ({ dimension, key, tokens: group.some((e) => e.tokens == null) ? null : group.reduce((sum, e) => sum + (e.tokens ?? 0), 0), amount: group.some((e) => e.amount == null) ? null : group.reduce((sum, e) => sum + (e.amount ?? 0), 0), latencyMs: group.some((e) => e.latencyMs == null) ? null : group.reduce((sum, e) => sum + (e.latencyMs ?? 0), 0), eventCount: group.length, unknown: group.some((e) => e.status === 'unknown' || e.tokens == null || e.amount == null) }))
  })
}

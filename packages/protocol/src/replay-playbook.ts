import { z } from 'zod'

export const REPLAY_SCHEMA_VERSION = 1
export const REPLAY_MAX_LIST = 100

export type ReplaySourceType = 'task' | 'handoff' | 'deliberation' | 'ledger' | 'tool' | 'manual'
export type ReplayStatus = 'available' | 'partial' | 'empty' | 'conflict'
export type PlaybookStatus = 'proposed' | 'published' | 'archived'
export type ReplayCapability = 'agent' | 'system' | 'user'

export interface ReplayEvent {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  sourceType: ReplaySourceType
  sourceId: string
  seq: number
  time: string
  actor: string
  action: string
  before: unknown
  after: unknown
  evidenceRefs: string[]
}

export interface ReplayTimeline {
  sessionId: string
  discussionId: string
  events: ReplayEvent[]
  cursor: string | null
  nextCursor: string | null
  status: ReplayStatus
  syncedAt: string
}

export interface ReplayDiff {
  sessionId: string
  discussionId: string
  fromSeq: number
  toSeq: number
  events: ReplayEvent[]
  status: ReplayStatus
}

export interface ReplayBranch {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  sourceDiscussionId: string
  sourceSeq: number
  reason: string
  createdBy: string
  createdAt: string
}

export interface TeamPlaybook {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  version: number
  status: PlaybookStatus
  name: string
  graph: unknown
  roles: unknown
  handoffRules: unknown
  gateRules: unknown
  deliberationRules: unknown
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface ReplayTimelineRequest {
  schemaVersion: number
  sessionId: string
  expectedDiscussionId: string
  cursor?: string | undefined
  limit?: number | undefined
  opId: string
}
export interface ReplayDiffRequest {
  schemaVersion: number
  sessionId: string
  expectedDiscussionId: string
  fromSeq: number
  toSeq: number
  limit?: number | undefined
  opId: string
}
export interface ReplayForkRequest {
  schemaVersion: number
  sessionId: string
  expectedDiscussionId: string
  opId: string
  branchId: string
  sourceSeq: number
  reason: string
  expectedVersion?: number | undefined
}
export interface ReplayAppendRequest {
  schemaVersion: number
  sessionId: string
  expectedDiscussionId: string
  opId: string
  sourceType: ReplaySourceType
  sourceId: string
  action: string
  before?: unknown
  after?: unknown
  evidenceRefs?: string[]
  expectedSeq?: number
  time?: string
}
export interface PlaybookMutationRequest {
  schemaVersion: number
  sessionId: string
  expectedDiscussionId: string
  opId: string
  action: 'propose' | 'publish' | 'apply'
  id: string
  expectedVersion?: number
  name?: string
  graph?: unknown
  roles?: unknown
  handoffRules?: unknown
  gateRules?: unknown
  deliberationRules?: unknown
  targetDiscussionId?: string
}
export interface ReplayTimelineResponse {
  timeline: ReplayTimeline
}
export interface ReplayForkResponse {
  branch: ReplayBranch
  timeline: ReplayTimeline
}
export interface PlaybookMutationResponse {
  playbook: TeamPlaybook
  appliedDiscussionId?: string
}
export interface ReplayPlaybookListRequest {
  sessionId: string
  expectedDiscussionId: string
  id: string
  limit?: number
}
export interface ReplayPlaybookListResponse {
  playbook: TeamPlaybook | null
  versions: TeamPlaybook[]
  applications: unknown[]
}

const id = z.string().trim().min(1).max(160)
const text = z.string().trim().min(1).max(2_000)
const bounded = z.unknown().superRefine((value, context) => {
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current == null) {
      bytes += 4
      return
    }
    if (typeof current === 'string') {
      bytes += current.length + 2
      return
    }
    if (typeof current === 'boolean' || typeof current === 'number') {
      if (typeof current === 'number' && !Number.isFinite(current))
        throw new Error('Replay JSON must contain finite numbers')
      bytes += 8
      return
    }
    if (typeof current !== 'object' || seen.has(current))
      throw new Error('Replay JSON must contain acyclic JSON values')
    if (depth >= 8 || ++nodes > 160) throw new Error('Replay JSON exceeds nesting or node limit')
    seen.add(current)
    for (const [key, item] of Array.isArray(current)
      ? current.entries()
      : Object.entries(current)) {
      bytes += String(key).length + 3
      visit(item, depth + 1)
    }
    seen.delete(current)
  }
  try {
    visit(value, 0)
    if (bytes > 12_000)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Replay JSON exceeds serialized size limit',
      })
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : String(error),
    })
  }
})
const base = {
  schemaVersion: z.literal(REPLAY_SCHEMA_VERSION),
  sessionId: z.string().uuid(),
  expectedDiscussionId: id,
  opId: id,
}
export const ReplayIpcSchemaRegistry = {
  'replay:timeline': z
    .object({
      ...base,
      cursor: z.string().regex(/^\d+$/).optional(),
      limit: z.number().int().min(1).max(REPLAY_MAX_LIST).optional(),
    })
    .strict(),
  'replay:diff': z
    .object({
      ...base,
      fromSeq: z.number().int().min(1),
      toSeq: z.number().int().min(1),
      limit: z.number().int().min(1).max(REPLAY_MAX_LIST).optional(),
    })
    .strict(),
  'replay:append': z
    .object({
      ...base,
      sourceType: z.enum(['task', 'handoff', 'deliberation', 'ledger', 'tool', 'manual']),
      sourceId: id,
      action: text,
      before: bounded.optional(),
      after: bounded.optional(),
      evidenceRefs: z.array(id).max(REPLAY_MAX_LIST).optional(),
      expectedSeq: z.number().int().min(0).optional(),
      time: z.string().datetime().optional(),
    })
    .strict(),
  'replay:fork': z
    .object({
      ...base,
      branchId: id,
      sourceSeq: z.number().int().min(0),
      reason: text,
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict(),
  'playbook:mutate': z.discriminatedUnion('action', [
    z
      .object({
        ...base,
        action: z.literal('propose'),
        id,
        name: text,
        graph: bounded,
        roles: bounded,
        handoffRules: bounded,
        gateRules: bounded,
        deliberationRules: bounded,
      })
      .strict(),
    z
      .object({
        ...base,
        action: z.literal('publish'),
        id,
        expectedVersion: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        ...base,
        action: z.literal('apply'),
        id,
        expectedVersion: z.number().int().positive(),
        targetDiscussionId: id,
      })
      .strict(),
  ]),
} as const

export interface ReplayPlaybookIpcChannelMap {
  'replay:timeline': [ReplayTimelineRequest, ReplayTimelineResponse]
  'replay:diff': [ReplayDiffRequest, ReplayDiff]
  'replay:fork': [ReplayForkRequest, ReplayForkResponse]
  'playbook:list': [ReplayPlaybookListRequest, ReplayPlaybookListResponse]
  'playbook:mutate': [PlaybookMutationRequest, PlaybookMutationResponse]
}

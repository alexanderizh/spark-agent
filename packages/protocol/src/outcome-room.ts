import { z } from 'zod'
import type { SessionId } from './events/index.js'

export const LEDGER_JSON_MAX_DEPTH = 10
export const LEDGER_JSON_MAX_NODES = 200
export const LEDGER_JSON_MAX_BYTES = 8_000

/** Validate untrusted ledger JSON without calling JSON.stringify on the full value. */
export function inspectLedgerJson(value: unknown): string | undefined {
  const seen = new Set<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): string | undefined => {
    if (current === null) { bytes += 4; return sizeIssue(bytes) }
    if (typeof current === 'string') { bytes += current.length + 2; return sizeIssue(bytes) }
    if (typeof current === 'boolean') { bytes += current ? 4 : 5; return sizeIssue(bytes) }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return 'Ledger value must contain only finite JSON values'
      bytes += String(current).length
      return sizeIssue(bytes)
    }
    if (typeof current !== 'object') return 'Ledger value must contain only JSON values'
    if (seen.has(current)) return 'Ledger value must not contain cycles'
    if (depth >= LEDGER_JSON_MAX_DEPTH) return 'Ledger value exceeds the maximum nesting depth'
    seen.add(current)
    nodes += 1
    if (nodes > LEDGER_JSON_MAX_NODES) return 'Ledger value exceeds the maximum node count'
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

/** Render legacy/untrusted values within a fixed character budget. */
export function boundedLedgerJson(value: unknown, maxChars = 1_200): string {
  const budget = Math.max(80, Math.min(8_000, Math.trunc(maxChars)))
  const seen = new Set<object>()
  let remaining = budget
  let truncated = false
  const take = (text: string): string => {
    if (remaining <= 0) { truncated = true; return '' }
    if (text.length <= remaining) { remaining -= text.length; return text }
    truncated = true
    const piece = text.slice(0, remaining)
    remaining = 0
    return piece
  }
  const render = (current: unknown, depth: number): string => {
    if (remaining <= 0) { truncated = true; return '' }
    if (current === null) return take('null')
    if (typeof current === 'string') return take(JSON.stringify(current))
    if (typeof current === 'number' || typeof current === 'boolean') return take(String(current))
    if (typeof current !== 'object') return take(JSON.stringify(String(current)))
    if (seen.has(current)) { truncated = true; return take('"[Circular]"') }
    if (depth >= LEDGER_JSON_MAX_DEPTH) { truncated = true; return take('"[MaxDepth]"') }
    seen.add(current)
    const result: string[] = [take(Array.isArray(current) ? '[' : '{')]
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current)
    let count = 0
    for (const [key, item] of entries) {
      if (remaining <= 24 || count >= LEDGER_JSON_MAX_NODES) { truncated = true; break }
      if (count > 0) result.push(take(','))
      if (!Array.isArray(current)) result.push(take(`${JSON.stringify(String(key))}:`))
      result.push(render(item, depth + 1))
      count += 1
    }
    seen.delete(current)
    result.push(take(Array.isArray(current) ? ']' : '}'))
    return result.join('')
  }
  const marker = '\n[ledger truncated]'
  const contentBudget = Math.max(1, budget - marker.length)
  remaining = contentBudget
  const text = render(value, 0)
  return truncated ? `${text.slice(0, contentBudget)}${marker}`.slice(0, budget) : text
}

function sizeIssue(bytes: number): string | undefined {
  return bytes > LEDGER_JSON_MAX_BYTES ? 'Ledger value exceeds the serialized size limit' : undefined
}

export type OutcomeRoomRecordStatus =
  | 'proposed'
  | 'active'
  | 'rejected'
  | 'invalid'
  | 'expired'
  | 'deleted'

export type OutcomeRoomRecordAuthority =
  | 'user-confirmed'
  | 'system-observed'
  | 'agent-inferred'

export interface OutcomeRoomRecord {
  id: string
  logicalKey: string
  value: unknown
  status: OutcomeRoomRecordStatus
  authority: OutcomeRoomRecordAuthority
  confidence: number
  sourceRefs: string[]
  version: number
  updatedBy: string
  updatedAt: string
  expiresAt: string | null
  reason: string | null
}

export interface OutcomeRoomDiscussion {
  id: string
  state: 'active' | 'concluded' | 'canceled'
  topic: string | null
  roundIndex: number
  maxRounds: number
  startedAt: string
  endedAt: string | null
}

export interface OutcomeRoomSnapshot {
  sessionId: SessionId
  discussion: OutcomeRoomDiscussion | null
  records: OutcomeRoomRecord[]
  syncedAt: string
}

export type OutcomeRoomMutationAction =
  | 'confirm'
  | 'reject'
  | 'correct'
  | 'invalidate'
  | 'restore'

export interface OutcomeRoomGetRequest {
  sessionId: SessionId
}

export type OutcomeRoomGetResponse = OutcomeRoomSnapshot

export interface OutcomeRoomMutateRequest {
  sessionId: SessionId
  expectedDiscussionId: string
  expectedRecordId: string
  action: OutcomeRoomMutationAction
  logicalKey: string
  expectedVersion: number
  value?: unknown
  reason?: string
}

export interface OutcomeRoomMutateResponse {
  record: OutcomeRoomRecord
  snapshot: OutcomeRoomSnapshot
}

export interface OutcomeRoomIpcChannelMap {
  'outcome-room:get': [OutcomeRoomGetRequest, OutcomeRoomGetResponse]
  'outcome-room:mutate': [OutcomeRoomMutateRequest, OutcomeRoomMutateResponse]
}

const SessionIdSchema = z.string().uuid()
const LogicalKeySchema = z.string().trim().min(1).max(160)
const LedgerValueSchema = z.unknown().superRefine((value, context) => {
  const issue = inspectLedgerJson(value)
  if (issue != null) context.addIssue({ code: z.ZodIssueCode.custom, message: issue })
})
const MutationBaseSchema = z.object({
  sessionId: SessionIdSchema,
  expectedDiscussionId: z.string().min(1).max(160),
  expectedRecordId: z.string().min(1).max(160),
  logicalKey: LogicalKeySchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000).optional(),
})

export const OutcomeRoomIpcSchemaRegistry = {
  'outcome-room:get': z.object({ sessionId: SessionIdSchema }).strict(),
  'outcome-room:mutate': z.discriminatedUnion('action', [
    MutationBaseSchema.extend({ action: z.literal('confirm') }).strict(),
    MutationBaseSchema.extend({ action: z.literal('reject') }).strict(),
    MutationBaseSchema.extend({
      action: z.literal('correct'),
      value: LedgerValueSchema.refine((value) => value !== undefined, 'Correction value is required'),
    }).strict(),
    MutationBaseSchema.extend({ action: z.literal('invalidate') }).strict(),
    MutationBaseSchema.extend({ action: z.literal('restore') }).strict(),
  ]),
} as const

import { z } from 'zod'
import type { SessionId, TurnId } from './events/index.js'
import type { SessionListResponse } from './ipc/index.js'

export type SessionReferenceStatus = 'active' | 'revoked' | 'unavailable'

export interface SessionReferenceInput {
  sourceSessionId: SessionId
  snapshotSeq?: number
}

export interface SessionLineage {
  childSessionId: SessionId
  parentSessionId: SessionId
  forkAnchorTurnId: TurnId | null
  forkCutoffSeq: number
  sourceTitleSnapshot: string
  childTitle?: string
  createdAt: string
}

export interface SessionReference {
  id: string
  targetSessionId: SessionId
  sourceSessionId: SessionId
  title: string
  sourceTitleSnapshot: string
  projectId: string | null
  snapshotSeq: number
  status: SessionReferenceStatus
  createdAt: string
  updatedAt: string
  turnCount: number
}

export interface SessionReferenceCandidate {
  sessionId: SessionId
  title: string
  projectId: string
  workspaceIds: string[]
  status: string
  archived: boolean
  updatedAt: string
  latestCompletedSeq: number
  latestCompletedTurnId: TurnId | null
  turnCount: number
}

export interface SessionForkRequest {
  sourceSessionId: SessionId
  anchorTurnId?: TurnId
  title?: string
}

export interface SessionForkResponse {
  sessionId: SessionId
  session: SessionListResponse['sessions'][number]
  lineage: SessionLineage
  copiedTurnCount: number
  sourceWasRunning: boolean
}

export interface SessionLineageRequest {
  sessionId: SessionId
}

export interface SessionLineageResponse {
  lineage: SessionLineage | null
  children: SessionLineage[]
}

export interface SessionReferenceCandidatesRequest {
  targetSessionId: SessionId
  workspaceId?: string
  query?: string
  includeArchived?: boolean
  limit?: number
}

export interface SessionReferenceCandidatesResponse {
  candidates: SessionReferenceCandidate[]
}

export interface SessionAttachReferenceRequest {
  targetSessionId: SessionId
  sourceSessionId: SessionId
  snapshotSeq?: number
}

export interface SessionAttachReferenceResponse {
  reference: SessionReference
}

export interface SessionListReferencesRequest {
  targetSessionId: SessionId
}

export interface SessionListReferencesResponse {
  references: SessionReference[]
}

export interface SessionReferenceIdRequest {
  targetSessionId: SessionId
  referenceId: string
}

export interface SessionUpdateReferenceResponse {
  reference: SessionReference
}

export interface SessionReadReferenceRequest {
  targetSessionId: SessionId
  referenceId: string
  cursor?: number
  turnLimit?: number
  detail?: 'transcript' | 'user_visible_activity'
}

export interface ReferencedSessionTurn {
  turnId: TurnId
  userMessage: string
  assistantMessages: string[]
  activities: Array<{
    type: string
    toolName?: string
    status?: string
    summary?: string
  }>
  firstSeq: number
  lastSeq: number
}

export interface SessionReadReferenceResponse {
  reference: SessionReference
  turns: ReferencedSessionTurn[]
  nextCursor: number | null
  hasMore: boolean
}

export interface SessionSearchReferenceRequest {
  targetSessionId: SessionId
  referenceId: string
  query: string
  limit?: number
}

export interface SessionReferenceSearchHit {
  turnId: TurnId
  seq: number
  role: 'user' | 'assistant'
  snippet: string
}

export interface SessionSearchReferenceResponse {
  reference: SessionReference
  hits: SessionReferenceSearchHit[]
}

const sessionId = z.string().uuid()
const turnId = z.string().uuid()
const referenceId = z.string().uuid()

export const CrossSessionCollaborationIpcSchemaRegistry = {
  'session:fork': z
    .object({
      sourceSessionId: sessionId,
      anchorTurnId: turnId.optional(),
      title: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  'session:get-lineage': z.object({ sessionId }).strict(),
  'session:reference-candidates': z
    .object({
      targetSessionId: sessionId,
      workspaceId: z.string().uuid().optional(),
      query: z.string().trim().max(200).optional(),
      includeArchived: z.boolean().optional().default(false),
      limit: z.number().int().min(1).max(50).optional().default(30),
    })
    .strict(),
  'session:attach-reference': z
    .object({
      targetSessionId: sessionId,
      sourceSessionId: sessionId,
      snapshotSeq: z.number().int().min(0).optional(),
    })
    .strict(),
  'session:list-references': z.object({ targetSessionId: sessionId }).strict(),
  'session:update-reference': z.object({ targetSessionId: sessionId, referenceId }).strict(),
  'session:revoke-reference': z.object({ targetSessionId: sessionId, referenceId }).strict(),
  'session:read-reference': z
    .object({
      targetSessionId: sessionId,
      referenceId,
      cursor: z.number().int().min(0).optional(),
      turnLimit: z.number().int().min(1).max(8).optional().default(4),
      detail: z.enum(['transcript', 'user_visible_activity']).optional().default('transcript'),
    })
    .strict(),
  'session:search-reference': z
    .object({
      targetSessionId: sessionId,
      referenceId,
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(20).optional().default(10),
    })
    .strict(),
} as const

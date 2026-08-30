import { z } from 'zod'
import type { SessionId } from './events/index.js'

export type TaskNodeStatus = 'ready' | 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled'
export type TaskEdgeType = 'dependency' | 'parallel'
export type TaskAcceptanceStatus = 'pending' | 'accepted' | 'rejected'
export type TaskCapability = 'agent' | 'system' | 'user'

export interface TaskNode {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  title: string
  description: string
  status: TaskNodeStatus
  assigneeId: string | null
  inputs: unknown
  outputs: unknown
  acceptanceStatus: TaskAcceptanceStatus
  retryCount: number
  maxRetries: number
  version: number
  createdAt: string
  updatedAt: string
}

export interface TaskEdge {
  id: string
  sessionId: string
  roomId: string
  discussionId: string
  fromNodeId: string
  toNodeId: string
  type: TaskEdgeType
  version: number
  createdAt: string
}

export interface TaskGraphSnapshot {
  sessionId: SessionId
  discussionId: string | null
  nodes: TaskNode[]
  edges: TaskEdge[]
  syncedAt: string
}

export interface TaskGraphGetRequest { sessionId: SessionId }
export type TaskGraphGetResponse = TaskGraphSnapshot

export type TaskGraphMutation =
  | { sessionId: SessionId; expectedDiscussionId: string; opId: string; kind: 'node'; action: 'create'; id: string; title: string; description?: string; assigneeId?: string; inputs?: unknown; maxRetries?: number }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: string; kind: 'node'; action: 'transition'; id: string; expectedVersion: number; status: TaskNodeStatus; outputs?: unknown; acceptanceStatus?: TaskAcceptanceStatus }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: string; kind: 'node'; action: 'retry'; id: string; expectedVersion: number }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: string; kind: 'node'; action: 'reassign'; id: string; expectedVersion: number; assigneeId: string | null }
  | { sessionId: SessionId; expectedDiscussionId: string; opId: string; kind: 'edge'; action: 'create'; id: string; fromNodeId: string; toNodeId: string; type?: TaskEdgeType }

export interface TaskGraphMutateResponse { snapshot: TaskGraphSnapshot }
export interface TaskGraphIpcChannelMap {
  'task-graph:get': [TaskGraphGetRequest, TaskGraphGetResponse]
  'task-graph:mutate': [TaskGraphMutation, TaskGraphMutateResponse]
}

const session = z.string().uuid()
const id = z.string().trim().min(1).max(160)
const json = z.unknown().superRefine((value, context) => {
  const seen = new Set<object>(); let nodes = 0; let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (typeof current === 'string') { bytes += current.length + 2; return }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') { bytes += 8; return }
    if (typeof current !== 'object') throw new Error('Task graph JSON must contain JSON values')
    if (seen.has(current)) throw new Error('Task graph JSON must not contain cycles')
    if (depth >= 10) throw new Error('Task graph JSON exceeds maximum nesting depth')
    seen.add(current); nodes += 1
    if (nodes > 200) throw new Error('Task graph JSON exceeds maximum node count')
    for (const [key, item] of (Array.isArray(current) ? current.entries() : Object.entries(current))) { bytes += String(key).length + 3; visit(item, depth + 1) }
    seen.delete(current)
  }
  try { visit(value, 0); if (bytes > 16_000) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Task graph JSON exceeds serialized size limit' }) }
  catch (error) { context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) }) }
})
const scope = { sessionId: session, expectedDiscussionId: id, opId: id }
const nodeBase = { ...scope, kind: z.literal('node'), id }
const edgeBase = { ...scope, kind: z.literal('edge'), id }
export const TaskGraphIpcSchemaRegistry = {
  'task-graph:get': z.object({ sessionId: session }).strict(),
  'task-graph:mutate': z.union([
    z.object({ ...nodeBase, action: z.literal('create'), title: z.string().trim().min(1).max(500), description: z.string().max(2_000).optional(), assigneeId: id.optional(), inputs: json.optional(), maxRetries: z.number().int().min(0).max(10).optional() }).strict(),
    z.object({ ...nodeBase, action: z.literal('transition'), expectedVersion: z.number().int().positive(), status: z.enum(['ready', 'running', 'completed', 'failed', 'blocked', 'cancelled']), outputs: json.optional(), acceptanceStatus: z.enum(['pending', 'accepted', 'rejected']).optional() }).strict(),
    z.object({ ...nodeBase, action: z.literal('retry'), expectedVersion: z.number().int().positive() }).strict(),
    z.object({ ...nodeBase, action: z.literal('reassign'), expectedVersion: z.number().int().positive(), assigneeId: id.nullable() }).strict(),
    z.object({ ...edgeBase, action: z.literal('create'), fromNodeId: id, toNodeId: id, type: z.enum(['dependency', 'parallel']).optional() }).strict(),
  ]),
} as const

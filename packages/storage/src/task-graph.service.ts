import { randomUUID } from 'node:crypto'
import type {
  TaskAcceptanceStatus,
  TaskEdge,
  TaskEdgeType,
  TaskNode,
  TaskNodeStatus,
} from '@spark/protocol'
import type { SparkDatabase } from './database.js'

export type TaskGraphCapability = 'agent' | 'system' | 'user'
export interface TaskGraphScope {
  sessionId: string
  roomId: string
  discussionId: string
  actorId: string
}
export interface TaskGraphEvent {
  id: string
  targetId: string
  operation: string
  actorId: string
  record: TaskNode | TaskEdge
  createdAt: string
}
export class TaskGraphConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TaskGraphConflictError'
  }
}

type NodeRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  title: string
  description: string
  status: TaskNodeStatus
  assignee_id: string | null
  inputs_json: string
  outputs_json: string
  acceptance_status: TaskAcceptanceStatus
  retry_count: number
  max_retries: number
  version: number
  created_at: string
  updated_at: string
}
type EdgeRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  from_node_id: string
  to_node_id: string
  type: TaskEdgeType
  version: number
  created_at: string
}
type StoredEvent = { record: TaskNode | TaskEdge; request: Record<string, unknown> }

const MAX_NODES = 200
const MAX_BYTES = 16_000

export class TaskGraphService {
  private constructor(
    private readonly db: SparkDatabase,
    private readonly scope: TaskGraphScope,
    private readonly capability: TaskGraphCapability,
  ) {}
  static forAgent(db: SparkDatabase, scope: TaskGraphScope): TaskGraphService {
    return new TaskGraphService(db, scope, 'agent')
  }
  static forSystem(db: SparkDatabase, scope: TaskGraphScope): TaskGraphService {
    return new TaskGraphService(db, scope, 'system')
  }
  static forUser(db: SparkDatabase, scope: TaskGraphScope): TaskGraphService {
    return new TaskGraphService(db, scope, 'user')
  }

  createNode(input: {
    id: string
    title: string
    description?: string
    assigneeId?: string
    inputs?: unknown
    maxRetries?: number
    opId: string
  }): TaskNode {
    assertJson(input.inputs)
    return this.mutate(
      'node:create',
      input.opId,
      input.id,
      { ...input, description: input.description ?? '', inputs: input.inputs ?? null },
      () => {
        const count = this.count('task_graph_nodes')
        if (count >= MAX_NODES)
          throw new TaskGraphConflictError(`Task graph node quota exceeded: limit ${MAX_NODES}`)
        const now = new Date().toISOString()
        return {
          id: input.id,
          sessionId: this.scope.sessionId,
          roomId: this.scope.roomId,
          discussionId: this.scope.discussionId,
          title: input.title,
          description: input.description ?? '',
          status: 'ready',
          assigneeId: input.assigneeId ?? null,
          inputs: input.inputs ?? null,
          outputs: null,
          acceptanceStatus: 'pending',
          retryCount: 0,
          maxRetries: input.maxRetries ?? 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
      },
    ) as TaskNode
  }

  createEdge(input: {
    id: string
    fromNodeId: string
    toNodeId: string
    type?: TaskEdgeType
    opId: string
  }): TaskEdgeRecord {
    if (input.fromNodeId === input.toNodeId)
      throw new TaskGraphConflictError('Task graph edges cannot self-reference')
    return this.mutate(
      'edge:create',
      input.opId,
      input.id,
      input,
      () => {
        const from = this.findNode(input.fromNodeId)
        const to = this.findNode(input.toNodeId)
        if (!from || !to)
          throw new TaskGraphConflictError('Task graph edge references a missing node')
        if (this.hasPath(input.toNodeId, input.fromNodeId))
          throw new TaskGraphConflictError('Task graph dependency would create a cycle')
        const now = new Date().toISOString()
        return {
          id: input.id,
          sessionId: this.scope.sessionId,
          roomId: this.scope.roomId,
          discussionId: this.scope.discussionId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          type: input.type ?? 'dependency',
          version: 1,
          createdAt: now,
        }
      },
      true,
    ) as TaskEdgeRecord
  }

  transition(input: {
    id: string
    expectedVersion: number
    status: TaskNodeStatus
    outputs?: unknown
    acceptanceStatus?: TaskAcceptanceStatus
    opId: string
  }): TaskNode {
    assertJson(input.outputs)
    const result = this.mutate('node:transition', input.opId, input.id, input, (current) => {
      const node = current as TaskNode | undefined
      if (!node || node.id !== input.id)
        throw new TaskGraphConflictError('Task graph node not found')
      if (node.version !== input.expectedVersion)
        throw new TaskGraphConflictError(
          `Expected version ${input.expectedVersion}, current version is ${node.version}`,
        )
      if (!allowedTransition(node.status, input.status))
        throw new TaskGraphConflictError(
          `Illegal task transition: ${node.status} -> ${input.status}`,
        )
      return {
        ...node,
        status: input.status,
        outputs: input.outputs ?? node.outputs,
        acceptanceStatus: input.acceptanceStatus ?? node.acceptanceStatus,
        version: node.version + 1,
        updatedAt: new Date().toISOString(),
      }
    }) as TaskNode
    this.recomputeStatuses()
    return result
  }

  retry(input: { id: string; expectedVersion: number; opId: string }): TaskNode {
    return this.mutate('node:retry', input.opId, input.id, input, (current) => {
      const node = current as TaskNode | undefined
      if (!node || node.status !== 'failed')
        throw new TaskGraphConflictError('Only failed task nodes can be retried')
      if (node.version !== input.expectedVersion)
        throw new TaskGraphConflictError(
          `Expected version ${input.expectedVersion}, current version is ${node.version}`,
        )
      if (node.retryCount >= node.maxRetries)
        throw new TaskGraphConflictError('Task retry quota exceeded')
      return {
        ...node,
        status: 'ready',
        retryCount: node.retryCount + 1,
        acceptanceStatus: 'pending',
        version: node.version + 1,
        updatedAt: new Date().toISOString(),
      }
    }) as TaskNode
  }

  reassign(input: {
    id: string
    expectedVersion: number
    assigneeId: string | null
    opId: string
  }): TaskNode {
    if (this.capability === 'agent')
      throw new TaskGraphConflictError('Agent capability cannot reassign task nodes')
    return this.mutate('node:reassign', input.opId, input.id, input, (current) => {
      const node = current as TaskNode | undefined
      if (!node) throw new TaskGraphConflictError('Task graph node not found')
      if (node.version !== input.expectedVersion)
        throw new TaskGraphConflictError(
          `Expected version ${input.expectedVersion}, current version is ${node.version}`,
        )
      return {
        ...node,
        assigneeId: input.assigneeId,
        version: node.version + 1,
        updatedAt: new Date().toISOString(),
      }
    }) as TaskNode
  }

  snapshot(): {
    sessionId: string
    discussionId: string | null
    nodes: TaskNode[]
    edges: TaskEdgeRecord[]
    syncedAt: string
  } {
    const nodes = (
      this.db.raw
        .prepare(
          'SELECT * FROM task_graph_nodes WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY created_at, id',
        )
        .all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as NodeRow[]
    ).map(toNode)
    const edges = (
      this.db.raw
        .prepare(
          'SELECT * FROM task_graph_edges WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY created_at, id',
        )
        .all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as EdgeRow[]
    ).map(toEdge)
    return {
      sessionId: this.scope.sessionId,
      discussionId: this.scope.discussionId,
      nodes,
      edges,
      syncedAt: new Date().toISOString(),
    }
  }

  listEvents(): TaskGraphEvent[] {
    const rows = this.db.raw
      .prepare(
        'SELECT id, target_id, operation, actor_id, record_json, created_at FROM task_graph_events WHERE session_id = ? AND room_id = ? AND discussion_id = ? ORDER BY rowid',
      )
      .all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as Array<{
      id: string
      target_id: string
      operation: string
      actor_id: string
      record_json: string
      created_at: string
    }>
    return rows.map((row) => ({
      id: row.id,
      targetId: row.target_id,
      operation: row.operation,
      actorId: row.actor_id,
      record: (JSON.parse(row.record_json) as StoredEvent).record,
      createdAt: row.created_at,
    }))
  }

  static deleteBySession(db: SparkDatabase, sessionId: string): number {
    return db.raw.transaction(() => {
      let count = 0
      for (const table of ['task_graph_events', 'task_graph_edges', 'task_graph_nodes'])
        count += db.raw.prepare(`DELETE FROM ${table} WHERE session_id = ?`).run(sessionId).changes
      return count
    })()
  }

  private mutate(
    operation: string,
    opId: string,
    targetId: string,
    request: Record<string, unknown>,
    build: (current?: TaskNode | TaskEdgeRecord) => TaskNode | TaskEdgeRecord,
    edge = false,
  ): TaskNode | TaskEdgeRecord {
    return this.db.raw.transaction(() => {
      const prior = this.db.raw
        .prepare(
          'SELECT session_id, room_id, discussion_id, target_id, operation, actor_id, record_json, request_json FROM task_graph_events WHERE op_id = ?',
        )
        .get(opId) as
        | {
            session_id: string
            room_id: string
            discussion_id: string
            target_id: string
            operation: string
            actor_id: string
            record_json: string
            request_json: string
          }
        | undefined
      if (prior) {
        if (
          prior.session_id !== this.scope.sessionId ||
          prior.room_id !== this.scope.roomId ||
          prior.discussion_id !== this.scope.discussionId ||
          prior.target_id !== targetId ||
          prior.operation !== operation ||
          prior.actor_id !== this.scope.actorId ||
          canonicalJson(JSON.parse(prior.request_json)) !== canonicalJson(request)
        )
          throw new TaskGraphConflictError(
            `opId conflicts with another task graph operation: ${opId}`,
          )
        return (JSON.parse(prior.record_json) as StoredEvent).record
      }
      const current = edge ? this.findEdge(targetId) : this.findNode(targetId)
      const record = build(current)
      if (edge) this.upsertEdge(record as TaskEdgeRecord)
      else this.upsertNode(record as TaskNode)
      this.db.raw
        .prepare(
          'INSERT INTO task_graph_events (id, session_id, room_id, discussion_id, op_id, target_id, operation, actor_id, capability, record_json, request_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomUUID(),
          this.scope.sessionId,
          this.scope.roomId,
          this.scope.discussionId,
          opId,
          targetId,
          operation,
          this.scope.actorId,
          this.capability,
          JSON.stringify({ record }),
          JSON.stringify(request),
          (record as TaskNode).updatedAt ?? (record as TaskEdgeRecord).createdAt,
        )
      if (edge) this.recomputeStatuses()
      return record
    })()
  }

  private recomputeStatuses(): void {
    const nodes = this.snapshot().nodes
    for (const node of nodes) {
      const deps = this.db.raw
        .prepare(
          "SELECT from_node_id FROM task_graph_edges WHERE session_id = ? AND room_id = ? AND discussion_id = ? AND to_node_id = ? AND type = 'dependency'",
        )
        .all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId, node.id) as Array<{
        from_node_id: string
      }>
      if (
        deps.length === 0 ||
        ['running', 'completed', 'failed', 'cancelled'].includes(node.status)
      )
        continue
      const upstream = deps
        .map((dep) => this.findNode(dep.from_node_id))
        .filter((item): item is TaskNode => item != null)
      const next = upstream.some(
        (item) =>
          item.status === 'failed' || item.status === 'blocked' || item.status === 'cancelled',
      )
        ? 'blocked'
        : upstream.every((item) => item.status === 'completed')
          ? 'ready'
          : 'blocked'
      if (next !== node.status) this.updateStatusInternal(node, next)
    }
  }
  private updateStatusInternal(node: TaskNode, status: TaskNodeStatus): void {
    const next = { ...node, status, version: node.version + 1, updatedAt: new Date().toISOString() }
    this.upsertNode(next)
  }
  private findNode(id: string): TaskNode | undefined {
    const row = this.db.raw
      .prepare(
        'SELECT * FROM task_graph_nodes WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?',
      )
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as
      | NodeRow
      | undefined
    return row ? toNode(row) : undefined
  }
  private findEdge(id: string): TaskEdgeRecord | undefined {
    const row = this.db.raw
      .prepare(
        'SELECT * FROM task_graph_edges WHERE id = ? AND session_id = ? AND room_id = ? AND discussion_id = ?',
      )
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as
      | EdgeRow
      | undefined
    return row ? toEdge(row) : undefined
  }
  private hasPath(from: string, target: string, visited = new Set<string>()): boolean {
    if (from === target) return true
    if (visited.has(from)) return false
    visited.add(from)
    const next = this.db.raw
      .prepare(
        "SELECT to_node_id FROM task_graph_edges WHERE session_id = ? AND room_id = ? AND discussion_id = ? AND from_node_id = ? AND type = 'dependency'",
      )
      .all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId, from) as Array<{
      to_node_id: string
    }>
    return next.some((item) => this.hasPath(item.to_node_id, target, visited))
  }
  private count(table: 'task_graph_nodes'): number {
    return (
      this.db.raw
        .prepare(
          `SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ? AND room_id = ? AND discussion_id = ?`,
        )
        .get(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as { count: number }
    ).count
  }
  private upsertNode(node: TaskNode): void {
    const prior = this.db.raw
      .prepare('SELECT session_id, room_id, discussion_id FROM task_graph_nodes WHERE id = ?')
      .get(node.id) as
      | { session_id: string; room_id: string; discussion_id: string | null }
      | undefined
    if (
      prior &&
      (prior.session_id !== node.sessionId ||
        prior.room_id !== node.roomId ||
        prior.discussion_id !== node.discussionId)
    )
      throw new TaskGraphConflictError(
        'Task graph node id already belongs to another discussion scope: ' + node.id,
      )
    this.db.raw
      .prepare(
        'INSERT INTO task_graph_nodes (id, session_id, room_id, discussion_id, title, description, status, assignee_id, inputs_json, outputs_json, acceptance_status, retry_count, max_retries, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, assignee_id=excluded.assignee_id, outputs_json=excluded.outputs_json, acceptance_status=excluded.acceptance_status, retry_count=excluded.retry_count, version=excluded.version, updated_at=excluded.updated_at',
      )
      .run(
        node.id,
        node.sessionId,
        node.roomId,
        node.discussionId,
        node.title,
        node.description,
        node.status,
        node.assigneeId,
        JSON.stringify(node.inputs),
        JSON.stringify(node.outputs),
        node.acceptanceStatus,
        node.retryCount,
        node.maxRetries,
        node.version,
        node.createdAt,
        node.updatedAt,
      )
  }
  private upsertEdge(edge: TaskEdgeRecord): void {
    const prior = this.db.raw
      .prepare('SELECT session_id, room_id, discussion_id FROM task_graph_edges WHERE id = ?')
      .get(edge.id) as
      | { session_id: string; room_id: string; discussion_id: string | null }
      | undefined
    if (
      prior &&
      (prior.session_id !== edge.sessionId ||
        prior.room_id !== edge.roomId ||
        prior.discussion_id !== edge.discussionId)
    )
      throw new TaskGraphConflictError(
        'Task graph edge id already belongs to another discussion scope: ' + edge.id,
      )
    this.db.raw
      .prepare(
        'INSERT INTO task_graph_edges (id, session_id, room_id, discussion_id, from_node_id, to_node_id, type, version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        edge.id,
        edge.sessionId,
        edge.roomId,
        edge.discussionId,
        edge.fromNodeId,
        edge.toNodeId,
        edge.type,
        edge.version,
        edge.createdAt,
      )
  }
}

export type TaskEdgeRecord = TaskEdge
function toNode(row: NodeRow): TaskNode {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assignee_id,
    inputs: JSON.parse(row.inputs_json),
    outputs: JSON.parse(row.outputs_json),
    acceptanceStatus: row.acceptance_status,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
function toEdge(row: EdgeRow): TaskEdgeRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    type: row.type,
    version: row.version,
    createdAt: row.created_at,
  }
}
function allowedTransition(from: TaskNodeStatus, to: TaskNodeStatus): boolean {
  if (from === to) return true
  if (from === 'ready')
    return ['running', 'completed', 'failed', 'cancelled', 'blocked'].includes(to)
  if (from === 'running') return ['completed', 'failed', 'cancelled', 'blocked'].includes(to)
  return false
}
function assertJson(value: unknown): void {
  if (value === undefined) return
  const seen = new Set<object>()
  let count = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): void => {
    if (typeof current === 'string') {
      bytes += current.length + 2
      return
    }
    if (
      current === null ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      bytes += 8
      return
    }
    if (typeof current !== 'object' || seen.has(current))
      throw new TaskGraphConflictError('Task graph JSON must contain acyclic JSON values')
    if (depth >= 10)
      throw new TaskGraphConflictError('Task graph JSON exceeds maximum nesting depth')
    seen.add(current)
    if (++count > MAX_NODES)
      throw new TaskGraphConflictError('Task graph JSON exceeds maximum node count')
    for (const [key, item] of Object.entries(current)) {
      bytes += key.length + 3
      visit(item, depth + 1)
    }
    seen.delete(current)
  }
  visit(value, 0)
  if (bytes > MAX_BYTES)
    throw new TaskGraphConflictError('Task graph JSON exceeds serialized size limit')
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value != null && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  return JSON.stringify(value)
}

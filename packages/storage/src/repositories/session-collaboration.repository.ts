import crypto from 'node:crypto'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'
import { EventRepository, extractSearchableEventBody } from './event.repository.js'
import type { AgentEventRow, InsertEventParams } from './event.repository.js'
import type { SessionRow } from './session.repository.js'

export type SessionReferenceStatus = 'active' | 'revoked' | 'unavailable'
export type SessionReferenceAuditAction = 'attach' | 'update_snapshot' | 'revoke' | 'read'

export interface SessionLineageRow {
  child_session_id: string
  parent_session_id: string
  fork_anchor_turn_id: string | null
  fork_cutoff_seq: number
  source_title_snapshot: string
  created_at: string
  child_title?: string
}

export interface SessionReferenceRow {
  id: string
  target_session_id: string
  source_session_id: string
  snapshot_seq: number
  source_title_snapshot: string
  status: SessionReferenceStatus
  created_at: string
  revoked_at: string | null
  updated_at: string
}

export interface SessionReferenceAuditRow {
  id: string
  reference_id: string
  action: SessionReferenceAuditAction
  actor: 'user' | 'agent' | 'system'
  detail_json: string
  created_at: string
}

export interface SessionReferenceCandidate {
  sessionId: string
  title: string
  projectId: string
  workspaceIds: string[]
  status: string
  archived: boolean
  updatedAt: string
  latestCompletedSeq: number
  latestCompletedTurnId: string | null
  turnCount: number
}

export interface SessionReferenceView {
  id: string
  targetSessionId: string
  sourceSessionId: string
  title: string
  sourceTitleSnapshot: string
  projectId: string | null
  snapshotSeq: number
  status: SessionReferenceStatus
  createdAt: string
  updatedAt: string
  turnCount: number
}

export interface SessionForkResult {
  child: SessionRow
  lineage: SessionLineageRow
  copiedTurnCount: number
  sourceWasRunning: boolean
}

export interface ReferencedSessionTurn {
  turnId: string
  userMessage: string
  assistantMessages: string[]
  activities: Array<{ type: string; toolName?: string; status?: string; summary?: string }>
  firstSeq: number
  lastSeq: number
}

export interface ReferencedSessionReadResult {
  reference: SessionReferenceView
  turns: ReferencedSessionTurn[]
  nextCursor: number | null
  hasMore: boolean
}

export interface ReferencedSessionSearchHit {
  turnId: string
  seq: number
  role: 'user' | 'assistant'
  snippet: string
}

const TERMINAL_STATUSES = new Set(['idle', 'completed', 'cancelled', 'error'])
const MAX_REFERENCE_COUNT = 10
const MAX_READ_TURNS = 8
const MAX_READ_CHARS = 24_000
const MAX_ACTIVITY_ROWS_PER_TURN = 32
// Reserve enough room for one bounded terminal status activity per selected
// turn. It must remain visible even when transcript text consumes the budget.
const MAX_ACTIVITY_ENTRY_CHARS = 'agent_status'.length + 120 + 40 + 400
const MAX_SEARCH_QUERY_CHARS = 200
const MAX_CANDIDATE_CONTENT_SESSIONS = 1_000
const REFERENCE_SEARCH_BATCH_SIZE = 512

type AttachReferenceParams = {
  targetSessionId: string
  sourceSessionId: string
  snapshotSeq?: number
  actor?: 'user' | 'agent' | 'system'
}

/**
 * Storage boundary for collaboration semantics. It owns the consistency rules
 * so UI, IPC and MCP callers cannot accidentally implement different fork or
 * reference behavior.
 */
export class SessionCollaborationRepository extends BaseRepository {
  private readonly events: EventRepository

  constructor(db: SparkDatabase) {
    super(db, 'session_lineage')
    this.events = new EventRepository(db)
  }

  forkSession(params: {
    sourceSessionId: string
    anchorTurnId?: string
    title?: string
  }): SessionForkResult {
    const source = this.raw
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(params.sourceSessionId) as SessionRow | undefined
    if (source == null) throw new Error('源会话不存在或已删除')

    const rows = this.events.queryAllBySession(params.sourceSessionId)
    const completedTurns = getCompletedTurns(rows)
    const anchor =
      params.anchorTurnId == null
        ? (completedTurns.at(-1) ?? null)
        : (completedTurns.find((turn) => turn.turnId === params.anchorTurnId) ?? null)
    if (params.anchorTurnId != null && anchor == null) {
      throw new Error('只能从已完成的会话轮次处分支；当前轮次仍在运行或不存在')
    }

    const cutoffSeq = anchor?.cutoffSeq ?? 0
    const childId = crypto.randomUUID()
    const now = new Date().toISOString()
    const title = normalizeForkTitle(params.title, source.title)
    const sourceWasRunning = source.status === 'running'
    const child = {
      ...source,
      id: childId,
      title,
      status: 'idle',
      pinned_at: null,
      archived_at: null,
      turn_count: 0,
      logical_message_count: 0,
      metadata_json: source.metadata_json || '{}',
      created_at: now,
      updated_at: now,
    } satisfies SessionRow
    const lineage: SessionLineageRow = {
      child_session_id: childId,
      parent_session_id: source.id,
      fork_anchor_turn_id: anchor?.turnId ?? null,
      fork_cutoff_seq: cutoffSeq,
      source_title_snapshot: source.title,
      created_at: now,
    }

    const insertSession = this.raw.prepare(`
      INSERT INTO sessions (
        id, kind, title, status, project_id, workspace_ids_json, rule_bundle_id,
        permission_profile_id, provider_profile_id, model_id, agent_adapter, agent_id,
        permission_mode, chat_mode, reasoning_effort, pinned_at, archived_at,
        turn_count, logical_message_count, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertLineage = this.raw.prepare(`
      INSERT INTO session_lineage (
        child_session_id, parent_session_id, fork_anchor_turn_id,
        fork_cutoff_seq, source_title_snapshot, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)

    // A source with no completed turn must produce a genuinely empty child.
    // There may still be seq=0/early events from a running turn; copying those
    // would leak an incomplete prompt into the fork and make the child appear
    // to have history even though no stable boundary was selected.
    const copied =
      anchor == null
        ? []
        : rows
            .filter((row) => row.seq != null && row.seq <= cutoffSeq)
            .filter(
              (row) =>
                row.turn_id != null &&
                completedTurns.some(
                  (turn) => turn.turnId === row.turn_id && turn.cutoffSeq <= cutoffSeq,
                ),
            )
            .filter(isForkCopyableEvent)
            .map((row, index) => cloneEventForChild(row, childId, index))
    const insertEvents: InsertEventParams[] = copied.map((event) => ({
      id: event.id,
      sessionId: childId,
      ...(event.runId != null ? { runId: event.runId } : {}),
      ...(event.turnId != null ? { turnId: event.turnId } : {}),
      eventType: event.eventType,
      eventJson: event.eventJson,
    }))

    const tx = this.raw.transaction(() => {
      insertSession.run(
        child.id,
        child.kind,
        child.title,
        child.status,
        child.project_id,
        child.workspace_ids_json,
        child.rule_bundle_id,
        child.permission_profile_id,
        child.provider_profile_id,
        child.model_id,
        child.agent_adapter,
        child.agent_id,
        child.permission_mode,
        child.chat_mode,
        child.reasoning_effort,
        child.pinned_at,
        child.archived_at,
        child.turn_count,
        child.logical_message_count,
        child.metadata_json,
        child.created_at,
        child.updated_at,
      )
      insertLineage.run(
        lineage.child_session_id,
        lineage.parent_session_id,
        lineage.fork_anchor_turn_id,
        lineage.fork_cutoff_seq,
        lineage.source_title_snapshot,
        lineage.created_at,
      )
      this.events.insertBatchInTransaction(insertEvents)
    })
    tx()

    return {
      child: this.raw.prepare('SELECT * FROM sessions WHERE id = ?').get(childId) as SessionRow,
      lineage,
      copiedTurnCount:
        anchor == null ? 0 : completedTurns.filter((turn) => turn.cutoffSeq <= cutoffSeq).length,
      sourceWasRunning,
    }
  }

  getLineage(sessionId: string): SessionLineageRow | null {
    return (
      (this.raw
        .prepare('SELECT * FROM session_lineage WHERE child_session_id = ?')
        .get(sessionId) as SessionLineageRow | undefined) ?? null
    )
  }

  listChildren(parentSessionId: string): SessionLineageRow[] {
    return this.raw
      .prepare(
        `SELECT l.*, s.title AS child_title
         FROM session_lineage l
         LEFT JOIN sessions s ON s.id = l.child_session_id
         WHERE l.parent_session_id = ?
         ORDER BY l.created_at ASC`,
      )
      .all(parentSessionId) as SessionLineageRow[]
  }

  listCandidates(params: {
    targetSessionId: string
    workspaceId?: string
    query?: string
    includeArchived?: boolean
    limit?: number
  }): SessionReferenceCandidate[] {
    const limit = clampInt(params.limit, 1, 50, 30)
    const query = params.query?.trim() ?? ''
    if (query.length > MAX_SEARCH_QUERY_CHARS) {
      throw new Error('搜索关键词长度不能超过 200 个字符')
    }
    const conditions = ['id <> ?']
    const args: unknown[] = [params.targetSessionId]
    if (!params.includeArchived) conditions.push('archived_at IS NULL')
    if (query) {
      const pattern = `%${escapeLike(query)}%`
      const contentSessionIds = [
        ...new Set(
          this.events
            .searchByContent(query, MAX_CANDIDATE_CONTENT_SESSIONS)
            .map((match) => match.sessionId),
        ),
      ]
      if (contentSessionIds.length === 0) {
        conditions.push("title LIKE ? ESCAPE '\\'")
        args.push(pattern)
      } else {
        const sessionPlaceholders = contentSessionIds.map(() => '?').join(', ')
        conditions.push(`
          (
            title LIKE ? ESCAPE '\\'
            OR (
              id IN (${sessionPlaceholders})
              AND EXISTS (
                SELECT 1 FROM agent_events searchable_events
                WHERE searchable_events.session_id = sessions.id
                  AND searchable_events.turn_id IS NOT NULL
                  AND searchable_events.event_type IN (
                    'user_message', 'assistant_message', 'team_member_message'
                  )
                  AND COALESCE(
                    searchable_events.event_mode,
                    json_extract(searchable_events.event_json, '$.mode'),
                    'complete'
                  ) = 'complete'
                  AND (
                    searchable_events.event_type <> 'user_message'
                    OR COALESCE(
                      json_extract(searchable_events.event_json, '$.userMessageVisibility'),
                      'visible'
                    ) <> 'hidden'
                  )
                  AND EXISTS (
                    SELECT 1 FROM agent_events visible_user_events
                    WHERE visible_user_events.session_id = searchable_events.session_id
                      AND visible_user_events.turn_id = searchable_events.turn_id
                      AND visible_user_events.event_type = 'user_message'
                      AND COALESCE(
                        json_extract(visible_user_events.event_json, '$.userMessageVisibility'),
                        'visible'
                      ) <> 'hidden'
                  )
                  AND EXISTS (
                    SELECT 1 FROM agent_events completion_events
                    WHERE completion_events.session_id = searchable_events.session_id
                      AND completion_events.turn_id = searchable_events.turn_id
                      AND completion_events.event_type = 'agent_status'
                      AND json_extract(completion_events.event_json, '$.status')
                        IN ('idle', 'completed', 'cancelled', 'error')
                  )
                  AND json_extract(searchable_events.event_json, '$.content') LIKE ? ESCAPE '\\'
              )
            )
          )
        `)
        args.push(pattern, ...contentSessionIds, pattern)
      }
    }
    const rows = this.raw
      .prepare(
        `SELECT * FROM sessions WHERE ${conditions.join(' AND ')}
         ORDER BY CASE WHEN ? IS NOT NULL AND EXISTS (
           SELECT 1 FROM json_each(sessions.workspace_ids_json) WHERE json_each.value = ?
         ) THEN 0 ELSE 1 END, updated_at DESC LIMIT ?`,
      )
      .all(...args, params.workspaceId ?? null, params.workspaceId ?? null, limit) as SessionRow[]
    const latestCompletedBySession = this.listLatestCompletedTurns(rows.map((row) => row.id))
    return rows.map((row) => this.toCandidate(row, latestCompletedBySession.get(row.id)))
  }

  attachReference(params: AttachReferenceParams): SessionReferenceView {
    const references = this.attachReferences({ references: [params] })
    const reference = references[0]
    if (reference == null) throw new Error('参考会话引用创建失败')
    return reference
  }

  /**
   * Attach several references atomically. Validation happens for the complete
   * batch before the first insert, so one invalid source cannot leave a partial
   * set of references behind.
   */
  attachReferences(params: { references: AttachReferenceParams[] }): SessionReferenceView[] {
    const tx = this.raw.transaction(() => this.attachReferencesInTransaction(params))
    return tx() as SessionReferenceView[]
  }

  /** Use when the caller owns a wider transaction, such as dispatchTurn. */
  attachReferencesInTransaction(params: {
    references: AttachReferenceParams[]
  }): SessionReferenceView[] {
    const references = params.references.slice(0, MAX_REFERENCE_COUNT)
    if (references.length === 0) return []

    const activeCounts = new Map<string, number>()
    const pendingRows = new Map<string, SessionReferenceRow>()
    const prepared: Array<{
      row: SessionReferenceRow
      actor: 'user' | 'agent' | 'system'
      isNew: boolean
    }> = []

    // Read and validate the entire batch first. No database writes happen in
    // this pass; this also makes the quota check account for new unique rows
    // that appear later in the same batch.
    for (const reference of references) {
      if (reference.targetSessionId === reference.sourceSessionId)
        throw new Error('不能把当前会话添加为自身参考')
      const target = this.raw
        .prepare('SELECT id FROM sessions WHERE id = ?')
        .get(reference.targetSessionId)
      const source = this.raw
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(reference.sourceSessionId) as SessionRow | undefined
      if (target == null || source == null) throw new Error('目标会话或参考会话不存在')

      const key = `${reference.targetSessionId}\u0000${reference.sourceSessionId}`
      const existing = this.raw
        .prepare(
          `SELECT * FROM session_references
           WHERE target_session_id = ? AND source_session_id = ? AND status = 'active'
           ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(reference.targetSessionId, reference.sourceSessionId) as
        | SessionReferenceRow
        | undefined
      if (existing != null) {
        prepared.push({
          row: existing,
          actor: reference.actor ?? 'user',
          isNew: false,
        })
        continue
      }
      const pending = pendingRows.get(key)
      if (pending != null) {
        prepared.push({ row: pending, actor: reference.actor ?? 'user', isNew: false })
        continue
      }

      const activeCount =
        activeCounts.get(reference.targetSessionId) ??
        (
          this.raw
            .prepare(
              `SELECT COUNT(*) AS count FROM session_references
             WHERE target_session_id = ? AND status = 'active'`,
            )
            .get(reference.targetSessionId) as { count: number }
        ).count
      if (activeCount >= MAX_REFERENCE_COUNT)
        throw new Error(`每个会话最多添加 ${MAX_REFERENCE_COUNT} 个参考会话`)

      const completedTurns = getCompletedTurns(this.events.queryAllBySession(source.id))
      const latest = completedTurns.at(-1)
      const requested = reference.snapshotSeq ?? latest?.cutoffSeq ?? 0
      if (!Number.isInteger(requested) || requested < 0) throw new Error('参考会话快照位置无效')
      if (latest == null && requested !== 0) throw new Error('参考会话还没有可读取的完整轮次')
      if (latest != null && !completedTurns.some((turn) => turn.cutoffSeq === requested)) {
        throw new Error('参考会话只能绑定到完整轮次边界')
      }

      const now = new Date().toISOString()
      const row: SessionReferenceRow = {
        id: crypto.randomUUID(),
        target_session_id: reference.targetSessionId,
        source_session_id: source.id,
        snapshot_seq: requested,
        source_title_snapshot: source.title,
        status: 'active',
        created_at: now,
        revoked_at: null,
        updated_at: now,
      }
      pendingRows.set(key, row)
      activeCounts.set(reference.targetSessionId, activeCount + 1)
      prepared.push({ row, actor: reference.actor ?? 'user', isNew: true })
    }

    const insert = this.raw.prepare(
      `INSERT INTO session_references
       (id, target_session_id, source_session_id, snapshot_seq, source_title_snapshot,
        status, created_at, revoked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const item of prepared) {
      if (!item.isNew) continue
      const row = item.row
      insert.run(
        row.id,
        row.target_session_id,
        row.source_session_id,
        row.snapshot_seq,
        row.source_title_snapshot,
        row.status,
        row.created_at,
        row.revoked_at,
        row.updated_at,
      )
      this.writeAudit(
        row.id,
        'attach',
        item.actor,
        { snapshotSeq: row.snapshot_seq },
        row.created_at,
      )
    }
    return prepared.map((item) => this.toReferenceView(item.row))
  }

  listReferences(targetSessionId: string): SessionReferenceView[] {
    const rows = this.raw
      .prepare(
        `SELECT * FROM session_references WHERE target_session_id = ?
         ORDER BY created_at ASC`,
      )
      .all(targetSessionId) as SessionReferenceRow[]
    return rows.map((row) => {
      if (
        row.status === 'active' &&
        this.raw.prepare('SELECT 1 FROM sessions WHERE id = ?').get(row.source_session_id) == null
      ) {
        this.markUnavailable(row.id)
        row.status = 'unavailable'
        row.updated_at = new Date().toISOString()
      }
      return this.toReferenceView(row)
    })
  }

  updateReferenceSnapshot(params: {
    targetSessionId: string
    referenceId: string
    actor?: 'user' | 'agent' | 'system'
  }): SessionReferenceView {
    const row = this.getReference(params.referenceId)
    if (row == null) throw new Error('参考会话引用不存在')
    if (row.target_session_id !== params.targetSessionId)
      throw new Error('参考会话引用不属于当前会话')
    if (row.status !== 'active') {
      throw new Error(
        row.status === 'unavailable'
          ? '参考会话已删除，无法更新快照'
          : '参考会话引用已撤销，请重新添加',
      )
    }
    const source = this.raw
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(row.source_session_id) as SessionRow | undefined
    if (source == null) {
      this.markUnavailable(params.referenceId)
      throw new Error('参考会话已删除，无法更新快照')
    }
    const latest = getCompletedTurns(this.events.queryAllBySession(source.id)).at(-1)
    const snapshotSeq = latest?.cutoffSeq ?? 0
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE session_references SET snapshot_seq = ?, status = 'active', revoked_at = NULL,
         source_title_snapshot = ?, updated_at = ? WHERE id = ?`,
      )
      .run(snapshotSeq, source.title, now, params.referenceId)
    this.writeAudit(
      params.referenceId,
      'update_snapshot',
      params.actor ?? 'user',
      { snapshotSeq },
      now,
    )
    return this.toReferenceView({
      ...row,
      snapshot_seq: snapshotSeq,
      source_title_snapshot: source.title,
      status: 'active',
      revoked_at: null,
      updated_at: now,
    })
  }

  revokeReference(params: {
    targetSessionId: string
    referenceId: string
    actor?: 'user' | 'agent' | 'system'
  }): boolean {
    const row = this.getReference(params.referenceId)
    if (row == null) return false
    if (row.target_session_id !== params.targetSessionId)
      throw new Error('参考会话引用不属于当前会话')
    const now = new Date().toISOString()
    const changed =
      this.raw
        .prepare(
          `UPDATE session_references SET status = 'revoked', revoked_at = ?, updated_at = ?
         WHERE id = ? AND status <> 'revoked'`,
        )
        .run(now, now, params.referenceId).changes > 0
    if (changed) this.writeAudit(params.referenceId, 'revoke', params.actor ?? 'user', {}, now)
    return changed
  }

  readReference(params: {
    targetSessionId: string
    referenceId: string
    cursor?: number
    turnLimit?: number
    detail?: 'transcript' | 'user_visible_activity'
    actor?: 'user' | 'agent' | 'system'
  }): ReferencedSessionReadResult {
    const row = this.getReference(params.referenceId)
    if (row == null || row.target_session_id !== params.targetSessionId)
      throw new Error('参考会话引用不属于当前会话')
    if (row.status !== 'active')
      throw new Error(row.status === 'unavailable' ? '参考会话已删除' : '参考会话引用已撤销')
    const source = this.raw
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(row.source_session_id) as SessionRow | undefined
    if (source == null) {
      this.markUnavailable(row.id)
      throw new Error('参考会话已删除')
    }
    const cursor = params.cursor ?? -1
    if (!Number.isInteger(cursor) || cursor < -1) throw new Error('参考会话读取游标无效')
    const turnLimit = clampInt(params.turnLimit, 1, MAX_READ_TURNS, 4)
    const includeActivities = params.detail === 'user_visible_activity'
    // Select complete turn windows first, then fetch their events. The old
    // event-count LIMIT could cut a dense turn in half, causing the next page
    // to repeat or omit part of the same turn. The cursor now always advances
    // to the last seq of a complete turn.
    const turnWindows = this.raw
      .prepare(
        `WITH completed_turns AS (
           SELECT turn_id, MIN(seq) AS first_seq, MAX(seq) AS last_seq
           FROM agent_events
           WHERE session_id = ? AND seq <= ? AND turn_id IS NOT NULL
           GROUP BY turn_id
           HAVING MAX(CASE WHEN event_type = 'user_message'
             AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden'
             THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN event_type = 'agent_status'
                AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error')
                THEN 1 ELSE 0 END) = 1
         )
         SELECT turn_id, first_seq, last_seq
         FROM completed_turns
         WHERE first_seq > ?
         ORDER BY first_seq ASC
         LIMIT ?`,
      )
      .all(source.id, row.snapshot_seq, cursor, turnLimit) as Array<{
      turn_id: string
      first_seq: number
      last_seq: number
    }>
    const selectedTurnIds = turnWindows.map((turn) => turn.turn_id)
    let rows: AgentEventRow[] = []
    if (selectedTurnIds.length > 0) {
      const placeholders = selectedTurnIds.map(() => '?').join(', ')
      const transcriptRows = this.raw
        .prepare(
          `SELECT * FROM agent_events
           WHERE session_id = ? AND seq <= ? AND turn_id IN (${placeholders})
             AND (
               (event_type = 'user_message'
                 AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden')
               OR (event_type IN ('assistant_message', 'team_member_message')
                 AND COALESCE(event_mode, json_extract(event_json, '$.mode'), 'complete') = 'complete')
             )
           ORDER BY seq ASC`,
        )
        .all(source.id, row.snapshot_seq, ...selectedTurnIds) as AgentEventRow[]

      const activityRows = includeActivities
        ? (this.raw
            .prepare(
              `WITH non_terminal_activities AS (
                 SELECT e.*,
                   ROW_NUMBER() OVER (PARTITION BY e.turn_id ORDER BY e.seq ASC) AS activity_rank
                 FROM agent_events e
                 WHERE e.session_id = ? AND e.seq <= ? AND e.turn_id IN (${placeholders})
                   AND e.event_type IN ('tool_result', 'file_change', 'agent_status')
                   AND NOT (
                     e.event_type = 'agent_status'
                     AND json_extract(e.event_json, '$.status')
                       IN ('idle', 'completed', 'cancelled', 'error')
                   )
               ), terminal_activities AS (
                 SELECT e.*,
                   ROW_NUMBER() OVER (PARTITION BY e.turn_id ORDER BY e.seq DESC) AS terminal_rank
                 FROM agent_events e
                 WHERE e.session_id = ? AND e.seq <= ? AND e.turn_id IN (${placeholders})
                   AND e.event_type = 'agent_status'
                   AND json_extract(e.event_json, '$.status')
                     IN ('idle', 'completed', 'cancelled', 'error')
               )
               SELECT * FROM non_terminal_activities
               WHERE activity_rank <= ?
               UNION ALL
               SELECT * FROM terminal_activities
               WHERE terminal_rank = 1
               ORDER BY seq ASC`,
            )
            .all(
              source.id,
              row.snapshot_seq,
              ...selectedTurnIds,
              source.id,
              row.snapshot_seq,
              ...selectedTurnIds,
              MAX_ACTIVITY_ROWS_PER_TURN - 1,
            ) as AgentEventRow[])
        : []
      rows = [...transcriptRows, ...activityRows].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    }
    const grouped = groupReferenceRows(rows, turnLimit, includeActivities)
    // The cursor is a turn boundary, never the last event that happened to fit
    // within the character budget. Otherwise the tail of the current turn can
    // look like a later page even though the next page correctly starts after
    // that turn's first_seq.
    const lastReturnedTurnId = grouped.turns.at(-1)?.turnId ?? null
    const lastReturnedWindow =
      lastReturnedTurnId == null
        ? null
        : (turnWindows.find((turn) => turn.turn_id === lastReturnedTurnId) ?? null)
    const lastSeq = lastReturnedWindow?.last_seq ?? null
    const hasMore =
      lastSeq != null && this.hasReferenceRowsAfter(source.id, lastSeq, row.snapshot_seq)
    const now = new Date().toISOString()
    this.writeAudit(
      row.id,
      'read',
      params.actor ?? 'agent',
      { cursor, turnLimit, detail: params.detail ?? 'transcript' },
      now,
    )
    return {
      reference: this.toReferenceView(row),
      turns: grouped.turns,
      nextCursor: lastSeq,
      hasMore,
    }
  }

  searchReference(params: {
    targetSessionId: string
    referenceId: string
    query: string
    limit?: number
    actor?: 'user' | 'agent' | 'system'
  }): { reference: SessionReferenceView; hits: ReferencedSessionSearchHit[] } {
    const row = this.getReference(params.referenceId)
    if (row == null || row.target_session_id !== params.targetSessionId)
      throw new Error('参考会话引用不属于当前会话')
    if (row.status !== 'active')
      throw new Error(row.status === 'unavailable' ? '参考会话已删除' : '参考会话引用已撤销')
    const query = params.query.trim()
    if (query.length === 0 || query.length > MAX_SEARCH_QUERY_CHARS)
      throw new Error('搜索关键词长度必须为 1～200 个字符')
    if (
      this.raw.prepare('SELECT 1 FROM sessions WHERE id = ?').get(row.source_session_id) == null
    ) {
      this.markUnavailable(row.id)
      throw new Error('参考会话已删除')
    }
    const limit = clampInt(params.limit, 1, 20, 10)
    const searchBatch = this.raw.prepare(
      `WITH completed_turns AS (
           SELECT turn_id FROM agent_events
           WHERE session_id = ? AND seq <= ? AND turn_id IS NOT NULL
           GROUP BY turn_id
           HAVING MAX(CASE WHEN event_type = 'user_message'
             AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden'
             THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN event_type = 'agent_status'
                AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error')
                THEN 1 ELSE 0 END) = 1
         )
         SELECT * FROM agent_events
         WHERE session_id = ? AND seq > ? AND seq <= ?
           AND turn_id IN (SELECT turn_id FROM completed_turns)
           AND ((event_type = 'user_message'
             AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden')
             OR (event_type IN ('assistant_message', 'team_member_message')
               AND COALESCE(event_mode, json_extract(event_json, '$.mode'), 'complete') = 'complete'))
         ORDER BY seq ASC LIMIT ?`,
    )
    const needle = query.toLocaleLowerCase()
    const hits: ReferencedSessionSearchHit[] = []
    let scanCursor = -1
    while (hits.length < limit) {
      const sourceRows = searchBatch.all(
        row.source_session_id,
        row.snapshot_seq,
        row.source_session_id,
        scanCursor,
        row.snapshot_seq,
        REFERENCE_SEARCH_BATCH_SIZE,
      ) as AgentEventRow[]
      if (sourceRows.length === 0) break
      for (const event of sourceRows) {
        const body = extractSearchableEventBody(event.event_type, event.event_json)
        if (body == null || !body.toLocaleLowerCase().includes(needle)) continue
        hits.push({
          turnId: event.turn_id ?? '',
          seq: event.seq ?? 0,
          role: event.event_type === 'user_message' ? 'user' : 'assistant',
          snippet: makeSnippet(body, query),
        })
        if (hits.length >= limit) break
      }
      const lastScannedSeq = sourceRows.at(-1)?.seq
      if (lastScannedSeq == null || lastScannedSeq <= scanCursor) break
      scanCursor = lastScannedSeq
      if (sourceRows.length < REFERENCE_SEARCH_BATCH_SIZE) break
    }
    const now = new Date().toISOString()
    this.writeAudit(
      row.id,
      'read',
      params.actor ?? 'agent',
      { query: query.slice(0, 80), limit },
      now,
    )
    return { reference: this.toReferenceView(row), hits }
  }

  private toCandidate(
    row: SessionRow,
    latest?: { cutoffSeq: number; turnId: string },
  ): SessionReferenceCandidate {
    let workspaceIds: string[] = []
    try {
      workspaceIds = JSON.parse(row.workspace_ids_json) as string[]
    } catch {
      /* malformed legacy value */
    }
    return {
      sessionId: row.id,
      title: row.title,
      projectId: row.project_id,
      workspaceIds: Array.isArray(workspaceIds) ? workspaceIds : [],
      status: row.status,
      archived: row.archived_at != null,
      updatedAt: row.updated_at,
      latestCompletedSeq: latest?.cutoffSeq ?? 0,
      latestCompletedTurnId: latest?.turnId ?? null,
      turnCount: latest == null ? 0 : this.countCompletedTurns(row.id, latest.cutoffSeq),
    }
  }

  private getReference(id: string): SessionReferenceRow | null {
    return (
      (this.raw.prepare('SELECT * FROM session_references WHERE id = ?').get(id) as
        | SessionReferenceRow
        | undefined) ?? null
    )
  }

  private listLatestCompletedTurns(
    sessionIds: string[],
  ): Map<string, { cutoffSeq: number; turnId: string }> {
    if (sessionIds.length === 0) return new Map()
    const placeholders = sessionIds.map(() => '?').join(',')
    const rows = this.raw
      .prepare(
        `SELECT session_id, turn_id, MAX(seq) AS cutoff_seq
         FROM agent_events
         WHERE session_id IN (${placeholders}) AND turn_id IS NOT NULL
         GROUP BY session_id, turn_id
         HAVING MAX(CASE WHEN event_type = 'user_message'
           AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden'
           THEN 1 ELSE 0 END) = 1
            AND MAX(CASE WHEN event_type = 'agent_status'
              AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error')
              THEN 1 ELSE 0 END) = 1
         ORDER BY session_id ASC, cutoff_seq ASC`,
      )
      .all(...sessionIds) as Array<{ session_id: string; turn_id: string; cutoff_seq: number }>
    const latest = new Map<string, { cutoffSeq: number; turnId: string }>()
    for (const row of rows) {
      latest.set(row.session_id, {
        cutoffSeq: Number(row.cutoff_seq),
        turnId: row.turn_id,
      })
    }
    return latest
  }

  private toReferenceView(row: SessionReferenceRow): SessionReferenceView {
    const source = this.raw
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(row.source_session_id) as SessionRow | undefined
    return {
      id: row.id,
      targetSessionId: row.target_session_id,
      sourceSessionId: row.source_session_id,
      title: source?.title ?? row.source_title_snapshot,
      sourceTitleSnapshot: row.source_title_snapshot,
      projectId: source?.project_id ?? null,
      snapshotSeq: row.snapshot_seq,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turnCount: source == null ? 0 : this.countCompletedTurns(source.id, row.snapshot_seq),
    }
  }

  private markUnavailable(referenceId: string): void {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE session_references SET status = 'unavailable', updated_at = ? WHERE id = ? AND status = 'active'`,
      )
      .run(now, referenceId)
  }

  private writeAudit(
    referenceId: string,
    action: SessionReferenceAuditAction,
    actor: 'user' | 'agent' | 'system',
    detail: Record<string, unknown>,
    createdAt: string,
  ): void {
    this.raw
      .prepare(
        `INSERT INTO session_reference_audit (id, reference_id, action, actor, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), referenceId, action, actor, JSON.stringify(detail), createdAt)
  }

  private hasReferenceRowsAfter(sessionId: string, seq: number, snapshotSeq: number): boolean {
    const row = this.raw
      .prepare(
        `
        WITH completed_turns AS (
          SELECT turn_id, MIN(seq) AS first_seq FROM agent_events
          WHERE session_id = ? AND seq <= ? AND turn_id IS NOT NULL
          GROUP BY turn_id
          HAVING MAX(CASE WHEN event_type = 'user_message'
            AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden'
            THEN 1 ELSE 0 END) = 1
             AND MAX(CASE WHEN event_type = 'agent_status'
               AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error')
               THEN 1 ELSE 0 END) = 1
        )
        SELECT 1 FROM completed_turns
        WHERE first_seq > ?
        LIMIT 1
      `,
      )
      .get(sessionId, snapshotSeq, seq)
    return row != null
  }

  private countCompletedTurns(sessionId: string, snapshotSeq: number): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) AS count FROM (
           SELECT turn_id FROM agent_events
           WHERE session_id = ? AND seq <= ? AND turn_id IS NOT NULL
           GROUP BY turn_id
           HAVING MAX(CASE WHEN event_type = 'user_message'
             AND COALESCE(json_extract(event_json, '$.userMessageVisibility'), 'visible') <> 'hidden'
             THEN 1 ELSE 0 END) = 1
              AND MAX(CASE WHEN event_type = 'agent_status'
                AND json_extract(event_json, '$.status') IN ('idle', 'completed', 'cancelled', 'error')
                THEN 1 ELSE 0 END) = 1
         )`,
      )
      .get(sessionId, snapshotSeq) as { count: number }
    return row.count
  }
}

function getCompletedTurns(rows: AgentEventRow[]): Array<{ turnId: string; cutoffSeq: number }> {
  const turns = new Map<
    string,
    {
      cutoffSeq: number
      complete: boolean
      hasUserMessage: boolean
      hasVisibleUserMessage: boolean
    }
  >()
  for (const row of rows) {
    if (row.turn_id == null || row.seq == null) continue
    const current = turns.get(row.turn_id) ?? {
      cutoffSeq: row.seq,
      complete: false,
      hasUserMessage: false,
      hasVisibleUserMessage: false,
    }
    current.cutoffSeq = Math.max(current.cutoffSeq, row.seq)
    if (row.event_type === 'user_message') {
      current.hasUserMessage = true
      try {
        const visibility = (JSON.parse(row.event_json) as { userMessageVisibility?: unknown })
          .userMessageVisibility
        if (visibility !== 'hidden') current.hasVisibleUserMessage = true
      } catch {
        current.hasVisibleUserMessage = true
      }
    }
    if (row.event_type === 'agent_status') {
      try {
        const status = (JSON.parse(row.event_json) as { status?: unknown }).status
        if (typeof status === 'string' && TERMINAL_STATUSES.has(status)) current.complete = true
      } catch {
        /* malformed event is not a completion marker */
      }
    }
    turns.set(row.turn_id, current)
  }
  return [...turns.entries()]
    .filter(([, value]) => value.complete && value.hasUserMessage && value.hasVisibleUserMessage)
    .map(([turnId, value]) => ({ turnId, cutoffSeq: value.cutoffSeq }))
    .sort((a, b) => a.cutoffSeq - b.cutoffSeq)
}

function cloneEventForChild(
  row: AgentEventRow,
  childSessionId: string,
  seq: number,
): InsertEventParams {
  let parsed: Record<string, unknown>
  try {
    const value = JSON.parse(row.event_json) as unknown
    parsed =
      value != null && typeof value === 'object' && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : {}
  } catch {
    parsed = {}
  }
  parsed.id = crypto.randomUUID()
  parsed.sessionId = childSessionId
  parsed.seq = seq
  delete parsed.sdkSessionId
  if (row.event_type === 'turn_prompt_snapshot') {
    // The child must build a fresh provider/runtime session on its first turn.
    delete parsed.sdkSessionId
  }
  return {
    id: parsed.id as string,
    sessionId: childSessionId,
    ...(row.run_id != null ? { runId: row.run_id } : {}),
    ...(row.turn_id != null ? { turnId: row.turn_id } : {}),
    eventType: row.event_type,
    eventJson: JSON.stringify(parsed),
  }
}

/**
 * Only materialize stable, user-visible history into a fork. Runtime control
 * state, prompt audits and transient stream deltas belong to the source run
 * and must never make the child resumable or appear half-complete.
 */
function isForkCopyableEvent(row: AgentEventRow): boolean {
  if (row.event_type === 'checkpoint' || row.event_type === 'turn_prompt_snapshot') return false
  if (row.event_type === 'user_message') {
    try {
      if (
        (JSON.parse(row.event_json) as { userMessageVisibility?: unknown })
          .userMessageVisibility === 'hidden'
      ) {
        return false
      }
    } catch {
      // Keep malformed legacy user events copyable; they are still bounded by
      // the completed-turn marker and cannot carry a hidden presentation flag.
    }
  }
  if (row.event_type === 'agent_status') {
    try {
      const status = (JSON.parse(row.event_json) as { status?: unknown }).status
      return typeof status === 'string' && TERMINAL_STATUSES.has(status)
    } catch {
      return false
    }
  }
  if (
    ['assistant_message', 'agent_thinking', 'team_member_message', 'subagent_message'].includes(
      row.event_type,
    ) &&
    row.event_mode === 'delta'
  ) {
    return false
  }
  return new Set([
    'user_message',
    'assistant_message',
    'team_member_message',
    'subagent_message',
    'tool_call',
    'tool_result',
    'agent_status',
    'file_change',
    'terminal_output',
    'presented_files',
    'plan_proposed',
    'plan_rejected',
    'agent_error',
    'runtime_signal',
    'retry_trail',
  ]).has(row.event_type)
}

function groupReferenceRows(
  rows: AgentEventRow[],
  turnLimit: number,
  includeActivities: boolean,
): { turns: ReferencedSessionTurn[] } {
  const byTurn = new Map<string, ReferencedSessionTurn>()
  const terminalActivityReserve = includeActivities
    ? new Set(rows.map((row) => row.turn_id).filter((turnId): turnId is string => turnId != null))
        .size * MAX_ACTIVITY_ENTRY_CHARS
    : 0
  let outputChars = 0
  const appendBoundedText = (value: string, maxChars: number): string => {
    const remaining = MAX_READ_CHARS - terminalActivityReserve - outputChars
    if (remaining <= 0) return ''
    const text = trimText(value, Math.min(maxChars, remaining))
    outputChars += text.length
    return text
  }
  for (const row of rows) {
    if (row.turn_id == null) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(row.event_json) as Record<string, unknown>
    } catch {
      continue
    }
    let turn = byTurn.get(row.turn_id)
    if (turn == null) {
      if (byTurn.size >= turnLimit) continue
      turn = {
        turnId: row.turn_id,
        userMessage: '',
        assistantMessages: [],
        activities: [],
        firstSeq: row.seq ?? 0,
        lastSeq: row.seq ?? 0,
      }
      byTurn.set(row.turn_id, turn)
    }
    turn.lastSeq = Math.max(turn.lastSeq, row.seq ?? turn.lastSeq)
    const content = typeof parsed.content === 'string' ? parsed.content : ''
    if (
      row.event_type === 'user_message' &&
      parsed.userMessageVisibility !== 'hidden' &&
      turn.userMessage.length === 0
    ) {
      turn.userMessage = appendBoundedText(content, 8_000)
    }
    if (
      (row.event_type === 'assistant_message' || row.event_type === 'team_member_message') &&
      parsed.mode !== 'delta'
    ) {
      const text = appendBoundedText(content, 8_000)
      if (text) turn.assistantMessages.push(text)
    }
    if (
      includeActivities &&
      (row.event_type === 'tool_result' ||
        row.event_type === 'file_change' ||
        row.event_type === 'agent_status')
    ) {
      const toolName =
        typeof parsed.toolName === 'string' ? parsed.toolName.slice(0, 120) : undefined
      const status = typeof parsed.status === 'string' ? parsed.status.slice(0, 40) : undefined
      const summary = typeof parsed.error === 'string' ? trimText(parsed.error, 400) : undefined
      const activityChars =
        row.event_type.length +
        (toolName?.length ?? 0) +
        (status?.length ?? 0) +
        (summary?.length ?? 0)
      const isTerminalStatus =
        row.event_type === 'agent_status' &&
        typeof status === 'string' &&
        TERMINAL_STATUSES.has(status)
      if (
        !isTerminalStatus &&
        outputChars + activityChars > MAX_READ_CHARS - terminalActivityReserve
      )
        continue
      outputChars += activityChars
      const activity = {
        type: row.event_type,
        ...(toolName != null ? { toolName } : {}),
        ...(status != null ? { status } : {}),
        ...(summary != null ? { summary } : {}),
      }
      turn.activities.push(activity)
    }
  }
  return {
    turns: [...byTurn.values()].filter(
      (turn) => turn.userMessage || turn.assistantMessages.length > 0,
    ),
  }
}

function normalizeForkTitle(title: string | undefined, sourceTitle: string): string {
  const requested = title?.trim()
  const fallback = `${sourceTitle || '新会话'} · 分支`
  return (requested || fallback).slice(0, 200)
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function trimText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function makeSnippet(body: string, query: string): string {
  const index = body.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  if (index < 0) return trimText(body, 180)
  const start = Math.max(0, index - 60)
  const end = Math.min(body.length, index + query.length + 100)
  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`
}

import { randomUUID } from 'node:crypto'
import type { SparkDatabase } from './database.js'

export type ReplaySourceType = 'task' | 'handoff' | 'deliberation' | 'ledger' | 'tool' | 'manual'
export type ReplayStatus = 'available' | 'partial' | 'empty' | 'conflict'
export type ReplayCapability = 'agent' | 'system' | 'user'

export interface ReplayScope {
  sessionId: string
  roomId: string
  discussionId: string
  actorId: string
}

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

export type PlaybookStatus = 'proposed' | 'published' | 'archived'

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

export interface PlaybookApplication {
  id: string
  playbookId: string
  sessionId: string
  roomId: string
  discussionId: string
  targetDiscussionId: string
  playbookVersion: number
  appliedBy: string
  createdAt: string
}

export class ReplayPlaybookConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplayPlaybookConflictError'
  }
}

const MAX_EVENTS_PER_DISCUSSION = 100
const MAX_PLAYBOOKS_PER_DISCUSSION = 100
const MAX_PLAYBOOK_VERSIONS = 100
const MAX_LIST = 100
const MAX_TEXT = 2_000
const MAX_JSON_BYTES = 12_000
const MAX_JSON_DEPTH = 8
const MAX_JSON_NODES = 160
const SOURCE_TYPES = new Set<ReplaySourceType>(['task', 'handoff', 'deliberation', 'ledger', 'tool', 'manual'])

type ReplayEventRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  source_type: ReplaySourceType
  source_id: string
  seq: number
  event_time: string
  actor: string
  action: string
  before_json: string
  after_json: string
  evidence_refs_json: string
  origin_event_id: string | null
  op_id: string
  request_json: string
  created_at: string
}

type ReplayBranchRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  source_discussion_id: string
  source_seq: number
  reason: string
  created_by: string
  created_at: string
  op_id: string
  request_json: string
}

type PlaybookRow = {
  id: string
  session_id: string
  room_id: string
  discussion_id: string
  version: number
  status: PlaybookStatus
  name: string
  graph_json: string
  roles_json: string
  handoff_rules_json: string
  gate_rules_json: string
  deliberation_rules_json: string
  created_by: string
  created_at: string
  updated_at: string
}

type PlaybookVersionRow = PlaybookRow & {
  playbook_id: string
  operation: 'propose' | 'publish' | 'archive'
  op_id: string
  request_json: string
}

type PlaybookOperationRow = {
  id: string
  playbook_id: string
  session_id: string
  room_id: string
  discussion_id: string
  version: number
  operation: 'propose' | 'publish' | 'archive'
  actor: string
  op_id: string
  request_json: string
  result_json: string
  created_at: string
}

type PlaybookApplicationRow = {
  id: string
  playbook_id: string
  session_id: string
  room_id: string
  discussion_id: string
  target_discussion_id: string
  playbook_version: number
  applied_by: string
  op_id: string
  request_json: string
  result_json: string
  created_at: string
}

type ReplayOperation = {
  kind: 'event' | 'branch' | 'playbook' | 'application'
  sessionId: string
  roomId: string
  discussionId: string
  actor: string
  requestJson: string
  row: ReplayEventRow | ReplayBranchRow | PlaybookOperationRow | PlaybookApplicationRow
}

export class ReplayPlaybookService {
  private constructor(
    private readonly db: SparkDatabase,
    private readonly scope: ReplayScope,
    private readonly capability: ReplayCapability,
  ) {}

  static forAgent(db: SparkDatabase, scope: ReplayScope): ReplayPlaybookService {
    return new ReplayPlaybookService(db, scope, 'agent')
  }

  static forSystem(db: SparkDatabase, scope: ReplayScope): ReplayPlaybookService {
    return new ReplayPlaybookService(db, scope, 'system')
  }

  static forUser(db: SparkDatabase, scope: ReplayScope): ReplayPlaybookService {
    return new ReplayPlaybookService(db, scope, 'user')
  }

  /** Append one immutable event and allocate its sequence inside the transaction. */
  append(input: {
    id?: string
    sourceType: ReplaySourceType
    sourceId: string
    action: string
    before?: unknown
    after?: unknown
    evidenceRefs?: string[]
    expectedSeq?: number
    time?: string
    opId: string
  }): ReplayEvent {
    this.assertText(input.sourceId, 'sourceId')
    this.assertText(input.action, 'action')
    if (!SOURCE_TYPES.has(input.sourceType)) throw new ReplayPlaybookConflictError(`Unsupported replay source type: ${input.sourceType}`)
    if (input.id != null) this.assertText(input.id, 'id')
    if (input.opId.length === 0) throw new ReplayPlaybookConflictError('Replay opId is required')
    const evidenceRefs = input.evidenceRefs ?? []
    if (evidenceRefs.length > MAX_LIST) throw new ReplayPlaybookConflictError('Replay evidenceRefs exceed the 100 item limit')
    evidenceRefs.forEach((ref, index) => this.assertText(ref, `evidenceRefs[${index}]`))
    const before = input.before ?? null
    const after = input.after ?? null
    const beforeJson = serializeJson(before, 'before')
    const afterJson = serializeJson(after, 'after')
    const requestJson = canonicalJson({
      id: input.id ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      action: input.action,
      before,
      after,
      evidenceRefs,
      expectedSeq: input.expectedSeq ?? null,
      time: input.time ?? null,
      scope: this.scope,
    })

    return this.db.raw.transaction(() => {
      const prior = this.findOperation(input.opId)
      if (prior != null) {
        if (prior.kind !== 'event') throw new ReplayPlaybookConflictError(`opId conflicts with another replay operation: ${input.opId}`)
        this.assertOperationMatch(prior, requestJson)
        return toReplayEvent(prior.row as ReplayEventRow)
      }

      const currentSeq = this.currentSequence()
      if (input.expectedSeq !== undefined && input.expectedSeq !== currentSeq) {
        throw new ReplayPlaybookConflictError(`Expected replay sequence ${input.expectedSeq}, current sequence is ${currentSeq}`)
      }
      const count = this.db.raw
        .prepare('SELECT COUNT(*) AS count FROM replay_events WHERE session_id=? AND room_id=? AND discussion_id=?')
        .get(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as { count: number }
      if (count.count >= MAX_EVENTS_PER_DISCUSSION) {
        throw new ReplayPlaybookConflictError(`Replay event quota exceeded (${MAX_EVENTS_PER_DISCUSSION} per discussion)`)
      }

      const now = new Date().toISOString()
      const row: ReplayEventRow = {
        id: input.id ?? randomUUID(),
        session_id: this.scope.sessionId,
        room_id: this.scope.roomId,
        discussion_id: this.scope.discussionId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        seq: currentSeq + 1,
        event_time: input.time ?? now,
        actor: this.scope.actorId,
        action: input.action,
        before_json: beforeJson,
        after_json: afterJson,
        evidence_refs_json: canonicalJson(evidenceRefs),
        origin_event_id: null,
        op_id: input.opId,
        request_json: requestJson,
        created_at: now,
      }
      this.db.raw.prepare(`
        INSERT INTO replay_events
          (id, session_id, room_id, discussion_id, source_type, source_id, seq, event_time, actor,
           action, before_json, after_json, evidence_refs_json, origin_event_id, op_id, request_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.session_id, row.room_id, row.discussion_id, row.source_type, row.source_id, row.seq,
        row.event_time, row.actor, row.action, row.before_json, row.after_json, row.evidence_refs_json,
        row.origin_event_id, row.op_id, row.request_json, row.created_at,
      )
      return toReplayEvent(row)
    })()
  }

  appendEvent(input: Parameters<ReplayPlaybookService['append']>[0]): ReplayEvent {
    return this.append(input)
  }

  getTimeline(input: { cursor?: string; limit?: number } = {}): ReplayTimeline {
    const limit = normalizeLimit(input.limit)
    const cursor = normalizeCursor(input.cursor)
    const rows = this.db.raw.prepare(`
      SELECT * FROM replay_events
      WHERE session_id=? AND room_id=? AND discussion_id=? AND seq > ?
      ORDER BY seq ASC LIMIT ?
    `).all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId, cursor, limit + 1) as ReplayEventRow[]
    const hasMore = rows.length > limit
    const events = rows.slice(0, limit).map(toReplayEvent)
    return {
      sessionId: this.scope.sessionId,
      discussionId: this.scope.discussionId,
      events,
      cursor: input.cursor ?? null,
      nextCursor: hasMore ? String(events[events.length - 1]!.seq) : null,
      status: events.length === 0 ? 'empty' : hasMore ? 'partial' : 'available',
      syncedAt: new Date().toISOString(),
    }
  }

  timeline(input: { cursor?: string; limit?: number } = {}): ReplayTimeline {
    return this.getTimeline(input)
  }

  listTimeline(input: { cursor?: string; limit?: number } = {}): ReplayTimeline {
    return this.getTimeline(input)
  }

  getDiff(input: { fromSeq: number; toSeq: number; limit?: number }): ReplayDiff {
    const limit = normalizeLimit(input.limit)
    if (!Number.isInteger(input.fromSeq) || input.fromSeq < 1 || !Number.isInteger(input.toSeq) || input.toSeq < input.fromSeq) {
      throw new ReplayPlaybookConflictError('Replay diff sequence range is invalid')
    }
    const rows = this.db.raw.prepare(`
      SELECT * FROM replay_events
      WHERE session_id=? AND room_id=? AND discussion_id=? AND seq >= ? AND seq <= ?
      ORDER BY seq ASC LIMIT ?
    `).all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId, input.fromSeq, input.toSeq, limit + 1) as ReplayEventRow[]
    const hasMore = rows.length > limit
    return {
      sessionId: this.scope.sessionId,
      discussionId: this.scope.discussionId,
      fromSeq: input.fromSeq,
      toSeq: input.toSeq,
      events: rows.slice(0, limit).map(toReplayEvent),
      status: rows.length === 0 ? 'empty' : hasMore ? 'partial' : 'available',
    }
  }

  diff(input: { fromSeq: number; toSeq: number; limit?: number }): ReplayDiff {
    return this.getDiff(input)
  }

  replayDiff(input: { fromSeq: number; toSeq: number; limit?: number }): ReplayDiff {
    return this.getDiff(input)
  }

  /** Record lineage only; the source event log is never copied or mutated. */
  createBranch(input: { branchId: string; sourceSeq: number; reason: string; sourceDiscussionId?: string; expectedVersion?: number; opId: string }): ReplayBranch {
    this.assertText(input.branchId, 'branchId')
    this.assertText(input.reason, 'reason')
    if (!Number.isInteger(input.sourceSeq) || input.sourceSeq < 0) throw new ReplayPlaybookConflictError('Branch sourceSeq must be a non-negative integer')
    const sourceDiscussionId = input.sourceDiscussionId ?? this.scope.discussionId
    if (sourceDiscussionId !== this.scope.discussionId) throw new ReplayPlaybookConflictError('Branch source discussion is outside the current scope')
    const requestJson = canonicalJson({ ...input, sourceDiscussionId, scope: this.scope })

    return this.db.raw.transaction(() => {
      const prior = this.findOperation(input.opId)
      if (prior != null) {
        if (prior.kind !== 'branch') throw new ReplayPlaybookConflictError(`opId conflicts with another replay operation: ${input.opId}`)
        this.assertOperationMatch(prior, requestJson)
        return toReplayBranch(prior.row as ReplayBranchRow)
      }
      const currentSeq = this.currentSequence()
      if (input.sourceSeq > currentSeq) throw new ReplayPlaybookConflictError(`Branch source sequence ${input.sourceSeq} does not exist`)
      const existing = this.db.raw.prepare('SELECT * FROM replay_branches WHERE id=?').get(input.branchId) as ReplayBranchRow | undefined
      if (existing != null) throw new ReplayPlaybookConflictError(`Branch id is already owned: ${input.branchId}`)
      const now = new Date().toISOString()
      const row: ReplayBranchRow = {
        id: input.branchId,
        session_id: this.scope.sessionId,
        room_id: this.scope.roomId,
        discussion_id: this.scope.discussionId,
        source_discussion_id: sourceDiscussionId,
        source_seq: input.sourceSeq,
        reason: input.reason,
        created_by: this.scope.actorId,
        created_at: now,
        op_id: input.opId,
        request_json: requestJson,
      }
      this.db.raw.prepare(`
        INSERT INTO replay_branches
          (id, session_id, room_id, discussion_id, source_discussion_id, source_seq, reason, created_by, created_at, op_id, request_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(row.id, row.session_id, row.room_id, row.discussion_id, row.source_discussion_id, row.source_seq,
        row.reason, row.created_by, row.created_at, row.op_id, row.request_json)
      return toReplayBranch(row)
    })()
  }

  fork(input: { branchId: string; sourceSeq: number; reason: string; sourceDiscussionId?: string; expectedVersion?: number; opId: string }): { branch: ReplayBranch; timeline: ReplayTimeline } {
    const branch = this.createBranch(input)
    return { branch, timeline: this.getTimeline() }
  }

  listBranches(limit = MAX_LIST): ReplayBranch[] {
    const normalizedLimit = normalizeLimit(limit)
    return (this.db.raw.prepare(`
      SELECT * FROM replay_branches
      WHERE session_id=? AND room_id=? AND discussion_id=?
      ORDER BY created_at ASC, id ASC LIMIT ?
    `).all(this.scope.sessionId, this.scope.roomId, this.scope.discussionId, normalizedLimit) as ReplayBranchRow[]).map(toReplayBranch)
  }

  getBranch(id: string): ReplayBranch | undefined {
    const row = this.db.raw.prepare('SELECT * FROM replay_branches WHERE id=? AND session_id=? AND room_id=? AND discussion_id=?')
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as ReplayBranchRow | undefined
    return row == null ? undefined : toReplayBranch(row)
  }

  /** Propose a new immutable playbook version. Agents may only create proposals. */
  propose(input: {
    id: string
    name: string
    graph: unknown
    roles: unknown
    handoffRules: unknown
    gateRules: unknown
    deliberationRules: unknown
    expectedVersion?: number
    opId: string
  }): TeamPlaybook {
    this.assertText(input.id, 'playbook id')
    this.assertText(input.name, 'playbook name')
    this.assertText(input.opId, 'playbook opId')
    const graph = serializeJson(input.graph, 'graph')
    const roles = serializeJson(input.roles, 'roles')
    const handoffRules = serializeJson(input.handoffRules, 'handoffRules')
    const gateRules = serializeJson(input.gateRules, 'gateRules')
    const deliberationRules = serializeJson(input.deliberationRules, 'deliberationRules')
    const requestJson = canonicalJson({
      action: 'propose', id: input.id, name: input.name, graph: input.graph, roles: input.roles,
      handoffRules: input.handoffRules, gateRules: input.gateRules, deliberationRules: input.deliberationRules,
      expectedVersion: input.expectedVersion ?? null, scope: this.scope,
    })
    return this.db.raw.transaction(() => {
      const prior = this.findOperation(input.opId)
      if (prior != null) {
        if (prior.kind !== 'playbook') throw new ReplayPlaybookConflictError(`opId conflicts with another replay operation: ${input.opId}`)
        this.assertOperationMatch(prior, requestJson)
        return parseTeamPlaybookResult((prior.row as PlaybookOperationRow).result_json)
      }
      this.assertAgentCanPropose()
      const current = this.getPlaybookRow(input.id)
      const currentVersion = current?.version ?? 0
      if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
        throw new ReplayPlaybookConflictError(`Expected playbook version ${input.expectedVersion}, current version is ${currentVersion}`)
      }
      if (current?.status === 'archived') throw new ReplayPlaybookConflictError('Archived playbooks cannot receive new proposals')
      if (current == null) {
        const count = this.db.raw.prepare('SELECT COUNT(*) AS count FROM replay_playbooks WHERE session_id=? AND room_id=? AND discussion_id=?')
          .get(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as { count: number }
        if (count.count >= MAX_PLAYBOOKS_PER_DISCUSSION) throw new ReplayPlaybookConflictError(`Playbook quota exceeded (${MAX_PLAYBOOKS_PER_DISCUSSION} per discussion)`)
      }
      const version = currentVersion + 1
      if (version > MAX_PLAYBOOK_VERSIONS) throw new ReplayPlaybookConflictError(`Playbook version quota exceeded (${MAX_PLAYBOOK_VERSIONS})`)
      const now = new Date().toISOString()
      const row: PlaybookRow = {
        id: input.id, session_id: this.scope.sessionId, room_id: this.scope.roomId, discussion_id: this.scope.discussionId,
        version, status: 'proposed', name: input.name, graph_json: graph, roles_json: roles,
        handoff_rules_json: handoffRules, gate_rules_json: gateRules, deliberation_rules_json: deliberationRules,
        created_by: current?.created_by ?? this.scope.actorId, created_at: current?.created_at ?? now, updated_at: now,
      }
      if (current == null) {
        this.db.raw.prepare(`
          INSERT INTO replay_playbooks
            (id, session_id, room_id, discussion_id, version, status, name, graph_json, roles_json,
             handoff_rules_json, gate_rules_json, deliberation_rules_json, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(row.id, row.session_id, row.room_id, row.discussion_id, row.version, row.status, row.name, row.graph_json,
          row.roles_json, row.handoff_rules_json, row.gate_rules_json, row.deliberation_rules_json, row.created_by, row.created_at, row.updated_at)
      } else {
        this.db.raw.prepare(`
          UPDATE replay_playbooks SET version=?, status=?, name=?, graph_json=?, roles_json=?, handoff_rules_json=?,
            gate_rules_json=?, deliberation_rules_json=?, updated_at=?
          WHERE id=? AND session_id=? AND room_id=? AND discussion_id=? AND version=?
        `).run(row.version, row.status, row.name, row.graph_json, row.roles_json, row.handoff_rules_json,
          row.gate_rules_json, row.deliberation_rules_json, row.updated_at, row.id, row.session_id, row.room_id,
          row.discussion_id, current.version)
      }
      this.db.raw.prepare(`
        INSERT INTO replay_playbook_versions
          (id, playbook_id, session_id, room_id, discussion_id, version, status, name, graph_json, roles_json,
           handoff_rules_json, gate_rules_json, deliberation_rules_json, created_by, created_at, operation, op_id, request_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), row.id, row.session_id, row.room_id, row.discussion_id, row.version, row.status, row.name,
        row.graph_json, row.roles_json, row.handoff_rules_json, row.gate_rules_json, row.deliberation_rules_json,
        row.created_by, row.created_at, 'propose', input.opId, requestJson)
      const result = toTeamPlaybook(row)
      this.recordPlaybookOperation(input.id, version, 'propose', input.opId, requestJson, result)
      return result
    })()
  }

  publish(input: { id: string; expectedVersion: number; opId: string }): TeamPlaybook {
    return this.transitionPlaybook('publish', input)
  }

  archive(input: { id: string; expectedVersion: number; opId: string }): TeamPlaybook {
    return this.transitionPlaybook('archive', input)
  }

  apply(input: { id: string; expectedVersion: number; targetDiscussionId: string; opId: string }): { playbook: TeamPlaybook; appliedDiscussionId: string; applicationId: string } {
    this.assertText(input.id, 'playbook id')
    this.assertText(input.targetDiscussionId, 'targetDiscussionId')
    this.assertText(input.opId, 'playbook opId')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ReplayPlaybookConflictError('Playbook expectedVersion must be positive')
    const requestJson = canonicalJson({ action: 'apply', ...input, scope: this.scope })
    return this.db.raw.transaction(() => {
      const prior = this.findOperation(input.opId)
      if (prior != null) {
        if (prior.kind !== 'application') throw new ReplayPlaybookConflictError(`opId conflicts with another replay operation: ${input.opId}`)
        this.assertOperationMatch(prior, requestJson)
        return JSON.parse((prior.row as PlaybookApplicationRow).result_json) as { playbook: TeamPlaybook; appliedDiscussionId: string; applicationId: string }
      }
      this.assertGovernanceCapability('apply')
      const current = this.getPlaybookRow(input.id)
      if (current == null) throw new ReplayPlaybookConflictError(`Playbook ${input.id} does not exist`)
      if (current.version !== input.expectedVersion) {
        throw new ReplayPlaybookConflictError(`Expected current playbook version ${input.expectedVersion}, current version is ${current.version}`)
      }
      const row = this.getPlaybookVersion(input.id, input.expectedVersion)
      if (row == null || row.status !== 'published') throw new ReplayPlaybookConflictError(`Published playbook version ${input.expectedVersion} does not exist`)
      const applicationId = randomUUID()
      const now = new Date().toISOString()
      const application: PlaybookApplicationRow = {
        id: applicationId, playbook_id: input.id, session_id: this.scope.sessionId, room_id: this.scope.roomId,
        discussion_id: this.scope.discussionId, target_discussion_id: input.targetDiscussionId,
        playbook_version: input.expectedVersion, applied_by: this.scope.actorId, op_id: input.opId,
        request_json: requestJson, result_json: '', created_at: now,
      }
      const result = { playbook: toTeamPlaybook(current), appliedDiscussionId: input.targetDiscussionId, applicationId }
      application.result_json = canonicalJson(result)
      this.db.raw.prepare(`
        INSERT INTO replay_playbook_applications
          (id, playbook_id, session_id, room_id, discussion_id, target_discussion_id, playbook_version,
           applied_by, op_id, request_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(application.id, application.playbook_id, application.session_id, application.room_id, application.discussion_id,
        application.target_discussion_id, application.playbook_version, application.applied_by, application.op_id,
        application.request_json, application.result_json, application.created_at)
      return result
    })()
  }

  current(id: string): TeamPlaybook | undefined {
    this.assertText(id, 'playbook id')
    const row = this.getPlaybookRow(id)
    return row == null ? undefined : toTeamPlaybook(row)
  }

  listVersions(id: string, limit = MAX_LIST): TeamPlaybook[] {
    this.assertText(id, 'playbook id')
    const normalizedLimit = normalizeLimit(limit)
    return (this.db.raw.prepare(`
      SELECT * FROM replay_playbook_versions
      WHERE playbook_id=? AND session_id=? AND room_id=? AND discussion_id=?
      ORDER BY version ASC LIMIT ?
    `).all(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, normalizedLimit) as PlaybookVersionRow[]).map(toTeamPlaybook)
  }

  versions(id: string, limit = MAX_LIST): TeamPlaybook[] {
    return this.listVersions(id, limit)
  }

  listApplications(id?: string, limit = MAX_LIST): PlaybookApplication[] {
    if (id != null) this.assertText(id, 'playbook id')
    const normalizedLimit = normalizeLimit(limit)
    const suffix = id == null ? '' : ' AND playbook_id=?'
    const params = id == null
      ? [this.scope.sessionId, this.scope.roomId, this.scope.discussionId, normalizedLimit]
      : [this.scope.sessionId, this.scope.roomId, this.scope.discussionId, id, normalizedLimit]
    return (this.db.raw.prepare(`
      SELECT * FROM replay_playbook_applications
      WHERE session_id=? AND room_id=? AND discussion_id=?${suffix}
      ORDER BY created_at ASC, id ASC LIMIT ?
    `).all(...params) as PlaybookApplicationRow[]).map(toPlaybookApplication)
  }

  private transitionPlaybook(operation: 'publish' | 'archive', input: { id: string; expectedVersion: number; opId: string }): TeamPlaybook {
    this.assertText(input.id, 'playbook id')
    this.assertText(input.opId, 'playbook opId')
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new ReplayPlaybookConflictError('Playbook expectedVersion must be positive')
    const requestJson = canonicalJson({ action: operation, ...input, scope: this.scope })
    return this.db.raw.transaction(() => {
      const prior = this.findOperation(input.opId)
      if (prior != null) {
        if (prior.kind !== 'playbook') throw new ReplayPlaybookConflictError(`opId conflicts with another replay operation: ${input.opId}`)
        this.assertOperationMatch(prior, requestJson)
        return parseTeamPlaybookResult((prior.row as PlaybookOperationRow).result_json)
      }
      this.assertGovernanceCapability(operation)
      const current = this.getPlaybookRow(input.id)
      if (current == null) throw new ReplayPlaybookConflictError(`Playbook ${input.id} does not exist`)
      if (current.version !== input.expectedVersion) {
        throw new ReplayPlaybookConflictError(`Expected current playbook version ${input.expectedVersion}, current version is ${current.version}`)
      }
      const row = this.getPlaybookVersion(input.id, input.expectedVersion)
      if (row == null) throw new ReplayPlaybookConflictError(`Playbook version ${input.expectedVersion} does not exist`)
      if (operation === 'publish' && row.status !== 'proposed') throw new ReplayPlaybookConflictError('Only proposed playbooks can be published')
      if (operation === 'archive' && row.status === 'archived') throw new ReplayPlaybookConflictError('Playbook is already archived')
      const status: PlaybookStatus = operation === 'publish' ? 'published' : 'archived'
      const now = new Date().toISOString()
      this.db.raw.prepare('UPDATE replay_playbooks SET status=?, updated_at=? WHERE id=? AND session_id=? AND room_id=? AND discussion_id=? AND version=?')
        .run(status, now, input.id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, input.expectedVersion)
      this.db.raw.prepare('UPDATE replay_playbook_versions SET status=? WHERE playbook_id=? AND session_id=? AND room_id=? AND discussion_id=? AND version=?')
        .run(status, input.id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, input.expectedVersion)
      const updated = { ...row, status, updated_at: now }
      const result = toTeamPlaybook(updated)
      this.recordPlaybookOperation(input.id, input.expectedVersion, operation, input.opId, requestJson, result)
      return result
    })()
  }

  private recordPlaybookOperation(playbookId: string, version: number, operation: 'propose' | 'publish' | 'archive', opId: string, requestJson: string, result: TeamPlaybook): void {
    this.db.raw.prepare(`
      INSERT INTO replay_playbook_operations
        (id, playbook_id, session_id, room_id, discussion_id, version, operation, actor, op_id, request_json, result_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), playbookId, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, version, operation,
      this.scope.actorId, opId, requestJson, canonicalJson(result), result.updatedAt)
  }

  private getPlaybookRow(id: string): PlaybookRow | undefined {
    return this.db.raw.prepare('SELECT * FROM replay_playbooks WHERE id=? AND session_id=? AND room_id=? AND discussion_id=?')
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as PlaybookRow | undefined
  }

  private getPlaybookVersion(id: string, version: number): PlaybookVersionRow | undefined {
    return this.db.raw.prepare('SELECT * FROM replay_playbook_versions WHERE playbook_id=? AND session_id=? AND room_id=? AND discussion_id=? AND version=?')
      .get(id, this.scope.sessionId, this.scope.roomId, this.scope.discussionId, version) as PlaybookVersionRow | undefined
  }

  private assertAgentCanPropose(): void {
    if (this.capability !== 'agent' && this.capability !== 'user' && this.capability !== 'system') throw new ReplayPlaybookConflictError('Unknown playbook capability')
  }

  private assertGovernanceCapability(operation: 'publish' | 'archive' | 'apply'): void {
    if (this.capability === 'agent') throw new ReplayPlaybookConflictError(`Agents cannot ${operation} playbooks`)
  }

  static deleteBySession(db: SparkDatabase, sessionId: string): number {
    return db.raw.transaction(() => {
      let count = 0
      for (const table of ['replay_playbook_applications', 'replay_playbook_operations', 'replay_playbook_versions', 'replay_playbooks', 'replay_branches', 'replay_events']) {
        count += db.raw.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(sessionId).changes
      }
      return count
    })()
  }

  private currentSequence(): number {
    const row = this.db.raw.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM replay_events WHERE session_id=? AND room_id=? AND discussion_id=?')
      .get(this.scope.sessionId, this.scope.roomId, this.scope.discussionId) as { seq: number }
    return row.seq
  }

  private findOperation(opId: string): ReplayOperation | undefined {
    const event = this.db.raw.prepare('SELECT * FROM replay_events WHERE op_id=?').get(opId) as ReplayEventRow | undefined
    if (event != null) return { kind: 'event', sessionId: event.session_id, roomId: event.room_id, discussionId: event.discussion_id, actor: event.actor, requestJson: event.request_json, row: event }
    const branch = this.db.raw.prepare('SELECT * FROM replay_branches WHERE op_id=?').get(opId) as ReplayBranchRow | undefined
    if (branch != null) return { kind: 'branch', sessionId: branch.session_id, roomId: branch.room_id, discussionId: branch.discussion_id, actor: branch.created_by, requestJson: branch.request_json, row: branch }
    const playbook = this.db.raw.prepare('SELECT * FROM replay_playbook_operations WHERE op_id=?').get(opId) as PlaybookOperationRow | undefined
    if (playbook != null) return { kind: 'playbook', sessionId: playbook.session_id, roomId: playbook.room_id, discussionId: playbook.discussion_id, actor: playbook.actor, requestJson: playbook.request_json, row: playbook }
    const application = this.db.raw.prepare('SELECT * FROM replay_playbook_applications WHERE op_id=?').get(opId) as PlaybookApplicationRow | undefined
    if (application != null) return { kind: 'application', sessionId: application.session_id, roomId: application.room_id, discussionId: application.discussion_id, actor: application.applied_by, requestJson: application.request_json, row: application }
    return undefined
  }

  private assertOperationMatch(prior: ReplayOperation, requestJson: string): void {
    if (prior.sessionId !== this.scope.sessionId || prior.roomId !== this.scope.roomId || prior.discussionId !== this.scope.discussionId || prior.actor !== this.scope.actorId || prior.requestJson !== requestJson) {
      throw new ReplayPlaybookConflictError('opId conflicts with another replay operation')
    }
  }

  private assertText(value: string, field: string): void {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new ReplayPlaybookConflictError(`${field} is empty or exceeds ${MAX_TEXT} characters`)
  }

  get capabilityForTesting(): ReplayCapability {
    return this.capability
  }
}

function normalizeLimit(limit: number | undefined): number {
  const value = limit ?? MAX_LIST
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST) throw new ReplayPlaybookConflictError(`Replay list limit must be between 1 and ${MAX_LIST}`)
  return value
}

function normalizeCursor(cursor: string | undefined): number {
  if (cursor == null) return 0
  if (!/^\d+$/.test(cursor)) throw new ReplayPlaybookConflictError('Replay cursor must be a non-negative sequence')
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) throw new ReplayPlaybookConflictError('Replay cursor is out of range')
  return value
}

function serializeJson(value: unknown, field: string): string {
  try {
    assertJsonBounds(value)
    return canonicalJson(value)
  } catch (error) {
    throw new ReplayPlaybookConflictError(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
}

function assertJsonBounds(value: unknown): void {
  const seen = new Set<object>()
  let nodes = 0
  const visit = (current: unknown, depth: number): void => {
    if (current == null) return
    if (typeof current === 'string' || typeof current === 'boolean') return
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new Error('JSON must contain finite numbers')
      return
    }
    if (typeof current !== 'object' || seen.has(current)) throw new Error('JSON must contain acyclic values')
    if (depth >= MAX_JSON_DEPTH || ++nodes > MAX_JSON_NODES) throw new Error('JSON exceeds nesting or node limit')
    seen.add(current)
    if (Array.isArray(current)) current.forEach((item) => visit(item, depth + 1))
    else Object.values(current).forEach((item) => visit(item, depth + 1))
    seen.delete(current)
  }
  visit(value, 0)
  if (canonicalJson(value).length > MAX_JSON_BYTES) throw new Error('JSON exceeds serialized size limit')
}

function toReplayEvent(row: ReplayEventRow): ReplayEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    seq: row.seq,
    time: row.event_time,
    actor: row.actor,
    action: row.action,
    before: JSON.parse(row.before_json) as unknown,
    after: JSON.parse(row.after_json) as unknown,
    evidenceRefs: JSON.parse(row.evidence_refs_json) as string[],
  }
}

function toReplayBranch(row: ReplayBranchRow): ReplayBranch {
  return {
    id: row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    sourceDiscussionId: row.source_discussion_id,
    sourceSeq: row.source_seq,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function toTeamPlaybook(row: PlaybookRow | PlaybookVersionRow): TeamPlaybook {
  return {
    id: 'playbook_id' in row ? row.playbook_id : row.id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    version: row.version,
    status: row.status,
    name: row.name,
    graph: JSON.parse(row.graph_json) as unknown,
    roles: JSON.parse(row.roles_json) as unknown,
    handoffRules: JSON.parse(row.handoff_rules_json) as unknown,
    gateRules: JSON.parse(row.gate_rules_json) as unknown,
    deliberationRules: JSON.parse(row.deliberation_rules_json) as unknown,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseTeamPlaybookResult(resultJson: string): TeamPlaybook {
  return JSON.parse(resultJson) as TeamPlaybook
}

function toPlaybookApplication(row: PlaybookApplicationRow): PlaybookApplication {
  return {
    id: row.id,
    playbookId: row.playbook_id,
    sessionId: row.session_id,
    roomId: row.room_id,
    discussionId: row.discussion_id,
    targetDiscussionId: row.target_discussion_id,
    playbookVersion: row.playbook_version,
    appliedBy: row.applied_by,
    createdAt: row.created_at,
  }
}

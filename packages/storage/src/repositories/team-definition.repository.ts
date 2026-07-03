/**
 * @module team-definition.repository
 *
 * 长期团队定义（agent_teams 表）的数据访问。
 *
 * - 长期团队：用户在 AgentsView「Teams」Tab 维护的可复用团队，由 host_agent_id +
 *   member_agent_ids_json + 嵌套参数 + 团队专属 prompt 组成。
 * - 会话运行时仍以 sessions.metadata.team 为权威配置（参见 TeamModeConfig）；
 *   当会话来自某个长期团队时，metadata.team.teamId 指向 agent_teams.id。
 * - built_in=1 的团队不可删除，仅可编辑（与 agents 一致）。
 */

import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import {
  DEFAULT_MAX_DISCUSSION_ROUNDS,
  HARD_MAX_DISCUSSION_ROUNDS,
} from './team-discussion.repository.js'

export interface AgentTeamRow {
  id: string
  name: string
  description: string
  built_in: number
  enabled: number
  host_agent_id: string
  member_agent_ids_json: string
  max_depth: number
  allow_nesting: number
  prompt: string
  metadata_json: string
  max_discussion_rounds: number
  enable_peer_messaging: number
  created_at: string
  updated_at: string
}

export interface AgentTeamItem {
  id: string
  name: string
  description: string
  builtIn: boolean
  enabled: boolean
  hostAgentId: string
  memberAgentIds: string[]
  maxDepth: number
  allowNesting: boolean
  prompt: string
  metadata: Record<string, unknown>
  maxDiscussionRounds: number
  enablePeerMessaging: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateAgentTeamParams {
  id?: string
  name: string
  description?: string
  builtIn?: boolean
  enabled?: boolean
  hostAgentId: string
  memberAgentIds?: string[]
  maxDepth?: number
  allowNesting?: boolean
  prompt?: string
  metadata?: Record<string, unknown>
  maxDiscussionRounds?: number
  enablePeerMessaging?: boolean
}

export interface UpdateAgentTeamParams {
  name?: string
  description?: string
  enabled?: boolean
  hostAgentId?: string
  memberAgentIds?: string[]
  maxDepth?: number
  allowNesting?: boolean
  prompt?: string
  metadata?: Record<string, unknown>
  maxDiscussionRounds?: number
  enablePeerMessaging?: boolean
}

export interface ListAgentTeamsParams {
  includeDisabled?: boolean
}

function clampMaxDiscussionRounds(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_MAX_DISCUSSION_ROUNDS
  const n = Math.trunc(value)
  if (n < 1) return 1
  if (n > HARD_MAX_DISCUSSION_ROUNDS) return HARD_MAX_DISCUSSION_ROUNDS
  return n
}

function rowToItem(row: AgentTeamRow): AgentTeamItem {
  const parseList = (json: string): string[] => {
    try {
      const v = JSON.parse(json)
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  const parseObj = (json: string): Record<string, unknown> => {
    try {
      const v = JSON.parse(json)
      return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    builtIn: row.built_in === 1,
    enabled: row.enabled === 1,
    hostAgentId: row.host_agent_id,
    memberAgentIds: parseList(row.member_agent_ids_json),
    maxDepth: row.max_depth,
    allowNesting: row.allow_nesting === 1,
    prompt: row.prompt,
    metadata: parseObj(row.metadata_json),
    maxDiscussionRounds: clampMaxDiscussionRounds(row.max_discussion_rounds),
    enablePeerMessaging: row.enable_peer_messaging === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class TeamDefinitionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'agent_teams')
  }

  list(params: ListAgentTeamsParams = {}): AgentTeamItem[] {
    const where = params.includeDisabled === true ? '' : 'WHERE enabled = 1'
    const rows = this.raw
      .prepare(`SELECT * FROM agent_teams ${where} ORDER BY built_in DESC, updated_at DESC`)
      .all() as AgentTeamRow[]
    return rows.map(rowToItem)
  }

  get(id: string): AgentTeamItem | null {
    const row = this.findById<AgentTeamRow>(id)
    return row ? rowToItem(row) : null
  }

  create(params: CreateAgentTeamParams): AgentTeamItem {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO agent_teams (
           id, name, description, built_in, enabled,
           host_agent_id, member_agent_ids_json, max_depth, allow_nesting,
           prompt, metadata_json, max_discussion_rounds, enable_peer_messaging, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.name,
        params.description ?? '',
        params.builtIn === true ? 1 : 0,
        params.enabled === false ? 0 : 1,
        params.hostAgentId,
        JSON.stringify(params.memberAgentIds ?? []),
        params.maxDepth ?? 1,
        params.allowNesting === true ? 1 : 0,
        params.prompt ?? '',
        JSON.stringify(params.metadata ?? {}),
        clampMaxDiscussionRounds(params.maxDiscussionRounds),
        params.enablePeerMessaging === true ? 1 : 0,
        now,
        now,
      )
    return this.get(id)!
  }

  update(id: string, params: UpdateAgentTeamParams): AgentTeamItem | null {
    const sets: string[] = []
    const values: unknown[] = []
    if (params.name !== undefined) {
      sets.push('name = ?')
      values.push(params.name)
    }
    if (params.description !== undefined) {
      sets.push('description = ?')
      values.push(params.description)
    }
    if (params.enabled !== undefined) {
      sets.push('enabled = ?')
      values.push(params.enabled ? 1 : 0)
    }
    if (params.hostAgentId !== undefined) {
      sets.push('host_agent_id = ?')
      values.push(params.hostAgentId)
    }
    if (params.memberAgentIds !== undefined) {
      sets.push('member_agent_ids_json = ?')
      values.push(JSON.stringify(params.memberAgentIds))
    }
    if (params.maxDepth !== undefined) {
      sets.push('max_depth = ?')
      values.push(params.maxDepth)
    }
    if (params.allowNesting !== undefined) {
      sets.push('allow_nesting = ?')
      values.push(params.allowNesting ? 1 : 0)
    }
    if (params.prompt !== undefined) {
      sets.push('prompt = ?')
      values.push(params.prompt)
    }
    if (params.metadata !== undefined) {
      sets.push('metadata_json = ?')
      values.push(JSON.stringify(params.metadata))
    }
    if (params.maxDiscussionRounds !== undefined) {
      sets.push('max_discussion_rounds = ?')
      values.push(clampMaxDiscussionRounds(params.maxDiscussionRounds))
    }
    if (params.enablePeerMessaging !== undefined) {
      sets.push('enable_peer_messaging = ?')
      values.push(params.enablePeerMessaging ? 1 : 0)
    }
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)
    this.raw.prepare(`UPDATE agent_teams SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  /** built_in 团队不可删除（业务约束在 service 层；此方法只删指定 id） */
  delete(id: string): boolean {
    return this.deleteById(id)
  }
}

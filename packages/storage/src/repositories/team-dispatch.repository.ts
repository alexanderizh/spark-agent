/**
 * @module team-dispatch.repository
 *
 * Persists Team Mode (Agent-to-Agent) dispatch records.
 *
 * 每次 Host 通过 agent_team_dispatch 工具调用一个 Member，都会在此表落一行。
 * 用于：回放（详情抽屉 team:list-dispatches）、用量统计、权限审计、以及
 * 启动时回收卡在 working/pending 的僵尸 dispatch。
 *
 * 会话级团队配置（enabled/hostAgentId/memberAgentIds/...）不在此表，而是写在
 * sessions.metadata_json 的 team 字段，由 SessionRepository 负责。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type TeamDispatchState = 'pending' | 'working' | 'completed' | 'failed' | 'canceled'

export interface TeamDispatchRow {
  id: string
  session_id: string
  turn_id: string
  parent_dispatch_id: string | null
  host_agent_id: string
  member_agent_id: string
  state: TeamDispatchState
  task_json: string
  reply_json: string | null
  error_message: string | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number | null
  started_at: string
  ended_at: string | null
}

export interface CreateTeamDispatchParams {
  id: string
  sessionId: string
  turnId: string
  hostAgentId: string
  memberAgentId: string
  /** TeamA2ATask 序列化后的 JSON */
  taskJson: string
  /** 初始状态，默认 'working' */
  state?: TeamDispatchState
  parentDispatchId?: string | null
}

export interface UpdateTeamDispatchParams {
  state?: TeamDispatchState
  /** TeamA2AReply 序列化后的 JSON */
  replyJson?: string | null
  errorMessage?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  durationMs?: number | null
  /** 结束时间（ISO 8601）；传入即视为收尾 */
  endedAt?: string | null
}

export class TeamDispatchRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'team_dispatches')
  }

  /** 创建一条 dispatch 记录（dispatch 开始时调用） */
  create(params: CreateTeamDispatchParams): TeamDispatchRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO team_dispatches
         (id, session_id, turn_id, parent_dispatch_id, host_agent_id, member_agent_id,
          state, task_json, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.sessionId,
        params.turnId,
        params.parentDispatchId ?? null,
        params.hostAgentId,
        params.memberAgentId,
        params.state ?? 'working',
        params.taskJson,
        now,
      )
    return this.findById<TeamDispatchRow>(params.id)!
  }

  /** 局部更新一条 dispatch（仅更新传入的字段） */
  update(id: string, params: UpdateTeamDispatchParams): TeamDispatchRow | null {
    const sets: string[] = []
    const values: unknown[] = []
    if (params.state !== undefined) {
      sets.push('state = ?')
      values.push(params.state)
    }
    if (params.replyJson !== undefined) {
      sets.push('reply_json = ?')
      values.push(params.replyJson)
    }
    if (params.errorMessage !== undefined) {
      sets.push('error_message = ?')
      values.push(params.errorMessage)
    }
    if (params.inputTokens !== undefined) {
      sets.push('input_tokens = ?')
      values.push(params.inputTokens)
    }
    if (params.outputTokens !== undefined) {
      sets.push('output_tokens = ?')
      values.push(params.outputTokens)
    }
    if (params.durationMs !== undefined) {
      sets.push('duration_ms = ?')
      values.push(params.durationMs)
    }
    if (params.endedAt !== undefined) {
      sets.push('ended_at = ?')
      values.push(params.endedAt)
    }
    if (sets.length === 0) return this.findById<TeamDispatchRow>(id)

    values.push(id)
    this.raw
      .prepare(`UPDATE team_dispatches SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.findById<TeamDispatchRow>(id)
  }

  /** 按 session 列出 dispatch（最新优先） */
  listBySession(sessionId: string, limit = 50): TeamDispatchRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM team_dispatches WHERE session_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(sessionId, limit) as TeamDispatchRow[]
  }

  /** 按 turn 列出 dispatch（最早优先，便于按时间线回放） */
  listByTurn(turnId: string): TeamDispatchRow[] {
    return this.raw
      .prepare('SELECT * FROM team_dispatches WHERE turn_id = ? ORDER BY started_at ASC')
      .all(turnId) as TeamDispatchRow[]
  }

  /**
   * 把卡在 pending/working 且超过给定时刻仍未结束的 dispatch 标记为 failed。
   * 用于进程启动时回收僵尸记录（见设计文档 §15 风险缓解）。
   * @param olderThanIso 早于该 ISO 时间戳的 started_at 才会被回收
   * @returns 被回收的行数
   */
  markStaleAsFailed(olderThanIso: string): number {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `UPDATE team_dispatches
         SET state = 'failed',
             error_message = COALESCE(error_message, 'Dispatch abandoned (process restart)'),
             ended_at = ?
         WHERE state IN ('pending','working') AND ended_at IS NULL AND started_at < ?`,
      )
      .run(now, olderThanIso)
    return result.changes
  }

  /** 删除某 session 的所有 dispatch（session 清空时调用） */
  deleteBySession(sessionId: string): number {
    const result = this.raw
      .prepare('DELETE FROM team_dispatches WHERE session_id = ?')
      .run(sessionId)
    return result.changes
  }
}

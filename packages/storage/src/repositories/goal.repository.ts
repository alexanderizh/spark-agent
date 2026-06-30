import { randomUUID } from 'node:crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type GoalStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cleared' | 'stopped_by_budget' | 'pending_contract'
export type GoalMode = 'spark-loop' | 'codex-native'

export interface GoalBudget {
  maxIterations?: number
  maxRuntimeMinutes?: number
  maxBudgetUsd?: number
  maxConsecutiveFailures?: number
  noProgressLimit?: number
}

export interface GoalValidation {
  commands?: string[]
  checklist?: string[]
}

export interface GoalProgressEntry {
  iteration: number
  phase: 'review' | 'act' | 'validate'
  status: GoalStatus | 'continue' | 'blocked'
  summary: string
  evidence?: string[]
  nextStep?: string
  validation?: Record<string, unknown>
  createdAt: string
}

export interface SessionGoalRow {
  id: string
  session_id: string
  objective: string
  success_criteria_json: string
  constraints_json: string
  validation_json: string
  budget_json: string
  progress_log_json: string
  status: GoalStatus
  mode: GoalMode
  last_error: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

export interface SessionGoal {
  id: string
  sessionId: string
  objective: string
  successCriteria: string[]
  constraints: string[]
  validation: GoalValidation
  budget: GoalBudget
  progressLog: GoalProgressEntry[]
  status: GoalStatus
  mode: GoalMode
  lastError?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CreateGoalParams {
  sessionId: string
  objective: string
  successCriteria?: string[]
  constraints?: string[]
  validation?: GoalValidation
  budget?: GoalBudget
  mode?: GoalMode
}

const ACTIVE_STATUSES: GoalStatus[] = ['active', 'paused', 'stopped_by_budget', 'pending_contract']

export class GoalRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'session_goals')
  }

  createOrReplaceActiveGoal(params: CreateGoalParams): SessionGoal {
    const now = new Date().toISOString()
    const tx = this.raw.transaction(() => {
      this.raw.prepare(`UPDATE session_goals SET status = 'cleared', updated_at = ? WHERE session_id = ? AND status IN ('active','paused','stopped_by_budget')`).run(now, params.sessionId)
      const id = randomUUID()
      this.raw.prepare(`INSERT INTO session_goals
        (id, session_id, objective, success_criteria_json, constraints_json, validation_json, budget_json, progress_log_json, status, mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .run(id, params.sessionId, params.objective, this.toJson(params.successCriteria ?? []), this.toJson(params.constraints ?? []), this.toJson(params.validation ?? {}), this.toJson(params.budget ?? {}), '[]', params.mode ?? 'spark-loop', now, now)
      return id
    })
    const id = tx() as string
    return this.get(id)!
  }

  get(id: string): SessionGoal | null {
    const row = this.findById<SessionGoalRow>(id)
    return row == null ? null : this.map(row)
  }

  getCurrent(sessionId: string): SessionGoal | null {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',')
    const row = this.raw.prepare(`SELECT * FROM session_goals WHERE session_id = ? AND status IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`).get(sessionId, ...ACTIVE_STATUSES) as SessionGoalRow | undefined
    return row == null ? null : this.map(row)
  }

  updateStatus(id: string, status: GoalStatus, patch: { lastError?: string | null; summary?: string } = {}): SessionGoal | null {
    const now = new Date().toISOString()
    this.raw.prepare(`UPDATE session_goals SET status = ?, last_error = COALESCE(?, last_error), updated_at = ?, completed_at = CASE WHEN ? IN ('completed','failed','cleared') THEN ? ELSE completed_at END WHERE id = ?`)
      .run(status, patch.lastError ?? null, now, status, now, id)
    return this.get(id)
  }

  updateContract(
    id: string,
    contract: { successCriteria?: string[]; constraints?: string[]; validation?: GoalValidation },
  ): SessionGoal | null {
    const sets: string[] = []
    const args: unknown[] = []
    if (contract.successCriteria != null) { sets.push('success_criteria_json = ?'); args.push(this.toJson(contract.successCriteria)) }
    if (contract.constraints != null) { sets.push('constraints_json = ?'); args.push(this.toJson(contract.constraints)) }
    if (contract.validation != null) { sets.push('validation_json = ?'); args.push(this.toJson(contract.validation)) }
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?'); args.push(new Date().toISOString())
    args.push(id)
    this.raw.prepare(`UPDATE session_goals SET ${sets.join(', ')} WHERE id = ?`).run(...args)
    return this.get(id)
  }

  appendProgress(id: string, entry: Omit<GoalProgressEntry, 'createdAt'> & { createdAt?: string }): SessionGoal | null {
    const row = this.findById<SessionGoalRow>(id)
    if (row == null) return null
    const log = this.fromJson<GoalProgressEntry[]>(row.progress_log_json, [])
    log.push({ ...entry, createdAt: entry.createdAt ?? new Date().toISOString() })
    const now = new Date().toISOString()
    this.raw.prepare('UPDATE session_goals SET progress_log_json = ?, updated_at = ? WHERE id = ?').run(this.toJson(log), now, id)
    return this.get(id)
  }

  clearCurrent(sessionId: string): SessionGoal | null {
    const current = this.getCurrent(sessionId)
    if (current == null) return null
    return this.updateStatus(current.id, 'cleared')
  }

  private map(row: SessionGoalRow): SessionGoal {
    return {
      id: row.id,
      sessionId: row.session_id,
      objective: row.objective,
      successCriteria: this.fromJson<string[]>(row.success_criteria_json, []),
      constraints: this.fromJson<string[]>(row.constraints_json, []),
      validation: this.fromJson<GoalValidation>(row.validation_json, {}),
      budget: this.fromJson<GoalBudget>(row.budget_json, {}),
      progressLog: this.fromJson<GoalProgressEntry[]>(row.progress_log_json, []),
      status: row.status,
      mode: row.mode,
      ...(row.last_error != null ? { lastError: row.last_error } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.completed_at != null ? { completedAt: row.completed_at } : {}),
    }
  }
}

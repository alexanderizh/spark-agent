/**
 * @module session-summary.repository
 *
 * Persists LLM-generated conversation summaries for long sessions.
 *
 * When conversation history grows large, older turns are summarized by the
 * Context Governor and the summary is stored here. On subsequent turns,
 * the summary is loaded and prepended to the remaining (recent) entries
 * instead of simply truncating the oldest turns.
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface SessionSummaryRow {
  id: string
  session_id: string
  summary_turn_id: string
  summary_text: string
  summarized_entry_count: number
  summarized_from_seq: number
  summarized_to_seq: number
  estimated_tokens: number
  model_id: string | null
  created_at: string
}

export interface CreateSessionSummaryParams {
  id: string
  sessionId: string
  summaryTurnId: string
  summaryText: string
  summarizedEntryCount: number
  summarizedFromSeq: number
  summarizedToSeq: number
  estimatedTokens: number
  modelId?: string
}

export class SessionSummaryRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'session_summaries')
  }

  /**
   * Get the latest summary for a session (covers the most recent range of turns).
   */
  getLatest(sessionId: string): SessionSummaryRow | null {
    return this.raw
      .prepare(
        'SELECT * FROM session_summaries WHERE session_id = ? ORDER BY summarized_to_seq DESC LIMIT 1',
      )
      .get(sessionId) as SessionSummaryRow | null
  }

  /**
   * Insert a new summary record.
   */
  create(params: CreateSessionSummaryParams): SessionSummaryRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO session_summaries
         (id, session_id, summary_turn_id, summary_text, summarized_entry_count,
          summarized_from_seq, summarized_to_seq, estimated_tokens, model_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.sessionId,
        params.summaryTurnId,
        params.summaryText,
        params.summarizedEntryCount,
        params.summarizedFromSeq,
        params.summarizedToSeq,
        params.estimatedTokens,
        params.modelId ?? null,
        now,
      )
    return this.findById<SessionSummaryRow>(params.id)!
  }

  /**
   * Delete all summaries for a session (e.g. when session is cleared).
   */
  deleteBySession(sessionId: string): number {
    const result = this.raw
      .prepare('DELETE FROM session_summaries WHERE session_id = ?')
      .run(sessionId)
    return result.changes
  }
}

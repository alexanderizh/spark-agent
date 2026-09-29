/**
 * @module wiki-extraction-state.repository
 *
 * 抽取水位线（wiki_extraction_state）仓储 — 增量抽样的游标（migration 113）。
 *
 * 语义：
 *   - `last_turn_index` 只在该会话**成功抽取过**后推进；失败保持原值，
 *     下次重试重跑同一批轮次（候选按 content_digest 去重，不会刷屏）。
 *   - `last_error` 只存失败原因分类（machine readable），绝不存正文片段
 *     （脱敏纪律：错误与日志不得包含知识内容）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 抽取触发方式（与 protocol WikiExtractionTrigger 一致） */
export type WikiExtractionTriggerKind = 'manual' | 'milestone' | 'idle' | 'schedule'

export interface WikiExtractionStateRow {
  session_id: string
  scope: string
  scope_ref: string | null
  last_turn_index: number
  last_run_at: number | null
  last_trigger: string | null
  run_count: number
  last_error: string | null
}

export class WikiExtractionStateRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_extraction_state')
  }

  get(sessionId: string): WikiExtractionStateRow | null {
    return (
      (this.raw
        .prepare(`SELECT * FROM wiki_extraction_state WHERE session_id = ?`)
        .get(sessionId) as WikiExtractionStateRow | undefined) ?? null
    )
  }

  /** 已抽取到的最大轮次序号（0 = 从未抽取）。 */
  watermark(sessionId: string): number {
    return this.get(sessionId)?.last_turn_index ?? 0
  }

  /**
   * 推进水位线（成功抽取后调用）。
   *
   * upsert 语义：首次运行写入 scope，重复运行只推进 last_turn_index 与计数。
   */
  advance(params: {
    sessionId: string
    scope: string
    scopeRef: string | null
    turnIndex: number
    trigger: WikiExtractionTriggerKind
    now?: number
  }): void {
    const at = params.now ?? Date.now()
    this.raw
      .prepare(
        `INSERT INTO wiki_extraction_state
           (session_id, scope, scope_ref, last_turn_index, last_run_at, last_trigger,
            run_count, last_error)
         VALUES (?, ?, ?, ?, ?, ?, 1, NULL)
         ON CONFLICT(session_id) DO UPDATE SET
           last_turn_index = MAX(last_turn_index, excluded.last_turn_index),
           last_run_at = excluded.last_run_at,
           last_trigger = excluded.last_trigger,
           run_count = run_count + 1,
           last_error = NULL`,
      )
      .run(
        params.sessionId,
        params.scope,
        params.scopeRef,
        Math.max(0, Math.floor(params.turnIndex)),
        at,
        params.trigger,
      )
  }

  /**
   * 记录失败原因（不推进水位线，便于下次重试同一批轮次）。
   *
   * upsert 语义：首次运行就失败也要留痕，否则界面上无法解释"上次为什么没
   * 抽出东西"；此时写入 last_turn_index = 0（未推进）。
   */
  recordError(
    sessionId: string,
    reason: string,
    scope?: { scope: string; scopeRef: string | null },
    now?: number,
  ): void {
    const at = now ?? Date.now()
    const scopeValue = scope?.scope ?? 'user'
    const scopeRefValue = scope?.scopeRef ?? null
    this.raw
      .prepare(
        `INSERT INTO wiki_extraction_state
           (session_id, scope, scope_ref, last_turn_index, last_run_at, last_trigger,
            run_count, last_error)
         VALUES (?, ?, ?, 0, ?, NULL, 0, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           last_run_at = excluded.last_run_at,
           last_error = excluded.last_error`,
      )
      .run(sessionId, scopeValue, scopeRefValue, at, reason.slice(0, 200))
  }
}

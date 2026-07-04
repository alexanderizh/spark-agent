/**
 * @module team-discussion.repository
 *
 * 团队 A2A 升级（Phase A）：共享讨论线程的持久化。
 *
 * team_discussions   —— 一场讨论的状态机（active → concluded/canceled）。
 * team_thread_messages —— 讨论内所有消息（Host 派发回执 / 成员回复 / 成员间对等消息 /
 *                       team_round_advance 写入的本轮小结）。
 *
 * 调用方：
 *  - createDiscussion：Host 本次 turn 首次注入团队工具时建一行（state=active）。
 *  - appendMessage：dispatch 回执 / peer_message / round_summary 都经此入口落库。
 *  - advanceRound：team_round_advance 调用，round_index + 1 并写入一条 round_summary 消息。
 *  - conclude：team_conclude 或会话取消时收尾，state 置为 concluded/canceled。
 *  - renderThreadForPrompt：被调度者 prompt 渲染共享线程文本（按 token 预算截断）。
 *
 * 设计原则：
 *  - 与 team-dispatch.repository 一致，全部 prepared statement，禁止字符串拼接。
 *  - Repository 只管读写，不发射事件、不调用 dispatch 引擎（那是 Phase B 的活）。
 *  - maxRounds 硬上限在 advanceRound 内兜底拒绝（防 caller 忘了校验）。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

// ─── 类型 ────────────────────────────────────────────────────────────────────

export type TeamDiscussionState = 'active' | 'concluded' | 'canceled'

export type TeamThreadMessageKind =
  | 'host_dispatch'
  | 'member_reply'
  | 'peer_message'
  | 'round_summary'

export type TeamThreadMessageDelivery = 'call' | 'note'

export interface TeamDiscussionRow {
  id: string
  session_id: string
  host_agent_id: string
  topic: string | null
  round_index: number
  max_rounds: number
  state: TeamDiscussionState
  started_at: string
  ended_at: string | null
}

export interface TeamThreadMessageRow {
  id: string
  discussion_id: string
  sender_agent_id: string
  target_agent_id: string | null
  round_index: number
  kind: TeamThreadMessageKind
  content: string
  dispatch_id: string | null
  delivery: TeamThreadMessageDelivery | null
  created_at: string
}

export interface CreateDiscussionParams {
  id: string
  sessionId: string
  hostAgentId: string
  topic?: string | null
  /** 配置上限（来自 TeamModeConfig.maxDiscussionRounds，缺省 6） */
  maxRounds: number
}

export interface AppendMessageParams {
  id: string
  discussionId: string
  senderAgentId: string
  /** 定向目标；缺省 = 广播 */
  targetAgentId?: string | null
  roundIndex: number
  kind: TeamThreadMessageKind
  content: string
  /** 关联 dispatch（可选，用于回溯） */
  dispatchId?: string | null
  /** peer_message delivery；缺省/null = call 语义（兼容旧消息） */
  delivery?: TeamThreadMessageDelivery | null
}

export interface AdvanceRoundResult {
  discussion: TeamDiscussionRow
  /** 写入线程的 round_summary 消息行（content 取自 summary 参数） */
  summaryMessage: TeamThreadMessageRow | null
}

export interface ConcludeParams {
  /** 收尾原因；'concluded' = Host 显式收尾，'canceled' = 会话取消，'max_rounds' = 硬上限兜底 */
  reason: 'concluded' | 'canceled' | 'max_rounds'
}

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 当 TeamModeConfig.maxDiscussionRounds 缺省时使用的默认上限 */
export const DEFAULT_MAX_DISCUSSION_ROUNDS = 6

/** 硬上限（CLAUDE.md 与实施文档 Δ5 拍板值），传入更大值会被压回 20 */
export const HARD_MAX_DISCUSSION_ROUNDS = 20

/**
 * renderThreadForPrompt 的默认 token 预算。
 *
 * 旧值 1500 对「成员互发详细自我介绍」这类长消息严重不足：单条介绍就几千字，
 * 一条就吃光预算，导致成员看不到别人刚发的内容（真实 bug 现场）。配合下方单条
 * 预览上限（THREAD_MESSAGE_PREVIEW_CHARS），6000 token 约能容纳十余条预览。
 * 会话可经 TeamModeConfig.threadContextTokenBudget 覆盖。
 */
export const DEFAULT_THREAD_TOKEN_BUDGET = 6000

/**
 * 单条消息在共享线程快照里的最大字符数（预览窗口）。
 *
 * 关键修复：旧渲染循环遇到放不下的消息直接 `break` 整体放弃——若最新一条本身
 * 超预算，成员就只剩截断提示，看不到任何正文。现在每条先截到这个预览长度，
 * 全文改由 team_thread_read 工具按需读取，既保证「都能看到大意」又不撑爆上下文。
 * ~1800 字符 ≈ 600 token，足够看懂一条消息在说什么。
 */
export const THREAD_MESSAGE_PREVIEW_CHARS = 1800

/**
 * 粗略 token 估算系数：英文 ~4 chars/token，中文按 2 chars/token 估算更准；
 * 取折中 3 chars/token 兼顾中英文，宁可少给也别给超。
 */
const CHARS_PER_TOKEN = 3

// ─── Repository ──────────────────────────────────────────────────────────────

export class TeamDiscussionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'team_discussions')
  }

  /** 把外部传入的 maxRounds 钳到合法区间 [1, HARD_MAX_DISCUSSION_ROUNDS] */
  static clampMaxRounds(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value)) return DEFAULT_MAX_DISCUSSION_ROUNDS
    const n = Math.trunc(value)
    if (n < 1) return 1
    if (n > HARD_MAX_DISCUSSION_ROUNDS) return HARD_MAX_DISCUSSION_ROUNDS
    return n
  }

  /** 创建一场新讨论（state=active）。同 session 已有 active 讨论不在此处校验，由调用方决定延续还是新建。 */
  createDiscussion(params: CreateDiscussionParams): TeamDiscussionRow {
    const maxRounds = TeamDiscussionRepository.clampMaxRounds(params.maxRounds)
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO team_discussions
         (id, session_id, host_agent_id, topic, round_index, max_rounds, state, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(
        params.id,
        params.sessionId,
        params.hostAgentId,
        params.topic ?? null,
        0,
        maxRounds,
        now,
      )
    return super.findById<TeamDiscussionRow>(params.id)!
  }

  /** 按 ID 取讨论。 */
  getById(id: string): TeamDiscussionRow | null {
    return super.findById<TeamDiscussionRow>(id)
  }

  /** 取会话内当前 active 讨论（用户新 turn 延续同一讨论的查询路径）。 */
  findActiveBySession(sessionId: string): TeamDiscussionRow | null {
    return (
      (this.raw
        .prepare(
          `SELECT * FROM team_discussions
           WHERE session_id = ? AND state = 'active'
           ORDER BY started_at DESC LIMIT 1`,
        )
        .get(sessionId) as TeamDiscussionRow | undefined) ?? null
    )
  }

  /** 列出会话的全部讨论（最新优先）。 */
  listBySession(sessionId: string, limit = 50): TeamDiscussionRow[] {
    return this.raw
      .prepare(
        'SELECT * FROM team_discussions WHERE session_id = ? ORDER BY started_at DESC LIMIT ?',
      )
      .all(sessionId, limit) as TeamDiscussionRow[]
  }

  /**
   * 推进一轮：round_index + 1，并把 summary 写入线程（kind=round_summary）。
   *
   * 拒绝路径（返回 null）：
   *  - 讨论不存在或非 active
   *  - 新轮序号超出 max_rounds（后端硬拦截，防 caller 忘了校验）
   *
   * @param summary 本轮小结文本（来自 team_round_advance 工具入参）。空字符串则不写 round_summary 行。
   * @param messageId round_summary 消息的 ID（caller 生成）
   */
  advanceRound(
    discussionId: string,
    summary: string,
    messageId: string,
  ): AdvanceRoundResult | null {
    const discussion = super.findById<TeamDiscussionRow>(discussionId)
    if (!discussion) return null
    if (discussion.state !== 'active') return null

    const nextRound = discussion.round_index + 1
    // 硬上限兜底（即便 caller 已校验，这里再防一道）
    if (nextRound > discussion.max_rounds) return null

    this.raw
      .prepare('UPDATE team_discussions SET round_index = ? WHERE id = ?')
      .run(nextRound, discussionId)

    let summaryMessage: TeamThreadMessageRow | null = null
    if (summary && summary.trim().length > 0) {
      this.appendMessage({
        id: messageId,
        discussionId,
        senderAgentId: discussion.host_agent_id,
        roundIndex: nextRound,
        kind: 'round_summary',
        content: summary,
      })
      summaryMessage = this.findMessageById(messageId)
    }

    return {
      discussion: super.findById<TeamDiscussionRow>(discussionId)!,
      summaryMessage,
    }
  }

  /**
   * 收尾讨论。
   *
   * reason='concluded' → state='concluded'；
   * reason='canceled' / 'max_rounds' → state='canceled'。
   * 已收尾的讨论再次调用是 no-op（返回当前行）。
   */
  conclude(discussionId: string, params: ConcludeParams): TeamDiscussionRow | null {
    const discussion = super.findById<TeamDiscussionRow>(discussionId)
    if (!discussion) return null
    if (discussion.state !== 'active') return discussion

    const state: TeamDiscussionState = params.reason === 'concluded' ? 'concluded' : 'canceled'
    const now = new Date().toISOString()
    this.raw
      .prepare('UPDATE team_discussions SET state = ?, ended_at = ? WHERE id = ?')
      .run(state, now, discussionId)
    return super.findById<TeamDiscussionRow>(discussionId)!
  }

  /** 追加一条消息到讨论线程。 */
  appendMessage(params: AppendMessageParams): TeamThreadMessageRow {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO team_thread_messages
         (id, discussion_id, sender_agent_id, target_agent_id, round_index,
          kind, content, dispatch_id, delivery, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.id,
        params.discussionId,
        params.senderAgentId,
        params.targetAgentId ?? null,
        params.roundIndex,
        params.kind,
        params.content,
        params.dispatchId ?? null,
        params.delivery ?? null,
        now,
      )
    return this.findMessageById(params.id)!
  }

  /** 取单条线程消息。 */
  findMessageById(messageId: string): TeamThreadMessageRow | null {
    const row = this.raw
      .prepare('SELECT * FROM team_thread_messages WHERE id = ?')
      .get(messageId) as TeamThreadMessageRow | undefined
    return row ?? null
  }

  /**
   * 列出某时间点之后新写入的对等消息（peer_message），最早优先。
   *
   * 用途：定向 call / dispatch 触发的成员在其 turn 内向共享讨论广播的消息，调用方拿到的
   * 工具结果里只有对方最终回复、看不到这些广播——本方法让 handler 把「对方执行期间还在
   * 群里发的话」增量回流给调用方，堵住「以为队友没发」的上下文断层。
   *
   * @param sinceIso 排他下界（created_at > sinceIso）；传调用发起前的时间戳。
   */
  listPeerMessagesSince(discussionId: string, sinceIso: string, limit = 50): TeamThreadMessageRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM team_thread_messages
         WHERE discussion_id = ? AND kind = 'peer_message' AND created_at > ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(discussionId, sinceIso, limit) as TeamThreadMessageRow[]
  }

  /** 列出讨论的全部线程消息（最早优先）。 */
  listMessages(discussionId: string, limit = 200): TeamThreadMessageRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM team_thread_messages
         WHERE discussion_id = ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(discussionId, limit) as TeamThreadMessageRow[]
  }

  /** 统计讨论内已有消息数（含 round_summary）。 */
  countMessages(discussionId: string): number {
    const row = this.raw
      .prepare('SELECT COUNT(*) AS c FROM team_thread_messages WHERE discussion_id = ?')
      .get(discussionId) as { c: number }
    return row.c
  }

  /**
   * 分页/过滤查询线程消息（team_thread_read 工具后端）。
   *
   * 与 renderThreadForPrompt（给 prompt 的截断快照）不同，这里返回**未截断**的行，
   * 由调用方（工具 handler）决定如何呈现——用途是让 agent 主动「翻聊天记录」拿全文。
   *
   * 全部值仍走参数绑定（禁止把值拼进 SQL）；WHERE 子句按可选过滤条件组合。
   *
   * @returns messages（按 order 排序后的当页）+ total（过滤后的总条数，供分页提示）。
   */
  queryMessages(params: {
    discussionId: string
    limit?: number
    offset?: number
    /** 只看某一轮 */
    roundIndex?: number
    /** 只看某个发送者发出的消息 */
    senderAgentId?: string
    /** 排序：asc = 最早优先（默认，读上下文顺序自然），desc = 最新优先 */
    order?: 'asc' | 'desc'
  }): { messages: TeamThreadMessageRow[]; total: number } {
    const clauses = ['discussion_id = ?']
    const filterValues: Array<string | number> = [params.discussionId]
    if (params.roundIndex != null) {
      clauses.push('round_index = ?')
      filterValues.push(params.roundIndex)
    }
    if (params.senderAgentId != null && params.senderAgentId.length > 0) {
      clauses.push('sender_agent_id = ?')
      filterValues.push(params.senderAgentId)
    }
    const where = clauses.join(' AND ')

    const totalRow = this.raw
      .prepare(`SELECT COUNT(*) AS c FROM team_thread_messages WHERE ${where}`)
      .get(...filterValues) as { c: number }

    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100)
    const offset = Math.max(params.offset ?? 0, 0)
    const direction = params.order === 'desc' ? 'DESC' : 'ASC'
    const messages = this.raw
      .prepare(
        `SELECT * FROM team_thread_messages WHERE ${where}
         ORDER BY created_at ${direction} LIMIT ? OFFSET ?`,
      )
      .all(...filterValues, limit, offset) as TeamThreadMessageRow[]

    return { messages, total: totalRow.c }
  }

  /**
   * 渲染共享线程为可拼进 prompt 的文本（按 token 预算截断）。
   *
   * 策略（实施文档 4.2 / 原方案 6.2）：
   *  1. 优先保留所有 round_summary（每轮小结是历史压缩锚点，单位 token 信息密度高）；
   *  2. 余下预算留给最近 N 条非 summary 消息（倒序累加，超出预算即停）；
   *  3. 若发生截断，前面加一行 `[older messages truncated]` 提示。
   *
   * @param tokenBudget 渲染上限（粗估，chars / 3）。默认 1500。
   * @returns 已渲染好的文本块；空线程返回空字符串（caller 自行决定要不要拼）。
   */
  renderThreadForPrompt(
    discussionId: string,
    tokenBudget: number = DEFAULT_THREAD_TOKEN_BUDGET,
    viewerAgentId?: string,
  ): string {
    const messages = this.listMessages(discussionId, 500)
    if (messages.length === 0) return ''

    const charBudget = Math.max(tokenBudget, 1) * CHARS_PER_TOKEN

    const summaries: TeamThreadMessageRow[] = []
    const nonSummaries: TeamThreadMessageRow[] = []
    const notesForViewer: TeamThreadMessageRow[] = []
    for (const m of messages) {
      if (m.kind === 'round_summary') summaries.push(m)
      else if (isNoteForViewer(m, viewerAgentId)) notesForViewer.push(m)
      else nonSummaries.push(m)
    }

    const rendered: string[] = []
    let used = 0
    let truncated = false

    // 先把所有 summary 渲染（轮次小结是低成本的"知道别人聊到哪了"锚点）
    for (const s of summaries) {
      const line = `# Round ${s.round_index} summary: ${truncateForPreview(s.content)}`
      if (used + line.length > charBudget) {
        // summary 自己就超预算的情况：尽量保留截断版
        if (rendered.length === 0) {
          const remain = Math.max(charBudget - used - 1, 0)
          rendered.push(line.slice(0, remain))
          used += remain
        }
        break
      }
      rendered.push(line)
      used += line.length + 1
    }

    // 余下预算留给最近 N 条非 summary 消息（倒序累加）。每条已被 formatThreadMessageLine
    // 截到预览上限，因此单条不会再吃光整个预算——旧实现「最新一条超预算 → 直接 break →
    // 成员什么正文都看不到」的最坏情况被这层截断消掉。
    const recent: string[] = []
    for (let i = nonSummaries.length - 1; i >= 0; i--) {
      const m = nonSummaries[i]!
      const line = formatThreadMessageLine(m)
      if (used + line.length > charBudget) {
        // 预算不足以再放整条：若目前一条正文都还没放进去，至少塞一个硬截断版，
        // 确保成员总能看到「最新消息」的开头，而不是只剩截断提示。
        if (recent.length === 0) {
          const remain = Math.max(charBudget - used - 1, 0)
          if (remain > 0) recent.unshift(line.slice(0, remain))
        }
        truncated = true
        break
      }
      recent.unshift(line)
      used += line.length + 1
    }
    if (recent.length < nonSummaries.length) truncated = true

    const parts: string[] = []
    if (truncated) parts.push('[older messages truncated]')
    parts.push(...rendered, ...recent)
    if (notesForViewer.length > 0) {
      parts.push('', '[Notes For You]')
      for (const note of notesForViewer) {
        parts.push(formatThreadMessageLine(note, '[NOTE FOR YOU] '))
      }
    }

    // 去掉末尾空行
    return parts.filter((s) => s.length > 0).join('\n')
  }

  /** 删除某 session 的所有讨论（含线程消息，由 ON DELETE CASCADE 级联）。 */
  deleteBySession(sessionId: string): number {
    const result = this.raw
      .prepare('DELETE FROM team_discussions WHERE session_id = ?')
      .run(sessionId)
    return result.changes
  }
}

// ─── 渲染辅助 ────────────────────────────────────────────────────────────────

function isNoteForViewer(m: TeamThreadMessageRow, viewerAgentId?: string): boolean {
  return (
    viewerAgentId != null &&
    m.kind === 'peer_message' &&
    m.delivery === 'note' &&
    m.target_agent_id === viewerAgentId
  )
}

function formatThreadMessageLine(m: TeamThreadMessageRow, prefix = ''): string {
  const target = m.target_agent_id ? ` → ${m.target_agent_id}` : ' → all'
  return `${prefix}[R${m.round_index}] ${m.sender_agent_id}${target}: ${truncateForPreview(m.content)}`
}

/**
 * 把单条消息正文截到预览上限。超出部分不丢，改为提示用 team_thread_read 读全文——
 * 这是「全员都能看到群里发生了什么」与「不撑爆每个成员上下文」之间的折中。
 */
function truncateForPreview(content: string): string {
  if (content.length <= THREAD_MESSAGE_PREVIEW_CHARS) return content
  const head = content.slice(0, THREAD_MESSAGE_PREVIEW_CHARS).trimEnd()
  const omitted = content.length - head.length
  return `${head}…〔省略 ${omitted} 字，用 team_thread_read(messageId) 读全文〕`
}

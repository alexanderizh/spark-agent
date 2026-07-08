/**
 * @module conversation-summarizer
 *
 * Compresses older dialogue entries into a concise structured summary
 * for long sessions, replacing the simple truncation approach.
 *
 * Strategy: extractive summarization — no LLM call needed.
 *   - Keep the last N entries verbatim (recent context)
 *   - For older entries, produce a compact summary capturing:
 *     - Topics discussed
 *     - Actions taken (tool calls, file changes)
 *     - Key decisions / conclusions
 *   - Cache the summary in DB for reuse across turns
 */

import type { EventRepository } from '@spark/storage'
import { SessionSummaryRepository } from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import crypto from 'node:crypto'

/** Max characters of recent entries to keep verbatim (beyond summary) */
const RECENT_ENTRIES_MAX_CHARS = 16_000
/** Entries older than this threshold are eligible for summarization */
const SUMMARIZATION_ENTRY_THRESHOLD = 20
/** Max characters per summary */
const MAX_SUMMARY_CHARS = 4_000
const MEMORY_EXTRACTION_CONTEXT_MAX_CHARS = 3_000

type DialogueEntry = { role: 'User' | 'Assistant'; content: string }

export interface SummarizationResult {
  /** The combined prompt text: summary prefix + recent entries */
  promptText: string
  /** Whether a new summary was generated and cached this turn */
  newlySummarized: boolean
  /** Token stats */
  stats: {
    summarizedEntryCount: number
    fromSeq: number
    toSeq: number
    tokensSaved: number
    summaryTokens: number
  }
}

/**
 * Build conversation history prompt with summarization support.
 *
 * 1. Load the cached summary (if any) from DB
 * 2. If the summary covers older entries, only include entries after its `summarized_to_seq`
 * 3. If entries exceed threshold and no summary exists, generate one and cache it
 */
export function buildConversationHistoryWithSummary(
  eventRepo: EventRepository,
  db: SparkDatabase,
  sessionId: string,
  currentSeq: number,
  options?: {
    /**
     * Team Mode：agentId → 显示名映射。提供后，team_member_message
     * 也会被纳入对话历史，并以 `[<name>] ...` 前缀标注发言者，
     * 让后续任意 agent（Host 或被 @ 的 Member）都能看到完整群聊上下文。
     */
    agentNameById?: Record<string, string>
  },
): { prompt: string | undefined; summarization?: SummarizationResult['stats'] } {
  const summaryRepo = new SessionSummaryRepository(db)

  const events = loadDialogueEvents(eventRepo, sessionId)

  const entries = buildDialogueEntries(events, options?.agentNameById)
  if (entries.length === 0) return { prompt: undefined }

  // Check for cached summary
  const cachedSummary = summaryRepo.getLatest(sessionId)

  // Split entries: old (to be summarized / already summarized) + recent (kept verbatim)
  const recentEntries = entries.slice(-Math.min(entries.length, 30))
  const oldEntries = entries.slice(0, entries.length - recentEntries.length)

  // If we have a cached summary covering the old entries, use it — but the cache
  // only covers the FIRST `summarized_entry_count` entries. As the conversation
  // grows, entries between the cache boundary and the recent window would form a
  // "hole" (neither summarized nor kept verbatim). We close that hole by either:
  //   (a) injecting the uncovered middle entries verbatim (small drift), or
  //   (b) regenerating the summary over all old entries (large drift).
  if (cachedSummary != null && oldEntries.length > 0) {
    const coveredCount = Math.min(cachedSummary.summarized_entry_count, oldEntries.length)
    const uncoveredOld = oldEntries.slice(coveredCount)
    if (uncoveredOld.length < SUMMARIZATION_ENTRY_THRESHOLD) {
      const recentText = formatEntriesWithinBudget(recentEntries, RECENT_ENTRIES_MAX_CHARS)
      const midText =
        uncoveredOld.length > 0
          ? formatEntriesWithinBudget(uncoveredOld, RECENT_ENTRIES_MAX_CHARS)
          : ''
      const combined = [
        '[Session History — Earlier Summary]',
        `The following is a condensed summary of ${cachedSummary.summarized_entry_count} earlier exchanges:`,
        cachedSummary.summary_text,
        ...(midText.length > 0
          ? [
              '',
              '[Additional Earlier Exchanges]',
              'Exchanges after the summary but before the recent window:',
              midText,
            ]
          : []),
        '',
        '[Recent Exchanges]',
        'The following are the most recent exchanges verbatim:',
        recentText,
      ].join('\n\n')
      return { prompt: combined }
    }
    // Large drift: fall through to regenerate a fresh summary covering all old
    // entries (and refresh the cache so the next turn starts from a tight base).
  }

  // If old entries are below threshold, just use the regular approach (no summarization)
  if (oldEntries.length < SUMMARIZATION_ENTRY_THRESHOLD) {
    return { prompt: buildPlainPrompt(entries) }
  }

  // Generate a new summary for old entries
  const summaryText = generateExtractiveSummary(oldEntries)

  // Estimate tokens saved
  const oldChars = oldEntries.reduce((sum, e) => sum + e.content.length, 0)
  const tokensSaved = Math.max(0, Math.ceil((oldChars - summaryText.length) / 3))
  const summaryTokens = Math.ceil(summaryText.length / 3)

  // Cache the summary
  summaryRepo.create({
    id: crypto.randomUUID(),
    sessionId,
    summaryTurnId: `summary-${currentSeq}`,
    summaryText,
    summarizedEntryCount: oldEntries.length,
    summarizedFromSeq: 0,
    summarizedToSeq: Math.max(0, currentSeq - recentEntries.length),
    estimatedTokens: summaryTokens,
  })

  const recentText = formatEntriesWithinBudget(recentEntries, RECENT_ENTRIES_MAX_CHARS)
  const combined = [
    '[Session History — Earlier Summary]',
    `The following is a condensed summary of ${oldEntries.length} earlier exchanges:`,
    summaryText,
    '',
    '[Recent Exchanges]',
    'The following are the most recent exchanges verbatim:',
    recentText,
  ].join('\n\n')

  return {
    prompt: combined,
    summarization: {
      summarizedEntryCount: oldEntries.length,
      fromSeq: 0,
      toSeq: Math.max(0, currentSeq - recentEntries.length),
      tokensSaved,
      summaryTokens,
    },
  }
}

/**
 * Build a short, bounded context block for memory extraction.
 *
 * This is intentionally smaller than the main conversation history prompt. The
 * extraction prompt treats it as pointer-resolution context only, so it should
 * help with phrases like "刚才那个方式" without becoming a second source of
 * memories by itself.
 */
export function buildMemoryExtractionRecentContext(
  eventRepo: EventRepository,
  db: SparkDatabase,
  sessionId: string,
  currentSeq: number,
  options?: {
    agentNameById?: Record<string, string>
    maxChars?: number
  },
): string {
  const historyOptions = options?.agentNameById != null ? { agentNameById: options.agentNameById } : undefined
  const { prompt } = buildConversationHistoryWithSummary(eventRepo, db, sessionId, currentSeq, historyOptions)
  if (prompt == null || prompt.trim().length === 0) return ''

  const maxChars = Math.max(0, Math.floor(options?.maxChars ?? MEMORY_EXTRACTION_CONTEXT_MAX_CHARS))
  if (maxChars === 0) return ''

  const header = '[记忆抽取近期上下文]\n'
  const budget = Math.max(0, maxChars - header.length)
  const trimmed = prompt.length > budget ? prompt.slice(-budget) : prompt
  return `${header}${trimmed}`.slice(0, maxChars)
}

function loadDialogueEvents(eventRepo: EventRepository, sessionId: string): AgentEvent[] {
  // SQL 层已排除 delta 行（见 EventRepository.queryDialogueEvents），这里拿到的
  // assistant/member 行均为 mode='complete'，不会被 delta 挤占配额。
  const rows = eventRepo.queryDialogueEvents(sessionId, 400)
  const byId = new Map<string, AgentEvent>()
  for (const row of rows) {
    try {
      const event = JSON.parse(row.event_json) as AgentEvent
      byId.set(event.id, event)
    } catch {
      // ignore malformed historical rows
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.seq - b.seq)
}

/**
 * Generate an extractive summary from old dialogue entries.
 *
 * Strategy:
 * - Extract topics from user messages (first line of each)
 * - Extract actions from assistant messages (tool calls, file changes)
 * - Group into a structured summary
 */
function generateExtractiveSummary(entries: DialogueEntry[]): string {
  const topics: string[] = []
  const actions: string[] = []
  const decisions: string[] = []

  for (const entry of entries) {
    const firstLine = entry.content.split('\n')[0]?.trim() ?? ''
    if (firstLine.length === 0) continue

    if (entry.role === 'User') {
      // Keep user intent from first line
      const topic = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine
      if (!topics.includes(topic)) {
        topics.push(topic)
      }
    } else {
      // Extract key actions from assistant messages
      const lines = entry.content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        // Detect file operations
        if (trimmed.includes('file') || trimmed.includes('File')) {
          if (actions.length < 20) actions.push(trimmed.slice(0, 100))
        }
        // Detect decisions/conclusions
        if (
          trimmed.toLowerCase().startsWith('done') ||
          trimmed.toLowerCase().startsWith('completed') ||
          trimmed.toLowerCase().startsWith('fixed') ||
          trimmed.toLowerCase().startsWith('added') ||
          trimmed.toLowerCase().startsWith('removed') ||
          trimmed.toLowerCase().startsWith('updated') ||
          trimmed.toLowerCase().startsWith('created')
        ) {
          if (decisions.length < 15) decisions.push(trimmed.slice(0, 100))
        }
      }
    }
  }

  const parts: string[] = []

  if (topics.length > 0) {
    parts.push(`Topics discussed:\n${topics.slice(0, 15).map((t) => `- ${t}`).join('\n')}`)
  }

  if (actions.length > 0) {
    parts.push(`Key actions taken:\n${actions.slice(0, 15).map((a) => `- ${a}`).join('\n')}`)
  }

  if (decisions.length > 0) {
    parts.push(`Outcomes:\n${decisions.slice(0, 10).map((d) => `- ${d}`).join('\n')}`)
  }

  const summary = parts.join('\n\n')
  if (summary.length > MAX_SUMMARY_CHARS) {
    return `${summary.slice(0, MAX_SUMMARY_CHARS - 12)}\n[summarized]`
  }
  return summary || '(Session history summarized)'
}

/**
 * Format recent entries within a character budget, trimming from the front.
 */
function formatEntriesWithinBudget(entries: DialogueEntry[], maxChars: number): string {
  let total = entries.reduce((sum, e) => sum + e.content.length + e.role.length + 4, 0)
  const selected = [...entries]
  while (selected.length > 0 && total > maxChars) {
    const removed = selected.shift()!
    total -= removed.content.length + removed.role.length + 4
  }

  return selected
    .map((entry) => {
      const content = entry.content.length > 4000
        ? `${entry.content.slice(0, 3990)}\n[truncated]`
        : entry.content
      return `${entry.role}: ${content}`
    })
    .join('\n\n')
}

/**
 * Standard plain prompt without summarization (fallback).
 */
function buildPlainPrompt(entries: DialogueEntry[]): string {
  const selected = entries.slice(-40)
  let total = selected.reduce((sum, e) => sum + e.content.length, 0)
  while (selected.length > 0 && total > 24_000) {
    const removed = selected.shift()!
    total -= removed.content.length
  }

  const transcript = selected
    .map((entry) => {
      const content = entry.content.length > 4000
        ? `${entry.content.slice(0, 3990)}\n[truncated]`
        : entry.content
      return `${entry.role}: ${content}`
    })
    .join('\n\n')

  return [
    '[Session History]',
    'The following transcript is persisted from earlier turns in this same session. Use it as conversation context for the current user message. Do not restate it unless it is relevant.',
    transcript,
  ].join('\n\n')
}

// ─── Shared dialogue entry builder ──────────────────────────────────────────

function buildDialogueEntries(
  events: AgentEvent[],
  agentNameById?: Record<string, string>,
): DialogueEntry[] {
  // 按 segment 聚合的文本累加器：bySegment 同段覆盖（complete 多次到达取最后一次），
  // order 保留段首次出现顺序，looseParts 收集无 segmentId 的历史 complete（兜底）。
  type SegmentAccum = {
    bySegment: Map<string, string>
    order: string[]
    looseParts: string[]
    final?: string
  }
  const newSegmentAccum = (): SegmentAccum => ({
    bySegment: new Map(),
    order: [],
    looseParts: [],
  })
  const addSegment = (
    acc: SegmentAccum,
    content: string,
    segmentId: string | undefined,
    isFinal: boolean,
  ): void => {
    if (isFinal) {
      acc.final = content
      return
    }
    if (segmentId != null) {
      if (!acc.bySegment.has(segmentId)) acc.order.push(segmentId)
      acc.bySegment.set(segmentId, content)
    } else {
      acc.looseParts.push(content)
    }
  }
  const resolveSegmentText = (acc: SegmentAccum): string => {
    const segParts = acc.order
      .map((id) => acc.bySegment.get(id) ?? '')
      .filter((t) => t.trim().length > 0)
    if (segParts.length > 0) return segParts.join('\n').trim()
    if (acc.final != null) return acc.final.trim()
    return acc.looseParts.join('\n').trim()
  }

  type MemberDispatch = {
    memberAgentId: string
    accum: SegmentAccum
    order: number
  }
  const turns = new Map<
    string,
    {
      userParts: string[]
      userMentionAgentId?: string
      snapshotUserMessage?: string
      assistant: SegmentAccum
      memberByDispatch: Map<string, MemberDispatch>
      memberOrderCounter: number
    }
  >()
  const turnOrder: string[] = []

  const getTurn = (turnId: string) => {
    let turn = turns.get(turnId)
    if (turn == null) {
      turn = {
        userParts: [],
        assistant: newSegmentAccum(),
        memberByDispatch: new Map(),
        memberOrderCounter: 0,
      }
      turns.set(turnId, turn)
      turnOrder.push(turnId)
    }
    return turn
  }

  const resolveName = (agentId: string): string => {
    const name = agentNameById?.[agentId]?.trim()
    return name != null && name.length > 0 ? name : agentId
  }

  for (const event of events) {
    if (
      event.type !== 'user_message' &&
      event.type !== 'assistant_message' &&
      event.type !== 'turn_prompt_snapshot' &&
      event.type !== 'team_member_message'
    )
      continue
    const turn = getTurn(event.turnId)
    if (event.type === 'turn_prompt_snapshot') {
      const userMessage = event.userMessage.trim()
      if (userMessage.length > 0) turn.snapshotUserMessage = userMessage
      continue
    }
    if (event.type === 'user_message') {
      turn.userParts.push(event.content)
      if (event.mentionAgentId != null && event.mentionAgentId.length > 0) {
        turn.userMentionAgentId = event.mentionAgentId
      }
      continue
    }
    if (event.type === 'team_member_message') {
      // delta 已在 SQL 层排除；这里只处理 complete 段
      if (event.mode !== 'complete') continue
      let dispatch = turn.memberByDispatch.get(event.dispatchId)
      if (dispatch == null) {
        dispatch = {
          memberAgentId: event.memberAgentId,
          accum: newSegmentAccum(),
          order: turn.memberOrderCounter++,
        }
        turn.memberByDispatch.set(event.dispatchId, dispatch)
      }
      addSegment(dispatch.accum, event.content, event.segmentId, event.isFinal)
      continue
    }
    // assistant_message：delta 已在 SQL 层排除，只聚合 complete 段
    if (event.mode !== 'complete') continue
    addSegment(turn.assistant, event.content, event.segmentId, event.isFinal)
  }

  const entries: DialogueEntry[] = []
  for (const turnId of turnOrder) {
    const turn = turns.get(turnId)
    if (turn == null) continue
    const rawUserContent =
      turn.snapshotUserMessage?.trim() || turn.userParts.join('\n').trim() || ''
    if (rawUserContent.length > 0) {
      const mentionPrefix =
        turn.userMentionAgentId != null
          ? `(@${resolveName(turn.userMentionAgentId)}) `
          : ''
      entries.push({ role: 'User', content: `${mentionPrefix}${rawUserContent}` })
    }
    const assistantContent = resolveSegmentText(turn.assistant)
    if (assistantContent.length > 0) entries.push({ role: 'Assistant', content: assistantContent })
    // Member 发言按 dispatchId 聚合，前缀 [<name>] 标注发言者；按出现顺序追加。
    const dispatches = Array.from(turn.memberByDispatch.values()).sort((a, b) => a.order - b.order)
    for (const d of dispatches) {
      const text = resolveSegmentText(d.accum)
      if (text.length === 0) continue
      const speaker = resolveName(d.memberAgentId)
      entries.push({ role: 'Assistant', content: `[${speaker}] ${text}` })
    }
  }
  return entries
}

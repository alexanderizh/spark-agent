/**
 * Session 对话历史辅助纯函数（从 session.service.ts 拆分，D-13）。
 *
 * 包含：
 * - buildConversationHistoryPromptFromEvents：给定事件 → 拼装 prompt（导出供测试）
 * - buildDialogueEntries / joinHistoryParts：把事件拆成 User/Assistant 对话条目
 * - resolveProviderContextWindowFromProviderRow：从 ProviderProfileRow 解析 ctx 窗口
 * - computeHistoryTokenBudget / computeHistoryEntryTokenBudget：TOKEN 预算（D-06 动态化）
 * - limitHistoryContextEntries / truncateHistoryEntry：条目裁剪与单条截断
 *
 * 依赖：
 * - @spark/protocol 的 AgentEvent
 * - @spark/shared 的 estimateTokens / clipTextHeadTail / resolveProviderContextWindow
 *
 * session.service.ts 顶部 re-export `buildConversationHistoryPromptFromEvents`，
 * 保持测试与外部调用方的向后兼容。
 */

import type { AgentEvent } from '@spark/protocol'
import {
  clipTextHeadTail,
  estimateTokens,
  resolveModelContextWindowForProvider,
  resolveProviderContextWindow,
} from '@spark/shared'

const HISTORY_CONTEXT_ENTRY_LIMIT = 40
/**
 * 历史上下文总 token 预算。
 * 替换原 HISTORY_CONTEXT_MAX_CHARS = 24_000（按字符算 → 中英文差异巨大）；token 化后真实可控。
 */
const HISTORY_CONTEXT_MAX_TOKENS = 8_000
/** 单条 entry 的 token 上限，超过则头尾保留截断（替换旧的 4000 字符粗暴截断 D-01）。 */
const HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET = 1_500

export type DialogueEntry = { role: 'User' | 'Assistant'; content: string }

export interface ConversationHistoryPromptOptions {
  agentNameById?: Record<string, string>
  historyTokenBudget?: number
  entryTokenBudget?: number
  entryLimit?: number
}

export function buildConversationHistoryPromptFromEvents(
  events: AgentEvent[],
  options: ConversationHistoryPromptOptions = {},
): string | undefined {
  const transcript = formatDialogueEntriesWithinTokenBudget(
    buildDialogueEntries(events, options.agentNameById),
    options,
  )
  if (transcript.length === 0) return undefined

  return [
    '[Spark Session History]',
    'The following transcript is persisted from earlier turns in this same Spark session. Use it as conversation context for the current user message. Do not restate it unless it is relevant.',
    transcript,
  ].join('\n\n')
}

export function buildDialogueEntries(
  events: AgentEvent[],
  agentNameById?: Record<string, string>,
): DialogueEntry[] {
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
    accum: SegmentAccum,
    content: string,
    segmentId: string | undefined,
    isFinal: boolean,
  ): void => {
    if (isFinal) {
      accum.final = content
      return
    }
    if (segmentId != null) {
      if (!accum.bySegment.has(segmentId)) accum.order.push(segmentId)
      accum.bySegment.set(segmentId, content)
      return
    }
    accum.looseParts.push(content)
  }
  const resolveSegmentText = (accum: SegmentAccum): string => {
    const segmentParts = accum.order
      .map((id) => accum.bySegment.get(id) ?? '')
      .filter((text) => text.trim().length > 0)
    if (segmentParts.length > 0) return segmentParts.join('\n').trim()
    if (accum.final != null) return accum.final.trim()
    return accum.looseParts.join('\n').trim()
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
    if (event.mode !== 'complete') continue
    addSegment(turn.assistant, event.content, event.segmentId, event.isFinal)
  }

  const entries: DialogueEntry[] = []
  for (const turnId of turnOrder) {
    const turn = turns.get(turnId)
    if (turn == null) continue
    const rawUserContent =
      turn.snapshotUserMessage?.trim() || joinHistoryParts(turn.userParts) || ''
    if (rawUserContent.length > 0) {
      const mentionPrefix =
        turn.userMentionAgentId != null ? `(@${resolveName(turn.userMentionAgentId)}) ` : ''
      entries.push({ role: 'User', content: `${mentionPrefix}${rawUserContent}` })
    }
    const assistantContent = resolveSegmentText(turn.assistant)
    if (assistantContent.length > 0) entries.push({ role: 'Assistant', content: assistantContent })
    const dispatches = Array.from(turn.memberByDispatch.values()).sort(
      (left, right) => left.order - right.order,
    )
    for (const dispatch of dispatches) {
      const text = resolveSegmentText(dispatch.accum)
      if (text.length === 0) continue
      entries.push({
        role: 'Assistant',
        content: `[${resolveName(dispatch.memberAgentId)}] ${text}`,
      })
    }
  }
  return entries
}

export function joinHistoryParts(parts: string[]): string {
  return parts.join('\n').replace(/\s+\n/g, '\n').trim()
}

/**
 * 单一历史裁剪实现：先裁每条 entry，再按总 token 预算从最新记录向前选择。
 * 这样超长的最新 entry 会保留头尾，不会因为原始长度超预算而被整条移除。
 */
export function formatDialogueEntriesWithinTokenBudget(
  entries: DialogueEntry[],
  options: Pick<
    ConversationHistoryPromptOptions,
    'historyTokenBudget' | 'entryTokenBudget' | 'entryLimit'
  > = {},
): string {
  const historyTokenBudget = Math.max(
    1,
    Math.floor(options.historyTokenBudget ?? HISTORY_CONTEXT_MAX_TOKENS),
  )
  const entryTokenBudget = Math.max(
    1,
    Math.floor(options.entryTokenBudget ?? HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET),
  )
  const entryLimit = Math.max(1, Math.floor(options.entryLimit ?? HISTORY_CONTEXT_ENTRY_LIMIT))
  const formatted = entries.slice(-entryLimit).map((entry) => {
    const content = clipTextHeadTail(entry.content.trim(), entryTokenBudget)
    return `${entry.role}: ${content}`
  })

  const selected: string[] = []
  for (let index = formatted.length - 1; index >= 0; index -= 1) {
    const entry = formatted[index]
    if (entry == null) continue
    const candidate = [entry, ...selected].join('\n\n')
    if (estimateTokens(candidate) <= historyTokenBudget) {
      selected.unshift(entry)
      continue
    }
    if (selected.length === 0) {
      selected.push(clipTextHeadTail(entry, historyTokenBudget))
    }
    break
  }
  return selected.join('\n\n')
}

/**
 * 从 ProviderProfileRow 解析上下文窗口（D-06 动态化）。
 * 读 config_json 中的 supportsMillionContext / contextWindow 字段。
 */
export function resolveProviderContextWindowFromProviderRow(
  row: { config_json: string | null } | null | undefined,
  modelId?: string,
): number {
  if (row == null) return resolveProviderContextWindow(false)
  try {
    const config = JSON.parse(row.config_json ?? '{}') as {
      supportsMillionContext?: boolean
      contextWindow?: number
      modelContextWindows?: Record<string, number>
    }
    return resolveModelContextWindowForProvider(
      modelId,
      config.supportsMillionContext === true,
      typeof config.contextWindow === 'number' ? config.contextWindow : undefined,
      config.modelContextWindows,
    )
  } catch {
    return resolveProviderContextWindow(false)
  }
}

/**
 * 计算 history token 预算：contextWindow × 30%，上限 100k。
 * - 200k → 60k（取代旧的 8k 硬编码）
 * - 1M → 100k（capped，避免无意义膨胀）
 * - 128k → 38k
 * 留 70% 给 system prompt + project context + 工具结果 + 当前轮 user message + 输出。
 */
export function computeHistoryTokenBudget(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return HISTORY_CONTEXT_MAX_TOKENS
  }
  const budget = Math.floor(contextWindow * 0.3)
  return Math.max(HISTORY_CONTEXT_MAX_TOKENS, Math.min(100_000, budget))
}

/**
 * 计算单条 entry token 预算：contextWindow × 0.75%，上限 4k，下限 1k。
 * 单条 entry 过大没有意义（注意力分散），仅随上下文窗口小幅增长。
 */
export function computeHistoryEntryTokenBudget(contextWindow: number): number {
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET
  }
  const budget = Math.floor(contextWindow * 0.0075)
  return Math.max(1_000, Math.min(4_000, budget))
}

export function limitHistoryContextEntries(entries: DialogueEntry[]): DialogueEntry[] {
  const selected = entries.slice(-HISTORY_CONTEXT_ENTRY_LIMIT).map((entry) => ({
    ...entry,
    content: truncateHistoryEntry(entry.content),
  }))
  while (selected.length > 1) {
    const transcript = selected.map((entry) => `${entry.role}: ${entry.content}`).join('\n\n')
    if (estimateTokens(transcript) <= HISTORY_CONTEXT_MAX_TOKENS) break
    selected.shift()
  }
  return selected
}

export function truncateHistoryEntry(content: string): string {
  const normalized = content.trim()
  return clipTextHeadTail(normalized, HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET)
}

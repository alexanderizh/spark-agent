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

export function buildConversationHistoryPromptFromEvents(events: AgentEvent[]): string | undefined {
  const entries = limitHistoryContextEntries(buildDialogueEntries(events))
  if (entries.length === 0) return undefined

  const transcript = entries
    .map((entry) => `${entry.role}: ${truncateHistoryEntry(entry.content)}`)
    .join('\n\n')

  return [
    '[Spark Session History]',
    'The following transcript is persisted from earlier turns in this same Spark session. Use it as conversation context for the current user message. Do not restate it unless it is relevant.',
    transcript,
  ].join('\n\n')
}

export function buildDialogueEntries(events: AgentEvent[]): DialogueEntry[] {
  const turns = new Map<
    string,
    {
      userParts: string[]
      snapshotUserMessage?: string
      assistantParts: string[]
      assistantFinal?: string
    }
  >()
  const turnOrder: string[] = []

  const getTurn = (turnId: string) => {
    let turn = turns.get(turnId)
    if (turn == null) {
      turn = { userParts: [], assistantParts: [] }
      turns.set(turnId, turn)
      turnOrder.push(turnId)
    }
    return turn
  }

  for (const event of events) {
    if (
      event.type !== 'user_message' &&
      event.type !== 'assistant_message' &&
      event.type !== 'turn_prompt_snapshot'
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
      continue
    }
    if (event.mode === 'complete' && event.isFinal) {
      turn.assistantFinal = event.content
    } else {
      turn.assistantParts.push(event.content)
    }
  }

  const entries: DialogueEntry[] = []
  for (const turnId of turnOrder) {
    const turn = turns.get(turnId)
    if (turn == null) continue
    const userContent = turn.snapshotUserMessage?.trim() || joinHistoryParts(turn.userParts) || ''
    if (userContent.length > 0) entries.push({ role: 'User', content: userContent })
    const assistantContent = turn.assistantFinal?.trim() || joinHistoryParts(turn.assistantParts)
    if (assistantContent.length > 0) entries.push({ role: 'Assistant', content: assistantContent })
  }
  return entries
}

export function joinHistoryParts(parts: string[]): string {
  return parts.join('\n').replace(/\s+\n/g, '\n').trim()
}

/**
 * 从 ProviderProfileRow 解析上下文窗口（D-06 动态化）。
 * 读 config_json 中的 supportsMillionContext / contextWindow 字段。
 */
export function resolveProviderContextWindowFromProviderRow(
  row: { config_json: string | null } | null | undefined,
): number {
  if (row == null) return resolveProviderContextWindow(false)
  try {
    const config = JSON.parse(row.config_json ?? '{}') as {
      supportsMillionContext?: boolean
      contextWindow?: number
    }
    return resolveProviderContextWindow(
      config.supportsMillionContext === true,
      typeof config.contextWindow === 'number' ? config.contextWindow : undefined,
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
  const selected = entries.slice(-HISTORY_CONTEXT_ENTRY_LIMIT)
  let total = selected.reduce((sum, entry) => sum + estimateTokens(entry.content), 0)
  while (selected.length > 0 && total > HISTORY_CONTEXT_MAX_TOKENS) {
    const removed = selected.shift()
    total -= removed ? estimateTokens(removed.content) : 0
  }
  return selected
}

export function truncateHistoryEntry(content: string): string {
  const normalized = content.trim()
  return clipTextHeadTail(normalized, HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET)
}

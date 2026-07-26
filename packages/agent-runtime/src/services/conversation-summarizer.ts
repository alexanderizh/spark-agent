/**
 * @module conversation-history
 *
 * 对持久化事件做薄封装，按模型上下文窗口的 token 预算构造恢复提示词。
 * 不再生成或读取 Spark 自制的抽取式摘要；原生 SDK 的 resume/compaction 是唯一摘要层。
 * 文件名暂时保留以避免无关的模块路径 churn，导出的 API 已改为 history 语义。
 */

import type { EventRepository } from '@spark/storage'
import type { AgentEvent } from '@spark/protocol'
import { clipTextHeadTail, estimateTokens } from '@spark/shared'
import {
  buildDialogueEntries,
  formatDialogueEntriesWithinTokenBudget,
} from './session-history-helpers.js'

const MEMORY_EXTRACTION_CONTEXT_MAX_TOKENS = 1_000
/** 历史上下文 token 预算的默认上限（未传入时使用）。 */
const DEFAULT_HISTORY_TOKEN_BUDGET = 8_000
/** 单条 entry token 预算的默认上限（未传入时使用）。 */
const DEFAULT_ENTRY_TOKEN_BUDGET = 1_500
const DEFAULT_HISTORY_ENTRY_LIMIT = 240

/**
 * 构建会话历史提示词。历史只做 token 边界保护，不做二次摘要。
 */
export function buildConversationHistory(
  eventRepo: EventRepository,
  sessionId: string,
  options?: {
    /**
     * Team Mode：agentId → 显示名映射。提供后，team_member_message
     * 也会被纳入对话历史，并以 `[<name>] ...` 前缀标注发言者，
     * 让后续任意 agent（Host 或被 @ 的 Member）都能看到完整群聊上下文。
     */
    agentNameById?: Record<string, string>
    /**
     * 历史 token 预算（D-06 动态化）。未传时回落到 DEFAULT_HISTORY_TOKEN_BUDGET。
     * 推荐由调用方按 provider contextWindow 算（如 contextWindow × 0.3，上限 100k）。
     */
    historyTokenBudget?: number
    /**
     * 单条 entry token 预算（D-06 动态化）。未传时回落到 DEFAULT_ENTRY_TOKEN_BUDGET。
     */
    entryTokenBudget?: number
    /**
     * SDK resume 已接管历史时只注入较小的 recent fallback；SDK fresh fallback
     * 仍可依赖它恢复基本上下文。
     */
    skipForSdkResume?: boolean
  },
): { prompt: string | undefined } {
  const historyTokenBudget = Math.max(
    1_000,
    Math.floor(options?.historyTokenBudget ?? DEFAULT_HISTORY_TOKEN_BUDGET),
  )
  const entryTokenBudget = Math.max(
    200,
    Math.floor(options?.entryTokenBudget ?? DEFAULT_ENTRY_TOKEN_BUDGET),
  )
  const entries = buildDialogueEntries(
    loadDialogueEvents(eventRepo, sessionId),
    options?.agentNameById,
  )
  if (entries.length === 0) return { prompt: undefined }
  const isResumeFallback = options?.skipForSdkResume === true
  const transcript = formatDialogueEntriesWithinTokenBudget(entries, {
    historyTokenBudget: isResumeFallback
      ? Math.min(historyTokenBudget, Math.max(2_000, entryTokenBudget * 4))
      : historyTokenBudget,
    entryTokenBudget,
    entryLimit: isResumeFallback ? 30 : DEFAULT_HISTORY_ENTRY_LIMIT,
  })
  if (transcript.length === 0) return { prompt: undefined }

  return {
    prompt: isResumeFallback
      ? [
          '[Recent Exchanges — SDK resume fallback]',
          'SDK resume maintains the full conversation internally. These recent exchanges are',
          'only a fallback for an SDK fresh-session recovery. Do not restate unless relevant.',
          transcript,
        ].join('\n\n')
      : [
          '[Session History]',
          'The following transcript is persisted from earlier turns in this same session. Use it as conversation context for the current user message. Do not restate it unless relevant.',
          transcript,
        ].join('\n\n'),
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
  sessionId: string,
  options?: {
    agentNameById?: Record<string, string>
    maxTokens?: number
  },
): string {
  // Memory 抽取只需要 recent context，强制使用 SDK resume fallback 的小预算。
  const historyOptions: {
    agentNameById?: Record<string, string>
    skipForSdkResume?: boolean
  } = { skipForSdkResume: true }
  if (options?.agentNameById != null) {
    historyOptions.agentNameById = options.agentNameById
  }
  const { prompt } = buildConversationHistory(eventRepo, sessionId, historyOptions)
  if (prompt == null || prompt.trim().length === 0) return ''

  const header = '[记忆抽取近期上下文]\n'
  const maxTokens = Math.max(
    0,
    Math.floor(options?.maxTokens ?? MEMORY_EXTRACTION_CONTEXT_MAX_TOKENS),
  )
  if (maxTokens === 0) return ''
  const contentBudget = Math.max(0, maxTokens - estimateTokens(header))
  const content = clipTextHeadTail(prompt, contentBudget, { headRatio: 0.2 })
  return clipTextHeadTail(`${header}${content}`, maxTokens, { headRatio: 0.2 })
}

function loadDialogueEvents(eventRepo: EventRepository, sessionId: string): AgentEvent[] {
  // SQL 层已排除 delta 行（见 EventRepository.queryDialogueEvents），这里拿到的
  // assistant/member 行均为 mode='complete'，不会被 delta 挤占配额。
  const rows = eventRepo.queryDialogueEvents(sessionId, 1_000)
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

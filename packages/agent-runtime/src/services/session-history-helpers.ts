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

export type DialogueEntry = {
  role: 'User' | 'Assistant'
  content: string
  /** 整轮块标识：同 turnId 的连续条目构成一个裁剪单元，保证转写头部只落在整轮边界。 */
  turnId?: string
}

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
      entries.push({ role: 'User', content: `${mentionPrefix}${rawUserContent}`, turnId })
    }
    const assistantContent = resolveSegmentText(turn.assistant)
    if (assistantContent.length > 0) {
      entries.push({ role: 'Assistant', content: assistantContent, turnId })
    }
    const dispatches = Array.from(turn.memberByDispatch.values()).sort(
      (left, right) => left.order - right.order,
    )
    for (const dispatch of dispatches) {
      const text = resolveSegmentText(dispatch.accum)
      if (text.length === 0) continue
      entries.push({
        role: 'Assistant',
        content: `[${resolveName(dispatch.memberAgentId)}] ${text}`,
        turnId,
      })
    }
  }
  return entries
}

export function joinHistoryParts(parts: string[]): string {
  return parts.join('\n').replace(/\s+\n/g, '\n').trim()
}

/**
 * 锚定量子步长：被丢弃侧的前缀 token 水位按预算的 25% 量化，头部锚定在量子边界
 * 所在的整轮块上。水位在量子区间内增长时头部字节不动（前缀缓存跨轮命中）；越过
 * 边界时一次性跳到新锚点。块尺寸显著小于量子时跳幅 ≥2 块；单块 ≈ 量子的极端
 * 轮次退化为逐块移动，属可接受边界（详见 formatDialogueEntriesWithinTokenBudget）。
 */
const HISTORY_SHRINK_HYSTERESIS_FRACTION = 0.25

/**
 * 单一历史裁剪实现：先裁每条 entry，再按总 token 预算选择最新窗口。
 * 超长的最新 entry 会保留头尾，不会因为原始长度超预算而被整条移除。
 *
 * 缓存友好（P1-3）：条目按整轮 turnId 分块，裁剪只发生在整轮边界；头部锚定在
 * 被丢弃侧前缀水位的量子边界上——无压力时全部保留，有压力时多丢弃不足一个量子
 * 的历史换取跨轮字节稳定。硬预算以真实拼接串的精确测量兜底（含块间分隔符开销）。
 */
export function formatDialogueEntriesWithinTokenBudget(
  entries: DialogueEntry[],
  options: Pick<
    ConversationHistoryPromptOptions,
    'historyTokenBudget' | 'entryTokenBudget' | 'entryLimit'
  > = {},
): string {
  if (entries.length === 0) return ''
  const historyTokenBudget = Math.max(
    1,
    Math.floor(options.historyTokenBudget ?? HISTORY_CONTEXT_MAX_TOKENS),
  )
  const entryTokenBudget = Math.max(
    1,
    Math.floor(options.entryTokenBudget ?? HISTORY_CONTEXT_ENTRY_TOKEN_BUDGET),
  )
  const entryLimit = Math.max(1, Math.floor(options.entryLimit ?? HISTORY_CONTEXT_ENTRY_LIMIT))

  type HistoryBlock = { turnId?: string; texts: string[] }
  const formatted = entries.map((entry) => ({
    turnId: entry.turnId,
    text: `${entry.role}: ${clipTextHeadTail(entry.content.trim(), entryTokenBudget)}`,
  }))
  // 整轮分块：同 turnId 的连续条目构成一个收缩单元；无 turnId 的旧数据按单条目成块。
  const blocks: HistoryBlock[] = []
  for (const item of formatted) {
    const current = blocks[blocks.length - 1]
    if (item.turnId != null && current != null && current.turnId === item.turnId) {
      current.texts.push(item.text)
    } else {
      blocks.push({ texts: [item.text], ...(item.turnId != null ? { turnId: item.turnId } : {}) })
    }
  }
  const blockCount = blocks.length

  const blockTokens = blocks.map((block) => estimateTokens(block.texts.join('\n\n')))
  // 后缀和（近似口径：未计块间 '\n\n' 分隔符，最终以真实拼接串的精确测量复核）。
  const suffixTokens = new Array<number>(blockCount + 1).fill(0)
  const suffixEntries = new Array<number>(blockCount + 1).fill(0)
  for (let index = blockCount - 1; index >= 0; index -= 1) {
    suffixTokens[index] = (suffixTokens[index + 1] ?? 0) + (blockTokens[index] ?? 0)
    suffixEntries[index] = (suffixEntries[index + 1] ?? 0) + (blocks[index]?.texts.length ?? 0)
  }
  // 前缀和：P[i] = 前 i 块累计 token（被丢弃侧水位）。append-only 会话内 P[i] 对
  // 固定 i 恒定——与后缀和不同（后缀随新增轮次增长），是跨轮稳定的锚点来源。
  const prefixTokens = new Array<number>(blockCount + 1).fill(0)
  for (let index = 0; index < blockCount; index += 1) {
    prefixTokens[index + 1] = (prefixTokens[index] ?? 0) + (blockTokens[index] ?? 0)
  }

  // 最小可行头 F：其后全部条目同时满足 token 预算与条目数上限（硬约束）。
  let feasibleHead = 0
  while (
    feasibleHead < blockCount &&
    ((suffixTokens[feasibleHead] ?? 0) > historyTokenBudget ||
      (suffixEntries[feasibleHead] ?? 0) > entryLimit)
  ) {
    feasibleHead += 1
  }
  if (feasibleHead >= blockCount) {
    // 退化：最新单块即超限 → 硬裁剪最新块（与旧行为一致，至少保留最新内容）。
    const newest = blocks[blockCount - 1]
    if (newest == null) return ''
    return clipTextHeadTail(newest.texts.slice(-entryLimit).join('\n\n'), historyTokenBudget)
  }

  // 前缀水位量子锚定：把可行头的水位 P[F] 向上取整到下一个量子倍数 T，头部落在
  // T 所在的整轮块上。T 只依赖被丢弃侧的累计量、与新增轮次无关，因此 P[F] 在
  // 量子区间内缓慢增长时头部字节完全不动；越过边界时一次性跳到新锚点（常规块尺寸
  // << 量子时跳幅 >= 2 个整轮块；块 ≈ 量子的极端轮次退化为逐块移动，属可接受边界）。
  // 代价：多丢弃不足一个量子的历史换取跨轮稳定。两个安全阀：
  //   - 无压力（F = 0）时不锚定，全部保留——头部 = 0 本就最稳定；
  //   - 会话总量不足一个量子时无锚点可用，退化为最小可行头（该区间转写总量
  //     < 25% 预算，滑动的绝对代价很小，且与旧行为一致）。
  const quantum = Math.max(1, Math.floor(historyTokenBudget * HISTORY_SHRINK_HYSTERESIS_FRACTION))
  const anchorTarget = (Math.floor((prefixTokens[feasibleHead] ?? 0) / quantum) + 1) * quantum
  let head = feasibleHead
  if (feasibleHead > 0 && anchorTarget <= (prefixTokens[blockCount] ?? 0)) {
    while (head < blockCount - 1 && (prefixTokens[head] ?? 0) < anchorTarget) head += 1
  }

  // 精确复核：块间分隔符未计入近似和、tokenizer 对拼接非可加，用真实拼接串的
  // 整体测量逐块推进，保证硬预算（含分隔符）绝不超出。
  const joinFrom = (from: number): string =>
    blocks
      .slice(from)
      .map((block) => block.texts.join('\n\n'))
      .join('\n\n')
  let result = joinFrom(head)
  while (estimateTokens(result) > historyTokenBudget && head < blockCount - 1) {
    head += 1
    result = joinFrom(head)
  }
  // 兜底一：仅剩最新块仍超预算 → 硬裁剪（对齐旧行为，至少保留最新内容）。
  if (estimateTokens(result) > historyTokenBudget) {
    return clipTextHeadTail(result, historyTokenBudget)
  }
  // 兜底二：最新块自身条目数超限（head 无法再前进）→ 保留最新 entryLimit 条。
  if ((suffixEntries[head] ?? 0) > entryLimit) {
    const keptEntries = blocks
      .slice(head)
      .flatMap((block) => block.texts)
      .slice(-entryLimit)
    return clipTextHeadTail(keptEntries.join('\n\n'), historyTokenBudget)
  }
  return result
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

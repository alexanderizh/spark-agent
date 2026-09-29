/**
 * @module wiki-extraction-sampler
 *
 * 抽取采样与本地噪声过滤（S2，纯函数、可单测）。
 *
 * 成本模型（方案 §9.3）：抽取成本 ≈ 采样轮次数 × 轮均 token × 模型单价。
 * 本模块是唯一决定"喂多少给模型"的地方，因此把三类压缩全部做实：
 *   1. **增量**：只消费水位线（lastExtractedTurnIndex）之后的新增轮次，
 *      不整段重跑（幂等，也避免重复付费）。
 *   2. **本地噪声过滤**：寒暄 / 过短 / 无有效回复 / 隐藏内部轮次在送模型前
 *      筛掉——模型只该看"有意义片段"（结论、根因、取舍、可复用流程）。
 *   3. **总量封顶**：超量时按位置均匀抽样 + 单轮截断，单次请求有确定上界。
 *
 * 安全纪律（与标题抽取一致）：隐藏轮次只使用安全展示正文，绝不读取内部
 * prompt；工具调用与工具结果默认不进采样（纯噪声且体量最大）。
 */

import type { AgentEvent, AssistantMessageEvent, UserMessageEvent } from '@spark/protocol'

/** 单轮采样文本上限（超出截断；成本控制） */
export const WIKI_SAMPLE_TURN_MAX_CHARS = 1200
/** 单次抽取喂给模型的总字符上限（超出按位置均匀抽样） */
export const WIKI_SAMPLE_TOTAL_MAX_CHARS = 24_000
/** 低于该字符量的轮次视为无知识价值（寒暄 / 一句确认） */
export const WIKI_SAMPLE_MIN_MEANINGFUL_CHARS = 120
/** 均匀抽样的目标轮数上限 */
export const WIKI_SAMPLE_MAX_TURNS = 24

/** 跳过原因（进统计与日志，便于解释"为什么这段对话没抽出东西"） */
export type WikiSampleSkipReason = 'greeting' | 'too_short' | 'no_assistant' | 'internal_turn'

export interface WikiSampledTurn {
  /** 对话内轮次序号（从 1 开始，跨水位线稳定） */
  turnIndex: number
  user: string
  assistant: string
}

export interface WikiSampleStats {
  /** 会话总轮数（含被跳过与水位线之前的） */
  totalTurns: number
  /** 水位线之后的新增轮数 */
  newTurns: number
  /** 本地规则筛掉的轮数 */
  skipped: Record<WikiSampleSkipReason, number>
  /** 实际送入模型的轮数与字符量（成本归因） */
  sampledTurns: number
  sampledChars: number
  /** 是否触发均匀抽样（true 表示有轮次因总量上限被丢弃） */
  downsampled: boolean
}

export interface WikiSampleResult {
  turns: WikiSampledTurn[]
  stats: WikiSampleStats
}

interface RawTurn {
  turnIndex: number
  user: string
  assistant: string
}

/**
 * 从对话事件采样有意义轮次。
 *
 * @param events   会话对话事件（queryDialogueEvents 的结果，已按 seq 升序）
 * @param watermark 已抽取到的最大轮次序号（0 = 全量）；只返回其后的轮次
 */
export function sampleWikiExtractionTurns(events: AgentEvent[], watermark = 0): WikiSampleResult {
  const rawTurns = collectTurns(events)
  const newTurns = rawTurns.filter((turn) => turn.turnIndex > watermark)

  const skipped: Record<WikiSampleSkipReason, number> = {
    greeting: 0,
    too_short: 0,
    no_assistant: 0,
    internal_turn: 0,
  }
  const meaningful: WikiSampledTurn[] = []
  for (const turn of newTurns) {
    if (turn.assistant.trim().length === 0) {
      skipped.no_assistant += 1
      continue
    }
    if (isGreetingOnly(turn)) {
      skipped.greeting += 1
      continue
    }
    if (turn.user.length + turn.assistant.length < WIKI_SAMPLE_MIN_MEANINGFUL_CHARS) {
      skipped.too_short += 1
      continue
    }
    meaningful.push({
      turnIndex: turn.turnIndex,
      user: clip(turn.user, WIKI_SAMPLE_TURN_MAX_CHARS),
      assistant: clip(turn.assistant, WIKI_SAMPLE_TURN_MAX_CHARS),
    })
  }

  const fitted = fitToBudget(meaningful)
  const sampledChars = fitted.turns.reduce(
    (sum, turn) => sum + turn.user.length + turn.assistant.length,
    0,
  )

  return {
    turns: fitted.turns,
    stats: {
      totalTurns: rawTurns.length,
      newTurns: newTurns.length,
      skipped,
      sampledTurns: fitted.turns.length,
      sampledChars,
      downsampled: fitted.downsampled,
    },
  }
}

/** 把采样结果渲染成抽取 prompt 的正文（轮次编号即溯源 turnIndex）。 */
export function renderSampledTurns(turns: WikiSampledTurn[]): string {
  return turns
    .map((turn) => `[第${turn.turnIndex}轮]\n用户：${turn.user}\n助手：${turn.assistant}`)
    .join('\n\n')
}

/* ------------------------------------------------------------------ */
/* 内部实现                                                            */
/* ------------------------------------------------------------------ */

function collectTurns(events: AgentEvent[]): RawTurn[] {
  const turns = new Map<
    string,
    { firstSeq: number; user: string; snapshot: string; assistant: string[] }
  >()
  const ordered = [...events].sort((left, right) => left.seq - right.seq)

  for (const event of ordered) {
    const turnId = event.turnId || event.id
    let turn = turns.get(turnId)
    if (turn == null) {
      turn = { firstSeq: event.seq, user: '', snapshot: '', assistant: [] }
      turns.set(turnId, turn)
    }

    if (event.type === 'user_message') {
      const user = event as UserMessageEvent
      if (user.userMessageVisibility === 'hidden') {
        // 隐藏轮次（定时任务 / 内部 prompt）：只保留安全展示正文，读不到就空着。
        const safe = user.userMessageDisplayContent?.trim() ?? ''
        if (turn.user.length === 0) turn.user = safe
        continue
      }
      const content = (user.userMessageDisplayContent ?? user.content).trim()
      if (turn.user.length === 0 && content.length > 0) turn.user = content
      continue
    }

    if (event.type === 'turn_prompt_snapshot') {
      const snapshot = event as { userMessageVisibility?: string; userMessage?: string }
      if (snapshot.userMessageVisibility === 'hidden') continue
      if (turn.snapshot.length === 0) turn.snapshot = (snapshot.userMessage ?? '').trim()
      continue
    }

    if (event.type === 'assistant_message') {
      const assistant = event as AssistantMessageEvent
      if (assistant.mode !== 'complete') continue
      const content = (assistant.content ?? '').trim()
      if (content.length > 0) turn.assistant.push(content)
    }
  }

  const sorted = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq)
  return sorted.map((turn, index) => ({
    turnIndex: index + 1,
    user: turn.user.length > 0 ? turn.user : turn.snapshot,
    assistant: turn.assistant.join('\n'),
  }))
}

/** 纯寒暄轮：双方都短，且用户侧命中社交用语（感谢 / 确认 / 问候）。 */
function isGreetingOnly(turn: RawTurn): boolean {
  const user = turn.user.trim()
  if (user.length > 40) return false
  if (!GREETING_PATTERN.test(user)) return false
  return turn.assistant.trim().length <= 240
}

const GREETING_PATTERN =
  /^(你好|您好|hi|hello|hey|早|早上好|晚上好|晚安|谢谢|感谢|多谢|辛苦了|好的|好|行|可以|收到|嗯|哦|ok|okay|yes|no|不了|不用了|再见|bye)[!！。.~~\s]*$/i

function fitToBudget(turns: WikiSampledTurn[]): { turns: WikiSampledTurn[]; downsampled: boolean } {
  const totalChars = turns.reduce((sum, turn) => sum + turn.user.length + turn.assistant.length, 0)
  const withinBudget =
    totalChars <= WIKI_SAMPLE_TOTAL_MAX_CHARS && turns.length <= WIKI_SAMPLE_MAX_TURNS
  if (withinBudget) return { turns, downsampled: false }

  // 均匀抽样：保留首尾与中间等分位置，避免只反映开场内容。
  const cap = Math.min(WIKI_SAMPLE_MAX_TURNS, Math.max(4, Math.floor(turns.length / 2)))
  const picked = selectEvenly(turns, cap)
  // 仍超字符预算时从最早端丢弃（越早的轮次越可能是铺垫）。
  const fitted: WikiSampledTurn[] = []
  let used = 0
  for (let index = picked.length - 1; index >= 0; index -= 1) {
    const turn = picked[index]
    if (turn == null) continue
    const size = turn.user.length + turn.assistant.length
    if (used + size > WIKI_SAMPLE_TOTAL_MAX_CHARS && fitted.length > 0) continue
    fitted.unshift(turn)
    used += size
  }
  return { turns: fitted, downsampled: true }
}

function selectEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items
  if (maxItems <= 0) return []
  if (maxItems === 1) return items.slice(0, 1)
  const indices = new Set(
    Array.from({ length: maxItems }, (_, index) =>
      Math.round((index * (items.length - 1)) / (maxItems - 1)),
    ),
  )
  return [...indices]
    .sort((left, right) => left - right)
    .flatMap((index) => (items[index] === undefined ? [] : [items[index]]))
}

function clip(value: string, maxChars: number): string {
  const normalized = value.replace(/[ \t]+\n/g, '\n').trim()
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars)
}

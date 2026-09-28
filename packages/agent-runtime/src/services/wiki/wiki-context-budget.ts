/**
 * @module wiki-context-budget
 *
 * Wiki 上下文预算裁剪层（方案 §8 的落点）——「知识库不撑爆上下文」的执行者。
 *
 * 第一原则：零预注入。wiki 内容绝不进入常驻上下文；所有 Agent 侧读取
 * 必须经本层裁剪后才返回。裁剪是**服务端强制行为**，不依赖模型自觉：
 *   - 摘要硬截断（落库侧 ≤ summaryChars，返回侧再兜底）
 *   - top-K 上限（wiki_search 硬上限，Agent 不可越界）
 *   - 正文分页（wiki_read 单页 token 上限，超限 truncated + nextOffset 续读）
 *   - 回执瘦身（写回执只含 id/title/version，绝不复述 body）
 *   - 单轮总闸（同 turn 内 wiki 工具注入总量软上限，超限拒绝并提示先总结）
 *
 * 预算取值原则：省 token ≠ 极致压缩。先给足、再按观测收紧；宁可略宽，
 * 也不让正文被切碎导致反复翻页。默认值经 v1.2 评审放宽（3000/页、8000 总闸）。
 *
 * 设置项（wiki/budget/*，仅用户经可信 UI 可改）可调默认值，但本层的
 * HARD_* 常量为服务端兜底，任何来源的配置都不可超越。
 */

import { estimateTokens } from '@spark/shared'

/** 服务端硬上限（设置不可超越，防误设导致上下文爆炸） */
export const WIKI_BUDGET_HARD_LIMITS = {
  /** wiki_read 单页 token 硬上限 */
  readMaxTokens: 8000,
  /** 单轮 wiki 注入总闸硬上限 */
  turnTotal: 20000,
  /** wiki_search top-K 硬上限 */
  searchLimit: 20,
} as const

/** 预算档（全部来自设置或默认值，已在本层钳制到硬上限内） */
export interface WikiBudgetProfile {
  /** wiki_read 单页 token 上限（默认 3000） */
  readMaxTokens: number
  /** wiki_search 默认 top-K（默认 8） */
  searchLimit: number
  /** L2 摘要最大字数（默认 240） */
  summaryChars: number
  /** 单轮 wiki 注入总闸（默认 8000） */
  turnTotal: number
}

export const DEFAULT_WIKI_BUDGET: WikiBudgetProfile = {
  readMaxTokens: 3000,
  searchLimit: 8,
  summaryChars: 240,
  turnTotal: 8000,
}

/** 从设置读取构建预算档：未知/越界值回退默认并钳制到硬上限。 */
export function resolveWikiBudget(raw: {
  readMaxTokens?: unknown
  searchLimit?: unknown
  summaryChars?: unknown
  turnTotal?: unknown
}): WikiBudgetProfile {
  const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, Math.floor(n)))
  }
  return {
    readMaxTokens: clampInt(
      raw.readMaxTokens,
      DEFAULT_WIKI_BUDGET.readMaxTokens,
      1000,
      WIKI_BUDGET_HARD_LIMITS.readMaxTokens,
    ),
    searchLimit: clampInt(
      raw.searchLimit,
      DEFAULT_WIKI_BUDGET.searchLimit,
      3,
      WIKI_BUDGET_HARD_LIMITS.searchLimit,
    ),
    summaryChars: clampInt(raw.summaryChars, DEFAULT_WIKI_BUDGET.summaryChars, 60, 600),
    turnTotal: clampInt(
      raw.turnTotal,
      DEFAULT_WIKI_BUDGET.turnTotal,
      1000,
      WIKI_BUDGET_HARD_LIMITS.turnTotal,
    ),
  }
}

/** 摘要硬截断：超长追加省略号（落库侧与返回侧共用同一口径）。 */
export function clampSummary(summary: string, maxChars: number): string {
  if (summary.length <= maxChars) return summary
  return `${summary.slice(0, Math.max(0, maxChars - 1))}…`
}

export interface ClippedBody {
  body: string
  truncated: boolean
  /** 续读偏移（token 数；下一页从该偏移续读）。未截断时为 null。 */
  nextOffset: number | null
  tokens: number
}

/**
 * 字符安全边界修正：避免在代理对/组合字符中间切断。
 */
function safeCharBoundary(body: string, cut: number): number {
  let c = cut
  while (c > 0 && c < body.length && (body.charCodeAt(c) & 0xfc00) === 0xdc00) {
    c -= 1
  }
  return c
}

/**
 * 二分逼近：token 计数不超过 budget 的最大字符前缀长度。
 * estimateTokens 对字符前缀单调不减（前缀属性），二分收敛安全。
 */
function maxPrefixWithinTokens(body: string, budget: number): number {
  let lo = 0
  let hi = body.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (estimateTokens(body.slice(0, mid)) <= budget) lo = mid
    else hi = mid - 1
  }
  return safeCharBoundary(body, lo)
}

/**
 * 正文分页裁剪：按 token 精确切页（单页一次读懂优先，不足再 offset 翻页）。
 *
 * offset 语义：跳过正文的前 offsetTokens 个 token，从那里开始取一页。
 * 行边界偏好：断点回看最多 200 字符内的最后一个换行，避免返回半行。
 */
export function clipBody(body: string, maxTokens: number, offsetTokens = 0): ClippedBody {
  const total = estimateTokens(body)
  if (offsetTokens >= total) {
    return { body: '', truncated: false, nextOffset: null, tokens: 0 }
  }
  if (offsetTokens === 0 && total <= maxTokens) {
    return { body, truncated: false, nextOffset: null, tokens: total }
  }
  // 定位 offset 对应的字符起点
  let start = 0
  if (offsetTokens > 0) {
    start = maxPrefixWithinTokens(body, offsetTokens)
  }
  const rest = body.slice(start)
  const cut = maxPrefixWithinTokens(rest, maxTokens)
  let pageEnd = cut
  // 行边界偏好（仅在断点处生效，避免为对齐行界超出预算）
  const lastNewline = rest.lastIndexOf('\n', cut)
  if (lastNewline > 0) pageEnd = lastNewline + 1
  const page = rest.slice(0, pageEnd)
  const pageTokens = estimateTokens(page)
  return {
    body: page,
    truncated: start + pageEnd < body.length,
    nextOffset: offsetTokens + pageTokens,
    tokens: pageTokens,
  }
}

/**
 * 单轮总闸记账。按 sessionId 记录本 turn 内 wiki 类工具已注入的 token 量；
 * 超过 turnTotal 时拒绝继续读取（返回提示：先总结已读内容）。
 *
 * 记账键为 sessionId（turn 边界由会话生命周期自然界定；跨 turn 的清理
 * 通过 resetTurnBudget 在新 turn 开始时调用）。内存态即可——总闸的目的是
 * 阻止单轮失控，不做持久审计。
 */
const turnWikiTokens = new Map<string, number>()

/** 单轮总闸检查结果：拒绝时携带已用量供提示。 */
export type TurnWikiChargeResult = { allowed: true } | { allowed: false; used: number }

/** 记录并检查：本 turn 还可注入多少 wiki token。超限拒绝（提示先总结已读内容）。 */
export function chargeTurnWikiTokens(
  sessionId: string,
  tokens: number,
  budget: number,
): TurnWikiChargeResult {
  const used = turnWikiTokens.get(sessionId) ?? 0
  if (used + tokens > budget) {
    return { allowed: false, used }
  }
  turnWikiTokens.set(sessionId, used + tokens)
  return { allowed: true }
}

/** 新 turn 开始时重置该会话的 wiki 注入记账。 */
export function resetTurnWikiBudget(sessionId: string): void {
  turnWikiTokens.delete(sessionId)
}

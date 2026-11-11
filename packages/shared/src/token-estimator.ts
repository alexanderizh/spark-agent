/**
 * 单一事实源 token 估算器。
 *
 * 全项目 9 处魔法常数（chars/3、chars/4、chars×1.5+20）在这里统一替换为
 * gpt-tokenizer 的精确计数。
 *
 * 选型：gpt-tokenizer 的 o200k_base（GPT-4o 编码）。
 * - 对 OpenAI 模型（Codex 系列）准确。
 * - 对 Claude/Gemini/GLM 估算误差 5-15%，远好于字符常数（中文场景误差可达 50%+）。
 * - 不按 provider 切换编码：Claude/Gemini 没有公开 tokenizer，切换反而引入新不一致。
 */

import { encode, decode } from 'gpt-tokenizer'

/**
 * BPE 精确编码的字符上限：实测 o200k 对「同字符长串」（分隔线墙/重复字符墙，
 * BPE 最坏情况）呈超线性膨胀——5k 字符 85ms、12k 字符 575ms、35k 字符 >120s，
 * 会同步冻结事件循环；混合真实文本则极快（5.4k 字符 ~1ms）。超过该上限的
 * 输入不再走精确编码。
 *
 * 2026-11-11 卡死事故：executor 每轮 turn 用 estimateTokens 对完整 prompt
 * （含全部会话历史，长会话可达数十万字符）精确编码，主进程被连续冻住
 * 1~4 秒（main-block-profiles 实录 3811ms），压力升到 critical 后渲染进程
 * 被 SIGTRAP 终止、窗口假死。故 executor 等长 prompt 热路径必须显式使用有界估算。
 */
const EXACT_ENCODE_MAX_CHARS = 6_000

/**
 * 精确无界编码：保留既有 API 语义；预算裁剪、分页偏移、二分拟合等明确需要
 * **真实 token 数**的场景（如 session-history-helpers 的历史预算、wiki-context-budget
 * 的分页二分）也可用显式别名 estimateTokensExact 标明计量要求。
 *
 * 注意：病态长文本（同字符长串/分隔线墙）会超线性膨胀（35k 字符可 >120s）；
 * 对长度不可控的热路径，不要直接调用此函数，应显式改用 estimateTokensBounded。
 */
export function estimateTokens(text: string | null | undefined): number {
  if (text == null || text.length === 0) return 0
  return encode(text).length
}

/**
 * 保留显式精确 API，便于预算/分页调用点标明其真实 token 计量要求。
 */
export function estimateTokensExact(text: string | null | undefined): number {
  return estimateTokens(text)
}

/**
 * 有界 token 估算：
 * 输入不超过 exactMaxChars 时精确编码；超过时退化为保守字符数（不编码，O(1)）。
 *
 * 需要保护主线程的长输入调用点必须显式选用本函数；默认 estimateTokens 保持
 * 原精确语义，避免统计、预算和外部调用因全局默认行为变化而产生回归。
 * clipTextHeadTail 走自己的 encode 路径，不受此函数影响。
 */
export function estimateTokensBounded(
  text: string | null | undefined,
  exactMaxChars: number = EXACT_ENCODE_MAX_CHARS,
): number {
  if (text == null || text.length === 0) return 0
  if (text.length <= exactMaxChars) return encode(text).length
  return text.length
}

/**
 * 估算 token 数 + 每条 entry 的固定开销。
 *
 * 保留 memory-reader 旧实现 `Math.ceil(len * 1.5) + 20` 中 +20 的语义
 * （每条 entry 的 XML 标签/分隔符固定开销）。
 */
export function estimateTokensWithOverhead(
  text: string | null | undefined,
  overheadPerEntry = 0,
): number {
  return estimateTokens(text) + Math.max(0, overheadPerEntry)
}

/**
 * 头尾保留截断：保留 text 的前 headTokens + 后 tailTokens，中间插入省略号占位。
 *
 * 用于：
 * - 替换「4000 字符粗暴截断」（D-01）—— 后段信息完全丢失，对长 tool result 极不友好
 * - 对所有"过长但内有信息"的文本（entry/tool result/project doc）做可逆压缩
 *
 * 实现：用 encode() 拿到 token id 数组，slice 头尾后 decode 回文本。代价是 O(n)
 * 编码，但只在超过 budget 时才触发，热路径无影响。
 */
export function clipTextHeadTail(
  text: string,
  budgetTokens: number,
  opts: { headRatio?: number; ellipsis?: string } = {},
): string {
  if (text.length === 0) return text
  const normalizedBudget = Math.max(0, Math.floor(budgetTokens))
  if (normalizedBudget === 0) return ''
  const ids = encode(text)
  if (ids.length <= normalizedBudget) return text

  const headRatio = Math.max(0, Math.min(1, opts.headRatio ?? 0.6))
  const ellipsis = opts.ellipsis ?? '\n…[truncated middle]…\n'
  const ellipsisIds = encode(ellipsis)

  // 极小预算装不下占位符时优先保留正文开头，且仍严格遵守预算。
  if (ellipsisIds.length >= normalizedBudget) {
    return decode(ids.slice(0, normalizedBudget))
  }

  const contentBudget = normalizedBudget - ellipsisIds.length
  let headTokens = Math.floor(contentBudget * headRatio)
  if (contentBudget >= 2) {
    headTokens = Math.max(1, Math.min(contentBudget - 1, headTokens))
  }
  const tailTokens = contentBudget - headTokens
  const resultIds = [
    ...ids.slice(0, headTokens),
    ...ellipsisIds,
    ...(tailTokens > 0 ? ids.slice(ids.length - tailTokens) : []),
  ]
  return decode(resultIds)
}

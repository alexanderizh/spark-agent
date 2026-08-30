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

export function estimateTokens(text: string | null | undefined): number {
  if (text == null || text.length === 0) return 0
  return encode(text).length
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

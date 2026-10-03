/**
 * VoiceEchoGuard — ASR final vs 在播 TTS 文本的自回声守卫（全双工回声治理层 3）
 *
 * AEC 与能量门控之后仍可能漏进来的回声，在文本层做最后兜底：播报期捕获的
 * final 若与「正在播/待播/最近播完」的 TTS 句子高度相似，判为回声静默丢弃
 * （回声不是用户的错，不提示只记日志）。
 *
 * 判定规则（两条件任一命中即回声）：
 * 1. 转写归一化后是任一 TTS 句（或相邻两句拼接）的子串；
 * 2. 与任一 TTS 句的 bigram Dice 相似度 ≥ 0.7。
 * 短文本（归一化后 <6 字）不判定（误杀率不可控，交给层 2 能量门控）。
 * 「把第二句再念一遍」类祈使句有引导词、不满足子串条件，不会被误杀。
 */

/** 相似度阈值：低于此即使部分重合也不判回声（误杀代价 > 漏杀代价） */
const ECHO_SIMILARITY_THRESHOLD = 0.7
/** 参与判定的最短归一化长度 */
const MIN_GUARD_CHARS = 6
/** 相邻句拼接窗口：final 跨句边界的回声（AEC 残余常带上一句尾巴） */
const JOIN_WINDOW = 2

/**
 * 归一化：去标点/空白、全半角数字统一、小写化
 * （对齐 voiceCommands 的口语容错思路——只影响匹配，不改原文）
 */
export function normalizeForEchoMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[^\p{L}\p{N}]/gu, '')
}

/** bigram Dice 系数：0~1，1 = 完全相同的字符对集合 */
function bigramDiceSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const counts = new Map<string, number>()
  for (let i = 0; i + 1 < a.length; i += 1) {
    const gram = a.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  let overlap = 0
  for (let i = 0; i + 1 < b.length; i += 1) {
    const gram = b.slice(i, i + 2)
    const remaining = counts.get(gram) ?? 0
    if (remaining > 0) {
      counts.set(gram, remaining - 1)
      overlap += 1
    }
  }
  return (2 * overlap) / (a.length - 1 + b.length - 1)
}

/** 判定入口：transcript 是否像 ttsTexts 的回声 */
export function isLikelyTtsEcho(transcript: string, ttsTexts: string[]): boolean {
  const needle = normalizeForEchoMatch(transcript)
  if (needle.length < MIN_GUARD_CHARS) return false
  const normalized = ttsTexts.map((text) => normalizeForEchoMatch(text)).filter((t) => t.length > 0)
  // 条件 1：子串（含相邻句拼接窗口）
  for (let i = 0; i < normalized.length; i += 1) {
    if ((normalized[i] ?? '').includes(needle)) return true
    for (let join = 1; join <= JOIN_WINDOW && i + join < normalized.length; join += 1) {
      const joined = normalized.slice(i, i + join + 1).join('')
      if (joined.includes(needle)) return true
    }
  }
  // 条件 2：bigram Dice 相似度
  for (const candidate of normalized) {
    if (bigramDiceSimilarity(needle, candidate) >= ECHO_SIMILARITY_THRESHOLD) return true
  }
  return false
}

/** 守卫命中详情（日志用：最接近的 TTS 句长度与相似度） */
export function describeEchoMatch(
  transcript: string,
  ttsTexts: string[],
): {
  matchedTtsLen: number
  bestRatio: number
} {
  const needle = normalizeForEchoMatch(transcript)
  let matchedTtsLen = 0
  let bestRatio = 0
  for (const text of ttsTexts) {
    const candidate = normalizeForEchoMatch(text)
    if (candidate.length === 0) continue
    if (candidate.includes(needle)) matchedTtsLen = Math.max(matchedTtsLen, candidate.length)
    bestRatio = Math.max(bestRatio, bigramDiceSimilarity(needle, candidate))
  }
  return { matchedTtsLen, bestRatio: Number(bestRatio.toFixed(2)) }
}

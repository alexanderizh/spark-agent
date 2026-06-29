/**
 * 客户端全文检索：标题 / 描述 / 关键词 / 摘要 / 快速参考 / FAQ / TOC 标题。
 * 索引在运行时构建（首次调用时 lazy 加载所有主题正文），
 * 不引外部依赖，避免污染包体。
 */

import type { DocsTopicMeta } from '../content/docs'

export interface DocsSearchHit {
  topic: DocsTopicMeta
  /** 0~1 之间，越大越相关 */
  score: number
  /** 高亮片段：标题 / 描述 / 章节名 */
  highlights: Array<{ field: string; snippet: string }>
}

export interface DocsSearchIndexEntry {
  topic: DocsTopicMeta
  /** 检索字符串：标题 + 描述 + 关键词 + aiSummary + quickReference + faq + toc */
  haystack: string
  /** 分段的高亮锚点，命中后用于摘要展示 */
  fields: {
    title: string
    description: string
    keywords: string[]
    aiSummary: string
    tocTitles: string[]
    quickReference: Array<{ key: string; value: string }>
    faq: Array<{ question: string; answer: string }>
  }
}

let indexPromise: Promise<DocsSearchIndexEntry[]> | null = null

/**
 * 懒加载构建检索索引：
 *   - 顶层元数据来自 docs.ts（同步可用）
 *   - 完整正文通过 import('../content/docs-pages/<slug>') 按需拉取
 *   - 一旦构建过就缓存
 */
export async function buildDocsIndex(): Promise<DocsSearchIndexEntry[]> {
  if (indexPromise) return indexPromise
  indexPromise = (async () => {
    const { docsTopics } = await import('../content/docs')
    const entries: DocsSearchIndexEntry[] = []
    for (const topic of docsTopics) {
      try {
        const mod = await import(`../content/docs-pages/${topic.slug}.tsx`)
        const content = mod.default ?? mod[Object.keys(mod)[0]]
        if (!content) continue
        const fields: DocsSearchIndexEntry['fields'] = {
          title: topic.title,
          description: topic.description,
          keywords: topic.keywords,
          aiSummary: content.aiSummary ?? '',
          tocTitles: (content.toc ?? []).map((t: { title: string }) => t.title),
          quickReference: content.quickReference ?? [],
          faq: content.faq ?? [],
        }
        const haystack = [
          fields.title,
          fields.description,
          fields.keywords.join(' '),
          fields.aiSummary,
          fields.tocTitles.join(' '),
          fields.quickReference.map((qr) => `${qr.key} ${qr.value}`).join(' '),
          fields.faq.map((f) => `${f.question} ${f.answer}`).join(' '),
        ]
          .join(' \n ')
          .toLowerCase()
        entries.push({ topic, haystack, fields })
      } catch (err) {
        // 主题正文缺失时仍然保留元数据，方便在 DocsPage 看到导航
        console.warn(`[docs-search] missing content for topic: ${topic.slug}`, err)
      }
    }
    return entries
  })()
  return indexPromise
}

/**
 * 同步（轻量）检索 —— 只在元数据上搜索。
 * 用于 DocsPage 主题列表的快速过滤（无需加载正文）。
 */
export function searchTopicMetaSync(
  topics: DocsTopicMeta[],
  query: string,
): DocsTopicMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return topics
  return topics.filter((t) => {
    const blob = [t.title, t.description, t.detail, ...t.keywords].join(' ').toLowerCase()
    return blob.includes(q)
  })
}

function tokenize(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}
export { tokenize }

function scoreEntry(entry: DocsSearchIndexEntry, tokens: string[]): number {
  if (!tokens.length) return 0
  const { fields, haystack } = entry
  let score = 0
  let matchedAllTokens = true
  for (const tok of tokens) {
    let local = 0
    if (fields.title.toLowerCase().includes(tok)) local += 8
    if (fields.description.toLowerCase().includes(tok)) local += 4
    if (fields.keywords.some((k) => k.toLowerCase().includes(tok))) local += 3
    if (fields.tocTitles.some((t) => t.toLowerCase().includes(tok))) local += 2
    if (fields.aiSummary.toLowerCase().includes(tok)) local += 1.5
    if (
      fields.quickReference.some(
        (qr) =>
          qr.key.toLowerCase().includes(tok) || qr.value.toLowerCase().includes(tok),
      )
    )
      local += 1
    if (
      fields.faq.some(
        (f) => f.question.toLowerCase().includes(tok) || f.answer.toLowerCase().includes(tok),
      )
    )
      local += 1
    // haystack 是一个 fallback 兜底分
    if (local === 0) {
      if (haystack.includes(tok)) local += 0.4
      else matchedAllTokens = false
    }
    score += local
  }
  return matchedAllTokens ? score : score * 0.5
}

function makeSnippet(text: string, tokens: string[], max = 140): string {
  const lower = text.toLowerCase()
  let bestIdx = -1
  for (const t of tokens) {
    const idx = lower.indexOf(t)
    if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) bestIdx = idx
  }
  if (bestIdx === -1) return text.slice(0, max)
  const start = Math.max(0, bestIdx - 40)
  const end = Math.min(text.length, start + max)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

/**
 * 在文本中标记所有 token 的出现位置，返回分段数组（odd 段是普通文本，even 段是命中片段）。
 * 用于搜索结果里给命中的关键词包 <mark>。
 */
export function splitByTokens(
  text: string,
  tokens: string[],
): Array<{ text: string; matched: boolean }> {
  if (!tokens.length || !text) return [{ text, matched: false }]
  const lower = text.toLowerCase()
  // 收集所有命中区间
  const ranges: Array<[number, number]> = []
  for (const t of tokens) {
    if (!t) continue
    let from = 0
    while (from <= lower.length - t.length) {
      const idx = lower.indexOf(t, from)
      if (idx === -1) break
      ranges.push([idx, idx + t.length])
      from = idx + t.length
    }
  }
  if (!ranges.length) return [{ text, matched: false }]
  // 合并 + 排序
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e)
    } else {
      merged.push([s, e])
    }
  }
  // 切分
  const segments: Array<{ text: string; matched: boolean }> = []
  let cursor = 0
  for (const [s, e] of merged) {
    if (cursor < s) segments.push({ text: text.slice(cursor, s), matched: false })
    segments.push({ text: text.slice(s, e), matched: true })
    cursor = e
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false })
  return segments
}

export async function searchDocs(
  query: string,
  limit = 12,
): Promise<DocsSearchHit[]> {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const index = await buildDocsIndex()
  const hits: DocsSearchHit[] = []
  for (const entry of index) {
    const score = scoreEntry(entry, tokens)
    if (score <= 0) continue
    const highlights: DocsSearchHit['highlights'] = []
    if (entry.fields.title) highlights.push({ field: '标题', snippet: entry.fields.title })
    if (entry.fields.description)
      highlights.push({ field: '摘要', snippet: makeSnippet(entry.fields.description, tokens) })
    if (entry.fields.aiSummary)
      highlights.push({ field: '正文摘要', snippet: makeSnippet(entry.fields.aiSummary, tokens, 200) })
    const matchedToc = entry.fields.tocTitles.find((t) =>
      tokens.some((tok) => t.toLowerCase().includes(tok)),
    )
    if (matchedToc) highlights.push({ field: '章节', snippet: matchedToc })
    const matchedFaq = entry.fields.faq.find((f) =>
      tokens.some(
        (tok) => f.question.toLowerCase().includes(tok) || f.answer.toLowerCase().includes(tok),
      ),
    )
    if (matchedFaq) highlights.push({ field: 'FAQ', snippet: matchedFaq.question })
    hits.push({ topic: entry.topic, score, highlights })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

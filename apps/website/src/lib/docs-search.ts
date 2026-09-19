/**
 * 客户端全文检索。
 *
 * 索引来源是 docs-page-registry 里的正文组件本身：
 *   - 元数据（标题 / 描述 / 关键词）来自 docs.ts
 *   - 正文按 h2 / h3 切成「章节」，每个章节保留锚点 id 与纯文本
 *   - 章节标题、速查表、FAQ 一并进入检索字段
 *
 * 正文是纯展示 JSX（无 hooks / 无副作用），这里直接把组件当普通函数调用再遍历
 * 元素树取文本，因此不需要服务端渲染产物，dev 与 build 行为完全一致。
 * 若某个主题的正文遍历失败（例如将来引入了 hooks），该主题自动回退为「仅元数据」，
 * 不会让整体搜索失效。
 */

import type { ReactNode } from 'react'
import { docsTopics, type DocsTopicMeta } from '../content/docs'
import { docsPageRegistry } from '../content/docs-page-registry'

export interface DocsSearchHit {
  topic: DocsTopicMeta
  /** 越大越相关 */
  score: number
  /** 命中的章节锚点 id（无章节命中时为 undefined，链接落到主题页顶部） */
  anchorId?: string
  /** 命中章节的标题 */
  anchorTitle?: string
  /** 结果行展示用的摘要片段 */
  snippet: string
  /** 全部命中位置，供搜索页展示明细 */
  highlights: Array<{ field: string; snippet: string }>
}

export interface DocsSectionIndex {
  id: string
  title: string
  level: number
  text: string
}

export interface DocsSearchIndexEntry {
  topic: DocsTopicMeta
  /** 检索字符串：标题 + 描述 + 关键词 + aiSummary + 章节标题 + 章节正文 + 速查表 + FAQ */
  haystack: string
  /** 正文章节（含锚点），用于命中定位与深链 */
  sections: DocsSectionIndex[]
  fields: {
    title: string
    description: string
    keywords: string[]
    aiSummary: string
    quickReference: Array<{ key: string; value: string }>
    faq: Array<{ question: string; answer: string }>
  }
}

/* ------------------------------------------------------------------ *
 * 元素树取文本
 * ------------------------------------------------------------------ */

interface AnyElement {
  type: unknown
  props: Record<string, unknown>
}

function isElement(node: unknown): node is AnyElement {
  return typeof node === 'object' && node !== null && 'type' in node && 'props' in node
}

function isFragment(element: AnyElement): boolean {
  return typeof element.type === 'symbol'
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * 把 children 拍平成「章节切分单位」的节点数组。
 *
 * 展开规则：
 *   - 数组 / Fragment：拆开继续走
 *   - 原生非标题标签（div / section / p / ul / table …）：继续往下钻
 *     —— 文档页可能用 <div className="workflow-doc-page"> 之类的布局壳包住整篇正文，
 *        不钻进去的话整页只会被当成 1 个章节，本页目录与搜索深链就全废了
 *   - 标题标签：整块保留，作为章节边界
 *   - 自定义组件（Figure / WorkflowNode 这类）：整块保留，交给 textOf 取文本
 */
function flattenNodes(node: ReactNode, out: ReactNode[] = []): ReactNode[] {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) flattenNodes(child, out)
    return out
  }
  if (!isElement(node)) {
    out.push(node)
    return out
  }
  const isHostElement = typeof node.type === 'string'
  if (isFragment(node) || (isHostElement && !HEADING_TAGS.has(node.type as string))) {
    flattenNodes(node.props.children as ReactNode, out)
    return out
  }
  out.push(node)
  return out
}

/**
 * 递归取节点纯文本。
 * 自定义展示组件（如 workflow-usage 的 Figure / WorkflowNode）会被当作普通函数调用，
 * 以便把它们的文案一起纳入索引。
 */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (!isElement(node)) return ''
  const element = node
  if (typeof element.type === 'function') {
    try {
      const Component = element.type as (props: unknown) => ReactNode
      return textOf(Component(element.props))
    } catch {
      return ''
    }
  }
  return textOf(element.props.children as ReactNode)
}

/** 按 h2 / h3 把正文切成章节（保留锚点 id 与纯文本） */
function extractSections(body: ReactNode): DocsSectionIndex[] {
  const sections: DocsSectionIndex[] = []
  let current: DocsSectionIndex = { id: '', title: '', level: 2, text: '' }

  for (const node of flattenNodes(body)) {
    const tag = isElement(node) && typeof node.type === 'string' ? node.type : ''
    if (tag === 'h2' || tag === 'h3' || tag === 'h4') {
      if (current.text.trim() || current.title) sections.push(current)
      const level = tag === 'h2' ? 2 : tag === 'h3' ? 3 : 4
      current = {
        id: String((node as AnyElement).props.id ?? ''),
        title: collapse(textOf(node)),
        level,
        text: '',
      }
      continue
    }
    current.text += ` ${textOf(node)}`
  }
  if (current.text.trim() || current.title) sections.push(current)

  return sections.map((section) => ({ ...section, text: collapse(section.text) }))
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------ *
 * 索引
 * ------------------------------------------------------------------ */

let indexPromise: Promise<DocsSearchIndexEntry[]> | null = null

export async function buildDocsIndex(): Promise<DocsSearchIndexEntry[]> {
  if (indexPromise) return indexPromise
  indexPromise = Promise.resolve().then(() => {
    const entries: DocsSearchIndexEntry[] = []
    for (const topic of docsTopics) {
      const content = docsPageRegistry[topic.slug]
      if (!content) {
        console.warn(`[docs-search] missing content for topic: ${topic.slug}`)
        continue
      }

      let sections: DocsSectionIndex[] = []
      try {
        sections = extractSections(content.Body())
        // 声明了多个小节却只抽出 0~1 段，说明正文结构超出了遍历规则（例如新增了非原生包装组件），
        // 该篇的章节检索与深链会失效——这里主动告警，避免静默退化。
        if ((content.toc?.length ?? 0) > 1 && sections.filter((s) => s.title).length < 2) {
          console.warn(
            `[docs-search] topic "${topic.slug}" 的正文只解析出 ${sections.length} 段，` +
              `但 toc 声明了 ${content.toc?.length} 个小节；请检查 docs-search 的元素树遍历规则。`,
          )
        }
      } catch (error) {
        console.warn(`[docs-search] failed to extract body text for topic: ${topic.slug}`, error)
      }

      const fields: DocsSearchIndexEntry['fields'] = {
        title: topic.title,
        description: topic.description,
        keywords: topic.keywords,
        aiSummary: content.aiSummary ?? '',
        quickReference: content.quickReference ?? [],
        faq: content.faq ?? [],
      }

      const haystack = [
        fields.title,
        fields.description,
        topic.detail,
        fields.keywords.join(' '),
        fields.aiSummary,
        sections.map((s) => `${s.title} ${s.text}`).join(' \n '),
        fields.quickReference.map((qr) => `${qr.key} ${qr.value}`).join(' '),
        fields.faq.map((f) => `${f.question} ${f.answer}`).join(' '),
      ]
        .join(' \n ')
        .toLowerCase()

      entries.push({ topic, haystack, sections, fields })
    }
    return entries
  })
  return indexPromise
}

/**
 * 同步（轻量）检索 —— 只在元数据上搜索。
 * 用于 DocsPage 主题列表的快速过滤（无需加载正文）。
 */
export function searchTopicMetaSync(topics: DocsTopicMeta[], query: string): DocsTopicMeta[] {
  const q = query.trim().toLowerCase()
  if (!q) return topics
  return topics.filter((t) => {
    const blob = [t.title, t.description, t.detail, ...t.keywords].join(' ').toLowerCase()
    return blob.includes(q)
  })
}

export function tokenize(q: string): string[] {
  return q
    .trim()
    .toLowerCase()
    .split(/[\s,，、/]+/)
    .filter(Boolean)
}

/** 在文本中标记所有 token 的出现位置，返回分段数组（用于给命中关键词包 <mark>） */
export function splitByTokens(
  text: string,
  tokens: string[],
): Array<{ text: string; matched: boolean }> {
  if (!tokens.length || !text) return [{ text, matched: false }]
  const lower = text.toLowerCase()
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
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1]
    if (last && s <= last[1]) last[1] = Math.max(last[1], e)
    else merged.push([s, e])
  }
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

/** 统计 tokens 在文本中的命中次数（不区分大小写） */
function countHits(text: string, tokens: string[]): number {
  if (!text) return 0
  const lower = text.toLowerCase()
  let hits = 0
  for (const tok of tokens) {
    if (!tok) continue
    let from = 0
    while (from <= lower.length - tok.length) {
      const idx = lower.indexOf(tok, from)
      if (idx === -1) break
      hits += 1
      from = idx + tok.length
    }
  }
  return hits
}

/**
 * 章节标题与查询词的匹配强度。
 * 标题越短、命中占比越高得分越高，避免长标题靠包含关系压过精确命中。
 */
function scoreTitle(title: string, tokens: string[]): number {
  if (!title) return 0
  const lower = title.toLowerCase()
  let score = 0
  for (const tok of tokens) {
    if (!tok) continue
    if (lower === tok) score += 6
    else if (lower.includes(tok)) score += 3 - Math.min(2, lower.length / 60)
  }
  return score
}

function scoreEntry(entry: DocsSearchIndexEntry, tokens: string[]): number {
  if (!tokens.length) return 0
  const { fields, haystack, sections } = entry
  let score = 0
  let matchedAllTokens = true

  for (const tok of tokens) {
    let local = 0
    if (fields.title.toLowerCase().includes(tok)) local += 12
    if (fields.description.toLowerCase().includes(tok)) local += 4
    if (entry.topic.detail.toLowerCase().includes(tok)) local += 3
    if (fields.keywords.some((k) => k.toLowerCase().includes(tok))) local += 3
    if (fields.aiSummary.toLowerCase().includes(tok)) local += 1.5
    if (sections.some((s) => s.title.toLowerCase().includes(tok))) local += 4
    if (
      fields.quickReference.some(
        (qr) => qr.key.toLowerCase().includes(tok) || qr.value.toLowerCase().includes(tok),
      )
    )
      local += 1
    if (
      fields.faq.some(
        (f) => f.question.toLowerCase().includes(tok) || f.answer.toLowerCase().includes(tok),
      )
    )
      local += 1

    // 正文命中：按出现次数给分，单 token 封顶 6 分，避免长页面靠堆词刷分
    const bodyHits = sections.reduce((sum, s) => sum + countHits(s.text, [tok]), 0)
    if (bodyHits > 0) local += Math.min(6, 1 + Math.log2(bodyHits) * 1.6)

    if (local === 0) {
      if (haystack.includes(tok)) local += 0.4
      else matchedAllTokens = false
    }
    score += local
  }

  return matchedAllTokens ? score : score * 0.5
}

/** 在文本中截取包含首个命中词的片段 */
function makeSnippet(text: string, tokens: string[], max = 140): string {
  if (!text) return ''
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

/** 找到与查询词最相关的章节（用于深链锚点） */
function pickAnchor(sections: DocsSectionIndex[], tokens: string[]): DocsSectionIndex | undefined {
  let best: DocsSectionIndex | undefined
  let bestScore = 0
  for (const section of sections) {
    if (!section.id) continue
    const titleScore = scoreTitle(section.title, tokens) * 3
    const bodyScore = Math.min(4, countHits(section.text, tokens))
    const score = titleScore + bodyScore
    if (score > bestScore) {
      bestScore = score
      best = section
    }
  }
  return best
}

export async function searchDocs(query: string, limit = 12): Promise<DocsSearchHit[]> {
  const tokens = tokenize(query)
  if (!tokens.length) return []
  const index = await buildDocsIndex()
  const hits: DocsSearchHit[] = []

  for (const entry of index) {
    const score = scoreEntry(entry, tokens)
    if (score <= 0) continue

    const anchor = pickAnchor(entry.sections, tokens)
    const highlights: DocsSearchHit['highlights'] = []
    if (entry.fields.title) highlights.push({ field: '标题', snippet: entry.fields.title })
    if (entry.fields.description)
      highlights.push({ field: '摘要', snippet: makeSnippet(entry.fields.description, tokens) })
    if (entry.fields.aiSummary)
      highlights.push({
        field: '正文摘要',
        snippet: makeSnippet(entry.fields.aiSummary, tokens, 200),
      })
    if (anchor) highlights.push({ field: '章节', snippet: anchor.title })

    const matchedFaq = entry.fields.faq.find(
      (f) =>
        tokens.some((tok) => f.question.toLowerCase().includes(tok)) ||
        tokens.some((tok) => f.answer.toLowerCase().includes(tok)),
    )
    if (matchedFaq) highlights.push({ field: 'FAQ', snippet: matchedFaq.question })

    const anchorBody =
      anchor && countHits(anchor.text, tokens) > 0
        ? makeSnippet(anchor.text, tokens, 130)
        : makeSnippet(entry.fields.description, tokens, 120)

    hits.push({
      topic: entry.topic,
      score,
      anchorId: anchor?.id,
      anchorTitle: anchor?.title,
      snippet: anchorBody,
      highlights,
    })
  }

  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

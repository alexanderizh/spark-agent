/**
 * @module wiki-search.service
 *
 * Wiki 检索服务 — FTS5 BM25 检索 + 服务端强制裁剪（L2 级：只返回引用与摘要）。
 *
 * 硬规则（方案 §7.2/§8.4）：
 *   - 每条结果 ≤ 60 token（id + title + kind + summary≤240 字 + tags）
 *   - 默认 top-8，硬上限 20（Agent 传再大的 limit 也被钳制）
 *   - **绝不返回正文**——需要正文时必须走 wiki_read（L3），独立取用
 */

import { estimateTokens } from '@spark/shared'
import type { WikiPageKind } from '@spark/storage'
import { WikiSearchRepository } from '@spark/storage'
import { clampSummary, chargeTurnWikiTokens, type WikiBudgetProfile } from './wiki-context-budget.js'

export interface WikiSearchResultItem {
  id: string
  title: string
  kind: WikiPageKind
  summary: string
  tags: string[]
  tokens: number
}

export interface WikiSearchResult {
  items: WikiSearchResultItem[]
  total: number
  truncated: boolean
}

export class WikiSearchService {
  constructor(
    private readonly searchRepo: WikiSearchRepository,
    private readonly budget: WikiBudgetProfile,
  ) {}

  /**
   * Agent 检索入口（L2）。sessionId 用于单轮总闸记账。
   * 返回 null = 总闸已满（调用方提示先总结已读内容）。
   */
  searchForAgent(input: {
    sessionId: string
    query: string
    spaceIds: string[]
    kind?: WikiPageKind
    limit?: number
  }): WikiSearchResult | { gateExceeded: true; usedTokens: number } {
    const query = input.query.trim()
    if (query.length === 0) return { items: [], total: 0, truncated: false }

    // 服务端强制钳制：请求 limit 不可超越预算档（其本身已被硬上限钳制）
    const limit = Math.min(
      Math.max(input.limit ?? this.budget.searchLimit, 1),
      this.budget.searchLimit,
    )

    const hits = this.searchRepo.searchBm25(query, {
      spaceIds: input.spaceIds,
      ...(input.kind != null ? { kind: input.kind } : {}),
      limit,
    })
    if (hits.length === 0) return { items: [], total: 0, truncated: false }

    const items = hits.map((h) => {
      const item: WikiSearchResultItem = {
        id: h.page.id,
        title: h.page.title,
        kind: h.page.kind,
        // 返回侧摘要兜底截断（落库侧已 ≤ summaryChars，此处防旧数据/直写绕过）
        summary: clampSummary(h.page.summary, this.budget.summaryChars),
        tags: parseTags(h.page.tags_json),
        tokens: 0,
      }
      item.tokens = estimateTokens(JSON.stringify(item))
      return item
    })
    const totalTokens = items.reduce((s, i) => s + i.tokens, 0)

    // 单轮总闸：超限拒绝本次返回（宁可不查，不让上下文失控）
    const charge = chargeTurnWikiTokens(input.sessionId, totalTokens, this.budget.turnTotal)
    if (!charge.allowed) {
      return { gateExceeded: true, usedTokens: charge.used }
    }

    return { items, total: items.length, truncated: false }
  }

  /** IPC 检索入口（渲染端；同样经预算裁剪，但不过单轮总闸——用户主动检索不计入 Agent 注入）。 */
  search(input: {
    query: string
    spaceIds?: string[]
    kind?: WikiPageKind
    limit?: number
  }): WikiSearchResult {
    const query = input.query.trim()
    if (query.length === 0 || (input.spaceIds != null && input.spaceIds.length === 0)) {
      return { items: [], total: 0, truncated: false }
    }
    const limit = Math.min(Math.max(input.limit ?? this.budget.searchLimit, 1), this.budget.searchLimit)
    const hits = this.searchRepo.searchBm25(query, {
      ...(input.spaceIds != null ? { spaceIds: input.spaceIds } : {}),
      ...(input.kind != null ? { kind: input.kind } : {}),
      limit,
    })
    const items = hits.map((h) => ({
      id: h.page.id,
      title: h.page.title,
      kind: h.page.kind,
      summary: clampSummary(h.page.summary, this.budget.summaryChars),
      tags: parseTags(h.page.tags_json),
      tokens: 0,
    }))
    for (const item of items) item.tokens = estimateTokens(JSON.stringify(item))
    return { items, total: items.length, truncated: false }
  }
}

function parseTags(tagsJson: string): string[] {
  try {
    const parsed = JSON.parse(tagsJson) as unknown
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

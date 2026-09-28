/**
 * @module wiki-link.service
 *
 * Wiki 链接服务 — [[双链]] 解析、红链回填、显式关联与反向链接（L4 级）。
 *
 * 设计要点：
 *   - 正文是双链的唯一权威来源：页面每次提交后按新正文**整体重建**出边，
 *     而不是做增量 diff（重命名/删段落时增量会残留幽灵边）。
 *   - 红链（未创建目标）保留 to_title；目标页创建或改名时由 resolveRedLinks
 *     回填 to_page，来源页无需重写。
 *   - 归档：出边删除（内容退出图谱）、入边降级为红链（保留文本引用）。
 *   - 删除：双向边全部移除，不保留已删标题副本。
 *   - 反向链接为 L4 渐进披露末端，每边 ≤ 20 token（服务端裁剪，不依赖模型自觉）。
 *
 * 失败策略：链接是**派生数据**（正文才是权威）。同步失败只告警并如实回传
 * linksReady=false，不让已成功的页面写入变成异常；下次提交会重建。
 */

import { createLogger } from '@spark/shared'
import { WikiLinkRepository, WikiPageRepository } from '@spark/storage'
import { fitTitleToItemBudget } from './wiki-context-budget.js'

const log = createLogger('wiki:link')

/** 单页最多解析的双链数（防正文里塞入上千链接把图谱写爆） */
export const MAX_LINKS_PER_PAGE = 200

/** 反向链接单次返回的最大边数（L4 预算） */
export const MAX_BACKLINK_EDGES = 12

/** 反向链接单边 token 上限（标题超长时截断） */
export const BACKLINK_EDGE_TOKENS = 20

export interface ParsedWikiLink {
  /** [[ 与 ]] 之间的目标文本（已 trim，去重前，用于解析） */
  title: string
  /** [[目标|别名]] 的显示别名；无别名时为 null */
  label: string | null
}

/**
 * 解析正文中的 [[双链]]。
 * 支持 [[标题]] 与 [[标题|别名]]；忽略空标题、跨行内容与代码块内的转义写法 \[[。
 */
export function parseWikiLinks(body: string, max = MAX_LINKS_PER_PAGE): ParsedWikiLink[] {
  const out: ParsedWikiLink[] = []
  const seen = new Set<string>()
  const re = /\\?\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(body)) != null) {
    // 被反斜杠转义的 \[[ 视为字面文本，不建边
    if (match[0].startsWith('\\')) continue
    const title = match[1]!.trim()
    if (title.length === 0) continue
    const key = title.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ title, label: match[2]?.trim() ?? null })
    if (out.length >= max) break
  }
  return out
}

export type WikiBacklinkItem = {
  id: string
  title: string
  kind: string
  linkType: 'wiki' | 'reference'
  tokens: number
}

/** 双链同步结果：ok=false 表示派生数据写入失败（页面写入本身已成功）。 */
export type WikiLinkSyncResult =
  | { ok: true; count: number; redLinks: number }
  | { ok: false; count: number; redLinks: number }

export class WikiLinkService {
  constructor(
    private readonly pageRepo: WikiPageRepository,
    private readonly linkRepo: WikiLinkRepository,
  ) {}

  /**
   * 按正文重建某页的 [[双链]] 出边（页面提交成功后调用）。
   * 失败只告警——派生数据不得让主写入失败。
   */
  syncPageLinks(input: {
    spaceId: string
    pageId: string
    title: string
    body: string
  }): WikiLinkSyncResult {
    try {
      const parsed = parseWikiLinks(input.body)
      const index = this.pageRepo.listLinkIndex(input.spaceId)
      const bySlug = new Map<string, string>()
      const byTitle = new Map<string, string>()
      for (const row of index) {
        bySlug.set(row.slug.toLowerCase(), row.id)
        byTitle.set(row.title.toLowerCase(), row.id)
      }
      const links: Array<{ toPage: string | null; toTitle: string }> = []
      let redLinks = 0
      for (const link of parsed) {
        const target =
          bySlug.get(slugifyForLink(link.title)) ?? byTitle.get(link.title.toLowerCase()) ?? null
        // 自链整条丢弃：页面引用自己既不构成图关系，也不该沉淀成"待创建"红链
        // （保留成红链会让它永远挂在待创建列表里）。
        if (target === input.pageId) continue
        if (target == null) redLinks += 1
        links.push({ toPage: target, toTitle: link.title })
      }
      const count = this.linkRepo.replaceWikiLinks(input.spaceId, input.pageId, links)
      return { ok: true, count, redLinks }
    } catch (err) {
      log.warn(
        `wiki 双链同步失败（页面写入已成功，图谱缺该页出边）：page=${input.pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
      return { ok: false, count: 0, redLinks: 0 }
    }
  }

  /**
   * 目标页创建 / 改名后的红链回填（把空间内指向它的 NULL 边补上 to_page）。
   * 失败只告警（派生数据）。
   */
  claimRedLinks(input: { spaceId: string; pageId: string; slug: string; title: string }): number {
    try {
      const n = this.linkRepo.resolveRedLinks(input.spaceId, input.pageId, input.slug, input.title)
      if (n > 0) log.debug(`wiki 红链回填 ${n} 条 → page=${input.pageId}`)
      return n
    } catch (err) {
      log.warn(
        `wiki 红链回填失败：page=${input.pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
      return 0
    }
  }

  /** 归档：出边删除 + 入边降级为红链。 */
  onPageArchived(pageId: string): void {
    try {
      const outgoing = this.linkRepo.deleteOutgoing(pageId)
      const incoming = this.linkRepo.unpointIncoming(pageId)
      log.info(
        `wiki page archived，图谱边处理：出边 ${outgoing} 条已删除，入边 ${incoming} 条降级为红链`,
      )
    } catch (err) {
      log.warn(
        `wiki 归档时图谱边处理失败：page=${pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  /** 物理删除：双向边全部移除（不保留已删标题副本）。 */
  onPageDeleted(pageId: string): void {
    try {
      this.linkRepo.deleteByPage(pageId)
    } catch (err) {
      log.warn(
        `wiki 删除时图谱边清理失败：page=${pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  /**
   * 反向链接（L4）。服务端裁剪：最多 MAX_BACKLINK_EDGES 条，超长标题按
   * BACKLINK_EDGE_TOKENS 截断；返回 total 供调用方判断是否被截断。
   */
  backlinksForAgent(
    pageId: string,
    opts?: { limit?: number },
  ): { items: WikiBacklinkItem[]; total: number; truncated: boolean; tokens: number } {
    const total = this.linkRepo.countBacklinks(pageId)
    const limit = Math.min(Math.max(opts?.limit ?? MAX_BACKLINK_EDGES, 1), MAX_BACKLINK_EDGES)
    const hits = this.linkRepo.listBacklinks(pageId, limit)
    const items: WikiBacklinkItem[] = hits.map((h) => {
      const fitted = fitTitleToItemBudget(
        { id: h.fromPage, kind: h.fromKind, linkType: h.linkType, title: h.fromTitle },
        BACKLINK_EDGE_TOKENS,
      )
      return {
        id: h.fromPage,
        title: fitted.value,
        kind: h.fromKind,
        linkType: h.linkType,
        tokens: fitted.tokens,
      }
    })
    return {
      items,
      total,
      truncated: total > items.length,
      tokens: items.reduce((s, i) => s + i.tokens, 0),
    }
  }

  /** UI 侧反向链接（渲染端不受 Agent 预算约束，给全量与来源标题）。 */
  listBacklinksForUi(
    pageId: string,
    limit = 100,
  ): Array<{
    fromPage: string
    fromTitle: string
    fromKind: string
    linkType: 'wiki' | 'reference'
    createdAt: number
  }> {
    return this.linkRepo.listBacklinks(pageId, limit)
  }

  /** 建立 / 移除显式关联（reference 边）。同页/不存在等非法输入返回结构化失败。 */
  setReference(input: {
    fromPageId: string
    toPageId: string
    remove?: boolean
  }): { ok: true; changed: boolean } | { ok: false; message: string } {
    if (input.fromPageId === input.toPageId) {
      return { ok: false, message: '不能把页面关联到它自己' }
    }
    const from = this.pageRepo.getById(input.fromPageId)
    if (from == null || from.status === 'archived')
      return { ok: false, message: '来源页面不存在或已归档' }
    const to = this.pageRepo.getById(input.toPageId)
    if (to == null || to.status === 'archived')
      return { ok: false, message: '目标页面不存在或已归档' }
    if (from.space_id !== to.space_id) {
      return { ok: false, message: '首期只支持同空间内关联' }
    }
    if (input.remove === true) {
      return { ok: true, changed: this.linkRepo.removeReference(input.fromPageId, input.toPageId) }
    }
    return {
      ok: true,
      changed: this.linkRepo.insertReference(
        from.space_id,
        input.fromPageId,
        input.toPageId,
        to.title,
      ),
    }
  }
}

/** 链接解析时的 slug 口径（与 WikiWriteService.slugifyTitle 保持一致；此处独立实现避免循环依赖） */
function slugifyForLink(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*[\]#]/g, '')
    .toLowerCase()
}

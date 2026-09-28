/**
 * @module wiki-page.service
 *
 * 页面读取服务 — 正文分页读取（L3）+ 目录树（L1）+ 版本历史。
 *
 * 硬规则（方案 §8.4）：
 *   - wiki_read 单页 ≤ readMaxTokens token（默认 3000），超限 truncated + nextOffset
 *   - 单轮总闸：同 turn 内 wiki 注入总量超 turnTotal 拒绝继续读取
 *   - 命中计数 bumpHit 刻意不刷新 updated_at（防"越读越新"马太效应，同 memory）
 *   - content_hash 守卫：文件与 DB 指纹失配（CAS 失败留下的孤儿文件）拒绝采信
 */

import { createLogger } from '@spark/shared'
import { estimateTokens } from '@spark/shared'
import type { WikiPageRow } from '@spark/storage'
import { WikiPageRepository, WikiRevisionRepository, hashWikiBody } from '@spark/storage'
import { WikiStoreService } from './wiki-store.service.js'
import { clipBody, chargeTurnWikiTokens, type WikiBudgetProfile } from './wiki-context-budget.js'
import type { WikiPageVersionEntry } from '@spark/protocol'

const log = createLogger('wiki:page')

export interface WikiPageReadResult {
  id: string
  title: string
  version: number
  body: string
  truncated: boolean
  nextOffset: number | null
  tokens: number
}

export class WikiPageService {
  constructor(
    private readonly pageRepo: WikiPageRepository,
    private readonly revisionRepo: WikiRevisionRepository,
    private readonly store: WikiStoreService,
    private readonly budget: WikiBudgetProfile,
  ) {}

  /**
   * Agent 正文读取（L3）：分页 + 单轮总闸 + 守卫校验。
   * 返回 gateExceeded = 总闸已满；notFound / guardMismatch 走 error 语义。
   */
  async readForAgent(input: {
    sessionId: string
    pageId: string
    offset?: number
  }): Promise<
    | { ok: true; page: WikiPageReadResult }
    | { ok: false; error: 'not_found' | 'guard_mismatch' | 'gate_exceeded'; message: string }
  > {
    const page = this.pageRepo.getById(input.pageId)
    if (page == null || page.status === 'archived') {
      return { ok: false, error: 'not_found', message: '页面不存在或已归档' }
    }

    const body = await this.store.readBody(page.file_path).catch(() => null)
    if (body == null) {
      return { ok: false, error: 'not_found', message: '正文文件缺失' }
    }
    // 守卫：CAS 失败留下的孤儿新文件与 DB 指纹失配 → 拒绝采信（状态诚实）
    if (page.content_hash != null && hashWikiBody(body) !== page.content_hash) {
      log.warn(`wiki read guard mismatch: id=${page.id}（疑似 CAS 失败孤儿文件，拒绝采信）`)
      return {
        ok: false,
        error: 'guard_mismatch',
        message: '正文与索引指纹失配（并发写入未完成），请稍后重读',
      }
    }

    const offset = Math.max(0, Math.floor(input.offset ?? 0))
    const clipped = clipBody(body, this.budget.readMaxTokens, offset)
    if (clipped.tokens === 0 && offset === 0) {
      return { ok: true, page: { id: page.id, title: page.title, version: page.version, body: '', truncated: false, nextOffset: null, tokens: 0 } }
    }

    const charge = chargeTurnWikiTokens(input.sessionId, clipped.tokens, this.budget.turnTotal)
    if (!charge.allowed) {
      return {
        ok: false,
        error: 'gate_exceeded',
        message: `本会话本轮 wiki 注入已达 ${charge.used} token 上限，继续读取前请先总结已读内容`,
      }
    }

    this.pageRepo.bumpHit(page.id)
    return {
      ok: true,
      page: {
        id: page.id,
        title: page.title,
        version: page.version,
        body: clipped.body,
        truncated: clipped.truncated,
        nextOffset: clipped.nextOffset,
        tokens: clipped.tokens,
      },
    }
  }

  /** IPC 正文读取（渲染端，全量不分页——用户浏览不受 Agent 预算约束，但受守卫约束）。 */
  async readFull(pageId: string): Promise<
    | { ok: true; page: WikiPageRow; body: string }
    | { ok: false; error: 'not_found' | 'guard_mismatch'; message: string }
  > {
    const page = this.pageRepo.getById(pageId)
    if (page == null) return { ok: false, error: 'not_found', message: '页面不存在' }
    const body = await this.store.readBody(page.file_path).catch(() => null)
    if (body == null) return { ok: false, error: 'not_found', message: '正文文件缺失' }
    if (page.content_hash != null && hashWikiBody(body) !== page.content_hash) {
      return { ok: false, error: 'guard_mismatch', message: '正文与索引指纹失配' }
    }
    return { ok: true, page, body }
  }

  /** 版本历史（渲染端）。 */
  history(pageId: string): WikiPageVersionEntry[] {
    return this.revisionRepo.listByPage(pageId, 50).map((r) => ({
      version: r.version,
      contentHash: r.content_hash,
      title: r.title,
      summary: r.summary,
      changeKind: r.change_kind,
      changeNote: r.change_note,
      actor: r.actor,
      createdAt: r.created_at,
    }))
  }

  /** 页面元数据列表（渲染端目录树数据源，含归档外全部字段）。 */
  listPagesForUi(spaceId: string, parentId?: string | null): WikiPageRow[] {
    if (parentId !== undefined) {
      return this.pageRepo.listBySpace(spaceId, { parentId })
    }
    return this.pageRepo.listBySpace(spaceId)
  }

  /** 摘要 token 估计（会话检查器"wiki 份额"指标用）。 */
  static estimatePageTokens(text: string): number {
    return estimateTokens(text)
  }
}

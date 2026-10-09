/**
 * @module wiki-candidate.service
 *
 * 候选确认区服务（S2）—— 抽取产物的人工晋级闸门。
 *
 * 铁律（方案 §7.4 不变量 3 / §9.4 人审门）：**模型自称的"用户已确认"不是凭据**。
 * 本服务只接受来自可信界面（`wiki:candidate:confirm` IPC）的结构化确认：
 *   - 必须回传展示时的 digest（所见即所存，摘要绑定）；
 *   - 确认后按 payload **原文**经统一写入原语落库（`authorRole: 'extraction'`）；
 *   - 写入失败则条件回滚候选为 pending，不留"已确认但无页面"的死角。
 *
 * 所有页面与空间写入一律走 WikiWriteService（不直写 repository），与 S0/S1 同一
 * 原语：CAS / 配额 / 敏感闸门 / 版本记录 / FTS 同事务 / indexReady 回执全部继承。
 */

import { createLogger } from '@spark/shared'
import type {
  WikiScope,
  WikiSpaceRow,
  WikiSpaceRepository,
  WikiCandidateRepository,
  WikiCandidateRow,
  WikiCandidatePayload,
  WikiSourceRepository,
  WikiPageKind,
} from '@spark/storage'
import type {
  WikiCandidateItem,
  WikiCandidateSourceView,
  WikiCandidateStatus,
} from '@spark/protocol'
import type { WikiWriteService } from './wiki-write.service.js'

const log = createLogger('wiki:candidate')

/** 默认空间命名（与设置 space/autoCreate 语义一致；确认时兜底用） */
const DEFAULT_SPACE_NAMES: Record<WikiScope, string> = {
  user: '我的知识库',
  project: '本项目知识库',
  agent: 'Agent 知识库',
  team: '团队知识库',
}

export interface WikiCandidateListResult {
  items: WikiCandidateItem[]
  pendingTotal: number
}

export interface WikiCandidateConfirmResult {
  ok: boolean
  pageId?: string
  title?: string
  indexReady?: boolean
  message?: string
}

export class WikiCandidateService {
  constructor(
    private readonly candidateRepo: WikiCandidateRepository,
    private readonly sourceRepo: WikiSourceRepository,
    private readonly spaceRepo: WikiSpaceRepository,
    private readonly writeService: WikiWriteService,
  ) {}

  /** 候选区列表（payload 解析失败的行被跳过并告警，不把损坏数据透给 UI）。 */
  list(
    status: WikiCandidateStatus,
    scope?: { scope: string; scopeRef: string | null },
  ): WikiCandidateListResult {
    const rows = this.candidateRepo.listByStatus(status, scope)
    const items: WikiCandidateItem[] = []
    for (const row of rows) {
      const view = toCandidateView(row, this.candidateRepo)
      if (view == null) {
        log.warn(`wiki candidate payload unreadable: id=${row.id}`)
        continue
      }
      items.push(view)
    }
    const pendingTotal =
      scope != null
        ? this.candidateRepo.countPending(scope.scope, scope.scopeRef)
        : this.candidateRepo.listByStatus('pending').length
    return { items, pendingTotal }
  }

  /** 待确认总数（导航 / 标签页 Badge）。 */
  pendingTotal(): number {
    return this.candidateRepo.listByStatus('pending').length
  }

  /** 用户拒绝（pending → rejected）。 */
  reject(id: number): { ok: boolean; message?: string } {
    const row = this.candidateRepo.getById(id)
    if (row == null) return { ok: false, message: '候选不存在' }
    if (row.status !== 'pending') return { ok: false, message: `候选已是 ${row.status} 状态` }
    this.candidateRepo.reject(id)
    log.info(`wiki candidate rejected: id=${id}`)
    return { ok: true }
  }

  /**
   * 用户确认 → 晋级为页面。
   *
   * 顺序很重要：先做一次性状态迁移（confirm），再落页面；页面失败时回滚候选。
   * 这样并发 / 重复确认只有一次能成功，且失败后候选仍可重试或改选空间重试。
   *
   * 【AutoDream wiki 轨】payload.action 扩展路由：缺省 create 走既有新建路径；
   * update / delete / merge 对 targetId 指向的既有页面执行（与 memory 候选
   * P2-A 同构）。delete 走 archivePage 软删（可恢复），不物理删除。
   */
  async confirm(input: {
    id: number
    digest: string
    spaceId?: string | null
  }): Promise<WikiCandidateConfirmResult> {
    const confirmed = this.candidateRepo.confirm(input.id, input.digest)
    if (!confirmed.ok) {
      return { ok: false, message: describeConfirmFailure(confirmed.reason) }
    }
    const payload = this.candidateRepo.parsePayload(confirmed.candidate)
    if (payload == null) {
      this.candidateRepo.revertToPendingIfUnattached(input.id)
      return { ok: false, message: '候选内容已损坏，无法晋级' }
    }

    // ── action 扩展路由（AutoDream）：目标页操作 ──
    if (payload.action === 'update' || payload.action === 'delete' || payload.action === 'merge') {
      const result = await this.confirmPageAction(input.id, payload)
      if (!result.ok) this.candidateRepo.revertToPendingIfUnattached(input.id)
      return result
    }

    const space = await this.resolveTargetSpace(confirmed.candidate, input.spaceId ?? null)
    if (space == null) {
      this.candidateRepo.revertToPendingIfUnattached(input.id)
      return { ok: false, message: '找不到目标空间，请先选择或新建空间' }
    }

    const written = await this.writeService.commitPage({
      spaceId: space.id,
      kind: normalizeKind(payload.kind),
      title: payload.title,
      summary: payload.summary,
      body: payload.body,
      tags: payload.tags,
      status: 'published',
      // 真实装配角色：抽取管道产物，不信任模型自报
      authorRole: 'extraction',
      sourceSessionId: payload.sources[0]?.sessionId ?? null,
    })
    if (!written.ok) {
      // 晋级未完成：回滚候选，让用户可以重试或改选空间后重试
      this.candidateRepo.revertToPendingIfUnattached(input.id)
      log.warn(`wiki candidate promotion failed: id=${input.id} reason=${written.reason}`)
      return { ok: false, message: written.message }
    }

    this.bindSources(written.row.id, payload.sources)
    this.candidateRepo.attachPage(input.id, written.row.id)
    log.info(
      `wiki candidate confirmed: id=${input.id} page=${written.row.id} sources=${payload.sources.length}`,
    )
    return {
      ok: true,
      pageId: written.row.id,
      title: written.row.title,
      indexReady: written.indexReady,
    }
  }

  /**
   * 【AutoDream】action 扩展路由的执行体：对既有页面执行 update / delete / merge。
   * delete 走 archivePage 软删（wiki_restore 可恢复，符合计划 D7 宁慢勿错）；
   * merge = 正文合入保留方（mergeTargetId）+ 归档被并方（targetId）。
   * 任一步失败回滚候选为 pending（与新建路径同一兜底约定）。
   */
  private async confirmPageAction(
    id: number,
    payload: WikiCandidatePayload,
  ): Promise<WikiCandidateConfirmResult> {
    const targetId = payload.targetId
    if (targetId == null || targetId.length === 0) {
      return { ok: false, message: '候选缺少目标页面 id（targetId）' }
    }

    if (payload.action === 'delete') {
      const removed = await this.writeService.archivePage(targetId)
      if (!removed.ok) return { ok: false, message: removed.message }
      this.candidateRepo.attachPage(id, targetId)
      log.info(`wiki candidate (page-action) confirmed: id=${id} delete→archived page=${targetId}`)
      return { ok: true, pageId: targetId, title: payload.title }
    }

    if (payload.action === 'update') {
      const written = await this.writeService.commitPage({
        pageId: targetId,
        title: payload.title,
        summary: payload.summary,
        body: payload.body,
        tags: payload.tags,
        authorRole: 'extraction',
        changeNote: payload.rationale?.slice(0, 200) ?? null,
        sourceSessionId: payload.sources[0]?.sessionId ?? null,
      })
      if (!written.ok) return { ok: false, message: written.message }
      this.bindSources(targetId, payload.sources)
      this.candidateRepo.attachPage(id, written.row.id)
      log.info(`wiki candidate (page-action) confirmed: id=${id} updated page=${targetId}`)
      return {
        ok: true,
        pageId: written.row.id,
        title: written.row.title,
        indexReady: written.indexReady,
      }
    }

    // merge：payload.body 即合并后的完整正文（梦境模型产出），落保留方 + 归档被并方
    const mergeTargetId = payload.mergeTargetId
    if (mergeTargetId == null || mergeTargetId.length === 0) {
      return { ok: false, message: 'merge 候选缺少保留方页面 id（mergeTargetId）' }
    }
    const merged = await this.writeService.commitPage({
      pageId: mergeTargetId,
      title: payload.title,
      summary: payload.summary,
      body: payload.body,
      tags: payload.tags,
      authorRole: 'extraction',
      changeNote: `自动整编合并自 ${targetId}`,
      sourceSessionId: payload.sources[0]?.sessionId ?? null,
    })
    if (!merged.ok) return { ok: false, message: merged.message }
    const archived = await this.writeService.archivePage(targetId)
    if (!archived.ok) {
      // 正文已合入保留方，归档失败不回滚合并（知识无损），只告警留人处理
      log.warn(`merge archived source page failed: ${targetId} (${archived.message})`)
    }
    this.bindSources(mergeTargetId, payload.sources)
    this.candidateRepo.attachPage(id, merged.row.id)
    log.info(
      `wiki candidate (page-action) confirmed: id=${id} merged ${targetId} → ${mergeTargetId}`,
    )
    return {
      ok: true,
      pageId: merged.row.id,
      title: merged.row.title,
      indexReady: merged.indexReady,
    }
  }

  /** 绑定溯源（幂等；单条失败不影响已成功的晋级，只告警）。 */
  private bindSources(
    pageId: string,
    sources: ReadonlyArray<{ sessionId: string; turnIndex: number; excerpt: string }>,
  ): void {
    for (const source of sources) {
      try {
        this.sourceRepo.insert({
          pageId,
          sessionId: source.sessionId,
          turnIndex: source.turnIndex,
          excerpt: source.excerpt,
        })
      } catch (err) {
        log.warn(
          `wiki source bind failed: page=${pageId} err=${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  /**
   * 目标空间解析：显式选择 → 候选预选 → 该 scope 下任一 manual 空间 → 兜底新建。
   * 只在确认这一刻才可能新建空间（抽取阶段不预建，避免空空间）。
   */
  private async resolveTargetSpace(
    candidate: WikiCandidateRow,
    requestedSpaceId: string | null,
  ): Promise<WikiSpaceRow | null> {
    if (requestedSpaceId != null) {
      const space = this.spaceRepo.getById(requestedSpaceId)
      if (space != null && space.archived === 0 && space.space_type === 'manual') return space
      log.warn(`wiki candidate target space unusable: id=${requestedSpaceId}`)
      return null
    }
    if (candidate.space_id != null) {
      const preset = this.spaceRepo.getById(candidate.space_id)
      if (preset != null && preset.archived === 0 && preset.space_type === 'manual') return preset
    }
    const scope = normalizeScope(candidate.scope)
    const existing = this.spaceRepo.listByScopes([{ scope, scopeRef: candidate.scope_ref }], {
      spaceType: 'manual',
    })[0]
    if (existing != null) return existing

    const created = await this.writeService.createSpace({
      scope,
      scopeRef: candidate.scope_ref,
      name: DEFAULT_SPACE_NAMES[scope],
      createdBy: 'extraction',
    })
    return created.ok ? created.row : null
  }
}

function toCandidateView(
  row: WikiCandidateRow,
  repo: WikiCandidateRepository,
): WikiCandidateItem | null {
  const payload = repo.parsePayload(row)
  if (payload == null) return null
  return {
    id: row.id,
    scope: normalizeScope(row.scope),
    scopeRef: row.scope_ref,
    spaceId: row.space_id,
    kind: normalizeKind(row.kind),
    title: payload.title,
    summary: payload.summary,
    body: payload.body,
    tags: payload.tags,
    confidence: payload.confidence,
    rationale: payload.rationale ?? null,
    sources: payload.sources.map(
      (source): WikiCandidateSourceView => ({
        sessionId: source.sessionId,
        turnIndex: source.turnIndex,
        excerpt: source.excerpt,
      }),
    ),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    digest: row.content_digest,
    pageId: row.page_id,
  }
}

function normalizeScope(scope: string): WikiScope {
  return scope === 'user' || scope === 'project' || scope === 'agent' || scope === 'team'
    ? scope
    : 'user'
}

function normalizeKind(kind: string): WikiPageKind {
  return kind === 'knowledge' ||
    kind === 'experience' ||
    kind === 'pattern' ||
    kind === 'reference' ||
    kind === 'note'
    ? kind
    : 'note'
}

function describeConfirmFailure(reason: string): string {
  switch (reason) {
    case 'not_found':
      return '候选不存在'
    case 'not_pending':
      return '候选已被处理，请刷新候选区'
    case 'expired':
      return '候选已过期，请重新沉淀'
    case 'digest_mismatch':
      return '候选内容已变化，请刷新后重新确认'
    case 'payload_unreadable':
      return '候选内容已损坏，无法晋级'
    default:
      return '确认失败，请重试'
  }
}

/**
 * @module wiki-write.service
 *
 * Wiki 统一写入原语（设计原则 5：写入单原语）。
 *
 * 所有写入口（用户 IPC / Agent 工具 / 抽取管道 / 导入）一律经本服务提交，
 * 不允许任何入口直写 repository 绕过闸门（memory 曾因 6 处入口不一致付出代价）。
 *
 * 提交语义（范式对齐 memory-commit.service）：
 *   - 「先文件后 DB」：先写正文快照（原子 tmp→rename），再在 DB 事务内
 *     insert / CAS 更新 + 落 wiki_revision 版本记录 + 同事务维护 wiki_fts。
 *   - CAS：UPDATE ... WHERE version = expected（compareAndSwap）；失配返回
 *     version_conflict，不覆盖当前状态。
 *   - 回执区分 ok（持久化成功）与 indexReady（FTS 索引就绪）—— 索引故障
 *     不伪装成写入成功。
 *   - 错误信息与日志不含正文片段（脱敏纪律）。
 *
 * 版本历史不变量（与 memory_revision 同约定）：
 *   - 当前版本 = wiki_page 行 + 正文文件（唯一权威载体）；
 *   - wiki_revision 只记录「被替代」的版本（旧正文快照），head 不在表内；
 *   - UNIQUE(page_id, version) + INSERT OR IGNORE 保证重试路径幂等。
 *
 * S0 范围：空间创建 + 页面 create/update（CAS）+ CAS 失配回滚。S1 补全敏感词
 * 闸门、配额、归档/删除屏障与 [[双链]] 解析。
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type { WikiScope, WikiSpaceRow, WikiSpaceType, WikiPageKind, WikiPageRow } from '@spark/storage'
import {
  WikiSpaceRepository,
  WikiPageRepository,
  WikiRevisionRepository,
  WikiSearchRepository,
  hashWikiBody,
} from '@spark/storage'
import { WikiStoreService } from './wiki-store.service.js'

const log = createLogger('wiki:write')

export type WikiWriteResult =
  | { ok: true; row: WikiPageRow; created: boolean; indexReady: boolean }
  | {
      ok: false
      reason: 'version_conflict' | 'slug_conflict' | 'not_found' | 'validation' | 'io_failed'
      message: string
      /** version_conflict 时当前实际版本（供调用方重读重试） */
      currentVersion?: number
    }

export type WikiSpaceWriteResult =
  | { ok: true; row: WikiSpaceRow }
  | { ok: false; reason: 'name_conflict' | 'validation'; message: string }

export interface WikiPageWriteInput {
  pageId?: string
  /** 更新时的 CAS 期望版本（新建忽略） */
  expectedVersion?: number
  /** 目标空间（新建必填；更新时由服务层从页面行解析，可不传） */
  spaceId?: string
  parentId?: string | null
  kind?: WikiPageKind
  /** 标题（新建必填；更新缺省 = 不改标题） */
  title?: string
  summary?: string
  /** 正文（新建必填；更新时缺省 = 不改正文） */
  body?: string
  tags?: string[]
  status?: 'draft' | 'published'
  /** 'manual_user' | 'agent' | 'extraction' | 'import'（真实装配角色，不信任 LLM 自报） */
  authorRole?: string
  sourceSessionId?: string | null
}

/** id 生成：前缀 + uuid 前 8 hex（与 memory generateId 同约定） */
function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`
}

/** title → slug：空格转连字符、去非安全字符、小写；中文保留（slug 语义为双链键）。 */
export function slugifyTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[<>:"/\\|?*[\]#]/g, '')
    .toLowerCase()
}

export class WikiWriteService {
  constructor(
    private readonly spaceRepo: WikiSpaceRepository,
    private readonly pageRepo: WikiPageRepository,
    private readonly revisionRepo: WikiRevisionRepository,
    private readonly searchRepo: WikiSearchRepository,
    private readonly store: WikiStoreService,
  ) {}

  // ─── 空间 ─────────────────────────────────────────────────────────────

  async createSpace(input: {
    scope: WikiScope
    scopeRef?: string | null
    spaceType?: WikiSpaceType
    name: string
    description?: string
    icon?: string | null
    createdBy?: string
  }): Promise<WikiSpaceWriteResult> {
    const name = input.name.trim()
    if (name.length === 0) {
      return { ok: false, reason: 'validation', message: '空间名称不能为空' }
    }
    const spaceType = input.spaceType ?? 'manual'
    const existing = this.spaceRepo.findByName(input.scope, input.scopeRef ?? null, spaceType, name)
    if (existing != null) {
      return { ok: false, reason: 'name_conflict', message: `同名空间已存在：${name}` }
    }
    const row = this.spaceRepo.insert({
      id: generateId('wsp'),
      scope: input.scope,
      scope_ref: input.scopeRef ?? null,
      space_type: spaceType,
      name,
      description: input.description?.slice(0, 400) ?? '',
      icon: input.icon ?? null,
      visibility: 'private',
      repo_path: null,
      repo_rev: null,
      created_by: input.createdBy ?? 'user',
      archived: 0,
    })
    log.info(`wiki space created: id=${row.id} scope=${row.scope} type=${row.space_type}`)
    return { ok: true, row }
  }

  // ─── 页面 ─────────────────────────────────────────────────────────────

  /** 统一写入入口：新建或 CAS 更新。 */
  async commitPage(input: WikiPageWriteInput): Promise<WikiWriteResult> {
    if (input.pageId != null || input.expectedVersion != null) {
      const pageId = input.pageId
      if (pageId == null) {
        return { ok: false, reason: 'validation', message: '缺少 pageId' }
      }
      return this.updatePage(pageId, input)
    }
    return this.createPage(input)
  }

  private async createPage(input: WikiPageWriteInput): Promise<WikiWriteResult> {
    const title = input.title?.trim() ?? ''
    if (title.length === 0) {
      return { ok: false, reason: 'validation', message: '页面标题不能为空' }
    }
    if (input.body == null || input.body.length === 0) {
      return { ok: false, reason: 'validation', message: '新建页面必须提供正文' }
    }
    if (input.spaceId == null || input.spaceId.length === 0) {
      return { ok: false, reason: 'validation', message: '新建页面必须提供目标空间' }
    }
    const space = this.spaceRepo.getById(input.spaceId)
    if (space == null || space.archived === 1) {
      return { ok: false, reason: 'not_found', message: '目标空间不存在或已归档' }
    }
    let slug = slugifyTitle(title)
    if (slug.length === 0) slug = generateId('wp').slice(3) // 纯符号标题兜底
    if (this.pageRepo.getBySlug(input.spaceId, slug) != null) {
      return { ok: false, reason: 'slug_conflict', message: `空间内已存在同名 slug：${slug}` }
    }

    const pageId = generateId('wp')
    // 先文件后 DB：正文落盘失败则 DB 不动（无孤儿行）。body 已在入口校验非空。
    const pageBody = input.body!
    const filePath = await this.store.writeBody(
      space.scope,
      space.scope_ref,
      space.id,
      pageId,
      pageBody,
    )
    let row: WikiPageRow
    try {
      row = this.pageRepo.insert(
        {
          id: pageId,
          space_id: space.id,
          parent_id: input.parentId ?? null,
          kind: input.kind ?? 'knowledge',
          title,
          slug,
          summary: input.summary ?? '',
          file_path: filePath,
          tags_json: JSON.stringify(input.tags ?? []),
          status: input.status ?? 'published',
          confidence: 1.0,
          sort_order: 0,
          source_type: input.authorRole === 'agent' ? 'skill' : 'manual',
          source_session_id: input.sourceSessionId ?? null,
          author_role: input.authorRole ?? 'manual_user',
          hit_count: 0,
          last_hit_at: null,
          valid_from: null,
          invalid_at: null,
        },
        pageBody,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // 唯一索引冲突 = 预检查与 insert 之间存在并发同名竞争（预检查之后有一次
      // await 落盘，窗口真实存在）——收敛为结构化 slug_conflict，不让异常逃逸
      // 出 WikiWriteResult 契约（调用方的回滚/提示逻辑依赖结构化结果）。
      if (msg.includes('uniq_wiki_page_slug') || msg.includes('UNIQUE')) {
        log.warn(
          `wiki page create 并发同名被唯一索引拒绝：space=${space.id} slug=${slug}（新写文件成待清理孤儿 ${filePath}）`,
        )
        return { ok: false, reason: 'slug_conflict', message: `空间内已存在同名 slug：${slug}` }
      }
      // 其他 DB 异常同样收敛；正文文件已落盘且无 DB 行引用，成为待清理孤儿。
      log.warn(`wiki page create DB 提交失败（正文文件成待清理孤儿 ${filePath}）：${msg}`)
      return { ok: false, reason: 'io_failed', message: `DB 提交失败：${msg}` }
    }
    // 版本表语义（与 memory_revision 同约定，见 migration 108 表注释）：
    //   「当前版本以 wiki_page 行 + 正文文件为权威，被替代的版本才进 wiki_revision」。
    // 因此创建不写版本行——v1 的记录在它被首次替代时随旧正文快照一并落库
    // （见 updatePage）。若此处补写 v1 行，会与 updatePage 的旧版本行撞
    // UNIQUE(page_id, version) 而被 INSERT OR IGNORE 吞掉，导致 v1 的快照
    // 路径永久丢失、且 v2 之后再无任何版本记录。
    const indexReady = this.isIndexReady()
    log.info(`wiki page created: id=${row.id} space=${row.space_id} version=${row.version}`)
    return { ok: true, row, created: true, indexReady }
  }

  private async updatePage(pageId: string, input: WikiPageWriteInput): Promise<WikiWriteResult> {
    const existing = this.pageRepo.getById(pageId)
    if (existing == null) {
      return { ok: false, reason: 'not_found', message: '页面不存在' }
    }
    if (existing.status === 'archived') {
      return { ok: false, reason: 'validation', message: '页面已归档，先还原再编辑' }
    }
    const space = this.spaceRepo.getById(existing.space_id)
    if (space == null) {
      return { ok: false, reason: 'not_found', message: '页面所属空间不存在' }
    }

    const body = input.body ?? null
    const title = input.title?.trim() ?? existing.title
    const summary = input.summary ?? existing.summary
    const textChanged = body != null || title !== existing.title || summary !== existing.summary
    if (textChanged && body == null) {
      return {
        ok: false,
        reason: 'validation',
        message: '标题/摘要变更必须携带完整正文（FTS 重建需要）',
      }
    }

    // 旧正文必须在新正文落盘【之前】读出（writeBody 是原子替换，之后已读不到）
    // —— 与 memory-commit.service#commitUpdate 同一时序约束。无条件读取（而非
    // 仅在有新正文时）：版本表要留下「被替代版本」的正文快照，纯元数据变更同样
    // 产生一条历史版本。读取失败时置标记：版本行如实留空并标注，且禁止 CAS
    // 失配回滚把空串写回权威文件。
    let oldBody: string | null = null
    let oldBodyReadFailed = false
    try {
      oldBody = await this.store.readBody(existing.file_path)
    } catch (err) {
      oldBodyReadFailed = true
      log.warn(
        `wiki updatePage 旧正文读取失败（该历史版本以空正文快照入档并标注）：id=${pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }

    // 先文件后 DB：正文落新快照。注意 writeBody 是原子替换 —— CAS 失配时
    // 「被拒绝的那一版」已经覆盖了权威文件，必须依赖下方的回滚（见
    // restoreOverwrittenBody），否则 DB 仍旧 content_hash 而文件是新正文，
    // 读取守卫会拒绝采信 → 页面降级不可读直到下一次成功提交。
    let newFilePath = existing.file_path
    if (body != null) {
      newFilePath = await this.store.writeBody(
        space.scope,
        space.scope_ref,
        space.id,
        pageId,
        body,
      )
    }

    const patch: Parameters<WikiPageRepository['compareAndSwap']>[2] = {
      ...(input.kind != null ? { kind: input.kind } : {}),
      ...(title !== existing.title ? { title } : {}),
      ...(summary !== existing.summary ? { summary } : {}),
      ...(input.tags != null ? { tags_json: JSON.stringify(input.tags) } : {}),
      ...(input.parentId !== undefined ? { parent_id: input.parentId } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      ...(newFilePath !== existing.file_path ? { file_path: newFilePath } : {}),
    }
    const expected = input.expectedVersion ?? existing.version
    const next = this.pageRepo.compareAndSwap(pageId, expected, patch, body ?? undefined)
    if (next == null) {
      const current = this.pageRepo.getById(pageId)
      log.info(`wiki page CAS miss: id=${pageId} expected=${expected}`)
      await this.restoreOverwrittenBody({
        pageId,
        current,
        newBody: body,
        oldBody,
        oldBodyReadFailed,
      })
      return {
        ok: false,
        reason: 'version_conflict',
        message: '页面已被并发修改，请基于最新版本重试',
        ...(current?.version != null ? { currentVersion: current.version } : {}),
      }
    }
    // 版本记录：保留「被替代版本」（旧正文在 CAS 前已读出，此处落受控快照）。
    // 仅当版本真的推进时才记录 —— 空 patch 的 no-op 更新不推进版本，此时没有
    // 任何版本被替代，补记录会产出指向 head 的历史行（后续再被 IGNORE 吞掉）。
    await this.captureSupersededVersion({
      pageId,
      existing,
      nextVersion: next.version,
      oldBody,
      oldBodyReadFailed,
      actor: input.authorRole ?? 'manual_user',
    })
    const ready = this.isIndexReady()
    log.info(`wiki page updated: id=${pageId} version=${next.version}`)
    return { ok: true, row: next, created: false, indexReady: ready }
  }

  /** FTS 索引就绪判定：表存在即就绪（同事务维护）；不存在 = 降级未索引。 */
  private isIndexReady(): boolean {
    try {
      return this.searchRepo.isFtsAvailable()
    } catch {
      return false
    }
  }

  /**
   * 记录「被替代版本」到版本表（wiki_revision）。
   *
   * 不变量：wiki_revision 只保存被替代的版本（旧正文快照），当前版本由
   * wiki_page 行 + 正文文件承载 —— 与 memory_revision 同约定，避免 head 重复存储。
   *
   * 失败处理：版本记录属附属审计数据，写快照/落库失败不得让已经提交成功的
   * 页面写入变成异常（WikiWriteResult 承诺结构化结果）；失败如实告警，下次
   * 成功提交仍会记录当时的 head，历史链只会缺一段而不会污染权威状态。
   */
  private async captureSupersededVersion(input: {
    pageId: string
    existing: WikiPageRow
    nextVersion: number
    oldBody: string | null
    oldBodyReadFailed: boolean
    actor: string
  }): Promise<void> {
    const { pageId, existing, nextVersion, oldBody, oldBodyReadFailed, actor } = input
    if (nextVersion === existing.version) return
    try {
      const snapshotPath = await this.store.writeRevisionSnapshot(
        pageId,
        existing.version,
        oldBody ?? '',
      )
      this.revisionRepo.insert({
        page_id: pageId,
        version: existing.version,
        content_hash: existing.content_hash ?? '',
        title: existing.title,
        summary: existing.summary,
        body_snapshot_path: snapshotPath,
        change_kind: 'edit',
        change_note: oldBodyReadFailed ? '前一版正文在提交时不可读，快照留空' : null,
        actor,
      })
    } catch (err) {
      log.warn(
        `wiki 版本记录写入失败（页面写入已成功，历史链缺该版本）：id=${pageId} version=${existing.version} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }

  /**
   * CAS 失配后的权威正文回滚（与 memory-commit.service#commitUpdate 的审查
   * 修复同一语义）。
   *
   * 时序背景：commitPage 是「先文件后 CAS」，而 writeBody 为原子替换 —— 失配
   * 时被拒绝的那一版正文已经落到权威路径上；若不回滚，DB 行仍旧 content_hash
   * 而文件是新正文，读取守卫（wiki-page.service）会拒绝采信，页面降级为不可读
   * 直到下一次成功提交。memory 曾把该状态称为「可识别孤儿」并因此违反
   * 「DB 提交失败 → 旧权威版本仍完整」的验收矩阵，此处按同一结论纠正。
   *
   * 回滚条件（保守；任一条不满足即保持守卫拒绝态，等下一次成功提交自愈）：
   *   1. 本次确实写过文件（newBody 非空），且旧正文读取成功、非空串回退；
   *   2. 行仍在，且其 content_hash 仍等于覆盖前读到的旧正文指纹 —— 说明被
   *      覆盖的正是该版本的权威正文；行已被他人推进时我们手里没有那一版
   *      正文，无权回滚；
   *   3. 文件此刻仍等于本提交刚写下的新正文 —— 失配后若有并发写者推进过
   *      文件，写回旧正文会制造反向失配并覆盖对方的新正文，故放弃。
   */
  private async restoreOverwrittenBody(input: {
    pageId: string
    current: WikiPageRow | null
    newBody: string | null
    oldBody: string | null
    oldBodyReadFailed: boolean
  }): Promise<void> {
    const { pageId, current, newBody, oldBody, oldBodyReadFailed } = input
    if (newBody == null || oldBody == null || oldBodyReadFailed) return
    if (current == null) return
    if (current.content_hash != null && current.content_hash !== hashWikiBody(oldBody)) return

    let fileNow: string | null = null
    try {
      fileNow = await this.store.readBody(current.file_path)
    } catch {
      fileNow = null
    }
    if (fileNow == null || hashWikiBody(fileNow) !== hashWikiBody(newBody)) {
      log.info(
        `wiki CAS 失配后检测到文件非本提交快照（并发推进或不可读），放弃回滚：id=${pageId}`,
      )
      return
    }
    try {
      // 写回权威行指向的那条路径（路径口径以 DB 为准，不重新推导）
      await this.store.writeBodyAt(current.file_path, oldBody)
      log.info(`wiki CAS 失配后已回滚权威正文：id=${pageId} version=${current.version}`)
    } catch (err) {
      log.warn(
        `wiki CAS 失配后回滚正文失败（守卫拒绝态待下次成功提交自愈）：id=${pageId} — ` +
          (err instanceof Error ? err.message : String(err)),
      )
    }
  }
}

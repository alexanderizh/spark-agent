/**
 * @module registerWikiIpc
 *
 * 知识库 / Wiki IPC — 空间与页面 CRUD + 版本历史 + 双链（S1 完整闭环）。
 *
 * 设计约束：
 *   - **写入一律经 agent-runtime 的 WikiWriteService**（统一写入原语：先文件后 DB、
 *     CAS、版本记录、FTS 同事务、双链重建、indexReady 回执）——本文件不直写
 *     repository。这与 memory IPC 直用 repo 的历史风格不同，是方案设计原则 5
 *     的硬要求（memory 曾因 6 处入口不一致付出代价）。
 *   - 服务组合一律经 `createWikiServiceStack` 装配，避免漏接派生依赖（双链）。
 *   - 全部 handler 落本文件，ipc/index.ts 仅一行调用（主文件已 1.19 万行）。
 *   - 正文文件路径按空间所属 scope 解析（project scope 需要 workspace root）。
 *   - 设置项复用 settings:get/set（category='wiki'），预算档逐次读取 → 保存即生效。
 */

import {
  WorkspaceRepository,
  SettingsRepository,
  SkillRepository,
  type WikiScope,
  type WikiSpaceType,
  type WikiPageKind,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createWikiServiceStack, resolveWikiBudgetFromSettings } from '@spark/agent-runtime'
import { estimateTokens } from '@spark/shared'
import type {
  WikiPageMeta,
  WikiSpaceSummary,
  WikiPageVersionEntry,
  WikiBacklinkEntry,
  WikiRevisionDetail,
  WikiSkillProposalStatus,
} from '@spark/protocol'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'
import { getAppSkillsManager } from '../services/AppSkillsManager.js'
import { createLogger } from '@spark/shared'

const log = createLogger('ipc.wiki')

export function registerWikiIpc(): void {
  const db: SparkDatabase = getDatabase()
  const settingsRepo = new SettingsRepository(db)

  const getBudget = () => resolveWikiBudgetFromSettings((c, k) => settingsRepo.get(c, k))

  /** 按 scope 解析 workspace root（project scope 的正文文件要落仓库内）。 */
  const resolveWorkspaceRoot = (scope: WikiScope, scopeRef: string | null): string | undefined => {
    if (scope !== 'project' || scopeRef == null) return undefined
    try {
      return new WorkspaceRepository(db).get(scopeRef)?.root_path ?? undefined
    } catch {
      return undefined
    }
  }

  /** 服务栈（按 scope 决定正文根路径）。 */
  const stack = (scope: WikiScope = 'user', scopeRef: string | null = null) => {
    const workspaceRootPath = resolveWorkspaceRoot(scope, scopeRef)
    return createWikiServiceStack({
      db,
      budget: getBudget(),
      ...(workspaceRootPath != null ? { workspaceRootPath } : {}),
    })
  }

  /**
   * 带 S3 技能落地能力的服务栈（共享 SkillRepository 实例，保证技能管理界面
   * 与 Wiki 提议区看到同一份数据）。技能目录来自 AppSkillsManager ——
   * 不猜路径，未配置时接受会被服务层明确拒绝。
   */
  const skillStack = () => {
    let skillsRootDir: string | undefined
    try {
      skillsRootDir = getAppSkillsManager().userDir
    } catch {
      skillsRootDir = undefined
    }
    return createWikiServiceStack({
      db,
      budget: getBudget(),
      skillRepo: new SkillRepository(db),
      ...(skillsRootDir != null ? { skillsRootDir } : {}),
    })
  }

  /** 漂移阈值从设置读取（category='wiki', key='repo/staleCommits'）。 */
  const getStaleCommits = (): number => {
    const raw = settingsRepo.get('wiki', 'repo/staleCommits')
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 20
  }

  const repoStack = () =>
    createWikiServiceStack({ db, budget: getBudget(), staleCommits: getStaleCommits() })

  const base = stack()

  /** 页面所属空间 → 服务栈（页面不存在时返回 null）。 */
  const stackForPage = (pageId: string) => {
    const page = base.pageRepo.getById(pageId)
    if (page == null) return null
    const space = base.spaceRepo.getById(page.space_id)
    if (space == null) return null
    return stack(space.scope, space.scope_ref)
  }

  // ─── 空间 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:space:list', async (request) => {
    const scopes: Array<{ scope: WikiScope; scopeRef: string | null }> = request.scope
      ? [{ scope: request.scope, scopeRef: request.scopeRef ?? null }]
      : [
          { scope: 'user', scopeRef: null },
          // 未绑定 workspace 的 project 空间（Repo Wiki 扫描即以此身份建空间：
          // 触发时没有会话上下文，repo_path 已足够定位仓库）。少了这一条，
          // 扫完生成的空间不会出现在任何列表里。
          { scope: 'project', scopeRef: null },
          // 全部视图：project 空间按任意 scope_ref 匹配（渲染端列表）
          ...listAllProjectScopes(db),
        ]
    const rows = base.spaceService.listSpaces(scopes, {
      ...(request.spaceType != null ? { spaceType: request.spaceType } : {}),
    })
    const spaces: WikiSpaceSummary[] = rows.map(toSpaceSummary)
    return { spaces }
  })

  typedIpcHandle('wiki:space:create', async (request) => {
    const result = await base.writeService.createSpace({
      scope: request.scope,
      scopeRef: request.scopeRef ?? null,
      ...(request.spaceType != null ? { spaceType: request.spaceType } : {}),
      name: request.name,
      ...(request.description != null ? { description: request.description } : {}),
      ...(request.icon != null ? { icon: request.icon } : {}),
    })
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      spaceId: result.row.id,
      id: result.row.id,
      title: result.row.name,
      version: 1,
      indexReady: true,
    }
  })

  typedIpcHandle('wiki:space:update', async (request) => {
    const existing = base.spaceRepo.getById(request.spaceId)
    if (existing == null) throw new Error('空间不存在')
    if (request.name != null) {
      const name = request.name.trim()
      if (name.length === 0) throw new Error('空间名称不能为空')
      const conflict = base.spaceRepo.findByName(
        existing.scope,
        existing.scope_ref,
        existing.space_type,
        name,
      )
      if (conflict != null && conflict.id !== existing.id) {
        throw new Error(`同名空间已存在：${name}`)
      }
    }
    const updated = base.spaceRepo.update(request.spaceId, {
      ...(request.name != null ? { name: request.name.trim() } : {}),
      ...(request.description != null ? { description: request.description.slice(0, 400) } : {}),
      ...(request.icon !== undefined ? { icon: request.icon } : {}),
    })
    const counts = base.spaceRepo.countActivePagesBySpace([updated.id])
    log.info(`wiki space updated: ${updated.id}`)
    return { space: toSpaceSummary({ ...updated, pageCount: counts.get(updated.id) ?? 0 }) }
  })

  typedIpcHandle('wiki:space:archive', async (request) => {
    const space = base.spaceRepo.getById(request.spaceId)
    if (space == null) throw new Error('空间不存在')
    base.spaceRepo.archive(request.spaceId)
    log.info(`wiki space archived: ${request.spaceId}`)
    return { ok: true, id: request.spaceId, title: space.name, version: 1, indexReady: true }
  })

  // ─── 页面 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:page:list', async (request) => {
    const pages = base.pageRepo.listBySpace(request.spaceId, {
      ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
      ...(request.includeArchived === true ? { includeArchived: true } : {}),
    })
    return { pages: pages.map(toPageMeta) }
  })

  typedIpcHandle('wiki:page:get', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const r = await s.pageService.readFull(request.pageId)
    if (!r.ok) throw new Error(r.message)
    return {
      page: {
        ...toPageMeta(r.page),
        body: r.body,
        truncated: false,
        nextOffset: null,
        // 与 WikiPageService.estimatePageTokens 同一把尺子（真实 tokenizer）：
        // 中文正文约 1~2 字一 token，字符数/3 会低估 2~3 倍，预算展示会失真。
        tokens: Math.max(1, estimateTokens(r.body)),
      },
    }
  })

  typedIpcHandle('wiki:page:create', async (request) => {
    const space = base.spaceRepo.getById(request.spaceId)
    if (space == null) throw new Error('目标空间不存在')
    const s = stack(space.scope, space.scope_ref)
    const result = await s.writeService.commitPage({
      spaceId: request.spaceId,
      ...(request.parentId != null ? { parentId: request.parentId } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
      title: request.title,
      ...(request.summary != null ? { summary: request.summary } : {}),
      body: request.body,
      ...(request.tags != null ? { tags: request.tags } : {}),
      ...(request.status != null ? { status: request.status } : {}),
      authorRole: 'manual_user',
    })
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: result.indexReady,
    }
  })

  typedIpcHandle('wiki:page:update', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const existing = s.pageRepo.getById(request.pageId)!
    const wantsMetaChange = request.title != null || request.summary != null
    const wantsTextChange =
      (request.title != null && request.title !== existing.title) ||
      (request.summary != null && request.summary !== existing.summary)
    // 文本字段（标题/摘要）变更必须带完整正文（contentless FTS 不支持部分更新）。
    // UI 的编辑器总会带正文；仅改元数据的调用方（如重命名入口）由服务端补全：
    // 从权威文件读取并过守卫校验，避免用空串重建索引而丢掉检索能力。
    let body = request.body
    if (body == null && (wantsTextChange || wantsMetaChange)) {
      const current = await s.pageService.readFull(request.pageId)
      if (!current.ok) throw new Error(current.message)
      body = current.body
    }
    const result = await s.writeService.commitPage({
      pageId: request.pageId,
      expectedVersion: request.expectedVersion,
      ...(request.title != null ? { title: request.title } : {}),
      ...(body != null ? { body } : {}),
      ...(request.summary != null ? { summary: request.summary } : {}),
      ...(request.tags != null ? { tags: request.tags } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
      ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
      ...(request.status != null ? { status: request.status } : {}),
      authorRole: 'manual_user',
    })
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: result.indexReady,
    }
  })

  /**
   * 目录树拖拽移动：只改 parent_id / sort_order，不触碰正文与 FTS。
   *
   * 注意走的是统一写入原语，因此与普通编辑一样会推进 version 并留一条历史版本
   * （change_kind='edit'，快照内容即移动前的正文）——移动不是「无痕」操作，
   * 版本历史里能看到这次结构调整，CAS 也能挡住并发拖拽互相覆盖。
   */
  typedIpcHandle('wiki:page:move', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const existing = s.pageRepo.getById(request.pageId)!
    if (request.parentId === request.pageId) throw new Error('不能把页面移动到自己下面')
    if (request.parentId != null) {
      const parent = s.pageRepo.getById(request.parentId)
      if (parent == null) throw new Error('目标父页面不存在')
      if (parent.space_id !== existing.space_id) throw new Error('不能跨空间移动页面')
      // 防环：目标父节点不能是自己的后代（否则该子树从树上脱落）
      if (isDescendant(s, existing.space_id, request.parentId, existing.id)) {
        throw new Error('不能把页面移动到它自己的子页面下')
      }
    }
    const result = await s.writeService.commitPage({
      pageId: request.pageId,
      expectedVersion: request.expectedVersion,
      parentId: request.parentId,
      ...(request.sortOrder != null ? { sortOrder: request.sortOrder } : {}),
      authorRole: 'manual_user',
    })
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: result.indexReady,
    }
  })

  /**
   * 置顶开关：纯展示元数据——不推进 version、不写历史版本、不动 FTS，
   * 所以 receipt 里返回的 version 是当前值（未 +1）、indexReady 恒为 true。
   */
  typedIpcHandle('wiki:page:pin', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const result = await s.writeService.setPagePinned(request.pageId, request.pinned)
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: true,
    }
  })

  typedIpcHandle('wiki:page:archive', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const result = await s.writeService.archivePage(request.pageId)
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: true,
    }
  })

  /** 取消归档：恢复为 published 并重建双链（正文未动，仅状态与图谱）。 */
  typedIpcHandle('wiki:page:restore', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const result = await s.writeService.restoreFromArchive(request.pageId)
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: result.indexReady,
    }
  })

  typedIpcHandle('wiki:page:delete', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const result = await s.writeService.deletePage(request.pageId)
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.id,
      title: result.title,
      fileCleaned: result.fileCleaned,
      revisionsCleaned: result.revisionsCleaned,
    }
  })

  typedIpcHandle('wiki:page:history', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const versions: WikiPageVersionEntry[] = s.pageService.history(request.pageId)
    return { versions }
  })

  typedIpcHandle('wiki:page:revision:read', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const revision = await s.pageService.readRevision(request.pageId, request.version)
    if (revision == null) throw new Error(`版本 v${request.version} 不存在`)
    const detail: WikiRevisionDetail = revision
    return { revision: detail }
  })

  typedIpcHandle('wiki:page:revision:restore', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const result = await s.writeService.restoreVersion({
      pageId: request.pageId,
      version: request.version,
      expectedVersion: request.expectedVersion,
      actor: 'manual_user',
    })
    if (!result.ok) throw new Error(result.message)
    return {
      ok: true,
      id: result.row.id,
      title: result.row.title,
      version: result.row.version,
      indexReady: result.indexReady,
    }
  })

  typedIpcHandle('wiki:page:backlinks', async (request) => {
    const s = stackForPage(request.pageId)
    if (s == null) throw new Error('页面不存在')
    const rows = s.linkService.listBacklinksForUi(request.pageId)
    const items: WikiBacklinkEntry[] = rows.map((r) => ({
      fromPage: r.fromPage,
      fromTitle: r.fromTitle,
      fromKind: r.fromKind as WikiPageKind,
      linkType: r.linkType,
      createdAt: r.createdAt,
    }))
    return { items, total: items.length }
  })

  typedIpcHandle('wiki:page:link', async (request) => {
    const s = stackForPage(request.fromPageId)
    if (s == null) throw new Error('来源页面不存在')
    const result = s.linkService.setReference({
      fromPageId: request.fromPageId,
      toPageId: request.toPageId,
      ...(request.remove === true ? { remove: true } : {}),
    })
    if (!result.ok) throw new Error(result.message)
    return { ok: true, changed: result.changed }
  })

  // ─── 检索 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:search', async (request) => {
    return base.searchService.search({
      query: request.query,
      ...(request.spaceIds != null ? { spaceIds: request.spaceIds } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
    })
  })

  // ─── 候选确认区（S2 抽取管道） ─────────────────────────────────────────

  typedIpcHandle('wiki:candidate:list', async (request) => {
    const scope =
      request.scope != null
        ? { scope: request.scope, scopeRef: request.scopeRef ?? null }
        : undefined
    return base.candidateService.list(request.status ?? 'pending', scope)
  })

  typedIpcHandle('wiki:candidate:confirm', async (request) => {
    // 目标空间决定正文落盘根路径（project scope），因此按空间重建服务栈。
    const space = request.spaceId != null ? base.spaceRepo.getById(request.spaceId) : null
    const activeStack = space != null ? stack(space.scope, space.scope_ref) : base
    const result = await activeStack.candidateService.confirm({
      id: request.id,
      digest: request.digest,
      ...(request.spaceId != null ? { spaceId: request.spaceId } : {}),
    })
    if (!result.ok || result.pageId == null || result.title == null) {
      throw new Error(result.message ?? '确认失败')
    }
    return {
      ok: true as const,
      pageId: result.pageId,
      title: result.title,
      indexReady: result.indexReady === true,
    }
  })

  typedIpcHandle('wiki:candidate:reject', async (request) => {
    return base.candidateService.reject(request.id)
  })

  // ─── 抽取管道（S2：对话 → 候选） ───────────────────────────────────────

  typedIpcHandle('wiki:extract:distill', async (request) => {
    // 抽取需要读设置闸门与候选策略，因此用带 settingsGet 的栈（预算档同源）。
    const distiller = createWikiServiceStack({
      db,
      budget: getBudget(),
      settingsGet: (category, key) => settingsRepo.get(category, key),
    }).extractionService
    return distiller.distill({
      sessionId: request.sessionId,
      trigger: request.trigger ?? 'manual',
      ...(request.scope != null ? { scope: request.scope } : {}),
      ...(request.scopeRef !== undefined ? { scopeRef: request.scopeRef } : {}),
      ...(request.spaceId != null ? { spaceId: request.spaceId } : {}),
    })
  })

  // ─── 技能提议区（S3：知识 → 技能，带溯源） ─────────────────────────────

  typedIpcHandle('wiki:skill:list', async (request) => {
    const scope =
      request.scope != null
        ? { scope: request.scope, scopeRef: request.scopeRef ?? null }
        : undefined
    return skillStack().skillProposerService.list(request.status ?? 'pending', scope)
  })

  /**
   * 接受提议 → 落地技能（SKILL.md + PURPOSE.md + skills 表登记）。
   * 只能来自本可信界面；模型自称"用户已同意"无法触达本通道。
   */
  typedIpcHandle('wiki:skill:accept', async (request) => {
    const result = await skillStack().skillProposerService.accept(request.id)
    if (!result.ok || result.skillId == null || result.name == null || result.rootPath == null) {
      throw new Error(result.message ?? '接受失败')
    }
    return {
      ok: true as const,
      skillId: result.skillId,
      name: result.name,
      rootPath: result.rootPath,
    }
  })

  typedIpcHandle('wiki:skill:reject', async (request) => {
    const result = skillStack().skillProposerService.reject(request.id, request.reason)
    if (!result.ok) throw new Error(result.message ?? '拒绝失败')
    return { ok: true }
  })

  // ─── Repo Wiki（S4：代码仓库 → 结构化知识页，可重建） ──────────────────

  typedIpcHandle('wiki:repo:scan', async (request) => {
    // 仓库归属 project scope：正文落仓库内（与人工知识同域但独立空间）
    return repoStack().repoScanService.scan({
      repoPath: request.repoPath,
      ...(request.spaceId != null ? { spaceId: request.spaceId } : {}),
      ...(request.ignoreGlobs != null ? { ignoreGlobs: request.ignoreGlobs } : {}),
      ...(request.maxFiles != null ? { maxFiles: request.maxFiles } : {}),
    })
  })

  typedIpcHandle('wiki:repo:rebuild', async (request) => {
    return repoStack().repoScanService.rebuild(request.spaceId)
  })

  typedIpcHandle('wiki:repo:status', async (request) => {
    const status = await repoStack().repoScanService.status(request.spaceId)
    if (status == null) throw new Error('空间不存在')
    return status
  })

  typedIpcHandle('wiki:repo:page:ownership', async (request) => {
    const result = repoStack().repoScanService.setOwnership(request.pageId, request.ownership)
    if (!result.ok) throw new Error(result.message ?? '切换所有权失败')
    return { ok: true }
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * 目标节点是否位于 candidate 子树内（move 防环）。
 * 逐层向上回溯父链，深度上限兜底防脏数据死循环。
 */
function isDescendant(
  s: { pageRepo: { getById(id: string): { parent_id: string | null; space_id: string } | null } },
  spaceId: string,
  candidateId: string,
  ancestorId: string,
): boolean {
  let cursor = candidateId
  for (let depth = 0; depth < 64; depth += 1) {
    const row = s.pageRepo.getById(cursor)
    if (row == null || row.space_id !== spaceId) return false
    if (row.parent_id == null) return false
    if (row.parent_id === ancestorId) return true
    cursor = row.parent_id
  }
  return false
}

/** 全部 project scope（scope_ref 任意）—— 渲染端"全部"视图用。 */
function listAllProjectScopes(db: SparkDatabase): Array<{ scope: WikiScope; scopeRef: string }> {
  try {
    const rows = db.raw.prepare(`SELECT id FROM workspaces`).all() as Array<{ id: string }>
    return rows.map((r) => ({ scope: 'project' as const, scopeRef: r.id }))
  } catch {
    return []
  }
}

function toSpaceSummary(row: {
  id: string
  scope: WikiScope
  scope_ref: string | null
  space_type: WikiSpaceType
  name: string
  description: string
  icon: string | null
  visibility: 'private' | 'shared'
  repo_path: string | null
  repo_rev: string | null
  archived: number
  created_at: number
  updated_at: number
  pageCount: number
}): WikiSpaceSummary {
  return {
    id: row.id,
    scope: row.scope,
    scopeRef: row.scope_ref,
    spaceType: row.space_type,
    name: row.name,
    description: row.description,
    icon: row.icon,
    visibility: row.visibility,
    repoPath: row.repo_path,
    repoRev: row.repo_rev,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pageCount: row.pageCount,
  }
}

function toPageMeta(row: {
  id: string
  space_id: string
  parent_id: string | null
  kind: WikiPageKind
  title: string
  slug: string
  summary: string
  tags_json: string
  status: 'draft' | 'published' | 'archived'
  version: number
  sort_order: number
  pinned: number
  source_type: string | null
  author_role: string | null
  hit_count: number
  created_at: number
  updated_at: number
}): WikiPageMeta {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags_json) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    // 损坏 tags 静默回退空数组
  }
  return {
    id: row.id,
    spaceId: row.space_id,
    parentId: row.parent_id,
    kind: row.kind,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    tags,
    status: row.status,
    version: row.version,
    sortOrder: row.sort_order,
    pinned: row.pinned === 1,
    sourceType: row.source_type,
    authorRole: row.author_role,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

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
  type WikiScope,
  type WikiSpaceType,
  type WikiPageKind,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createWikiServiceStack, resolveWikiBudgetFromSettings } from '@spark/agent-runtime'
import type {
  WikiPageMeta,
  WikiSpaceSummary,
  WikiPageVersionEntry,
  WikiBacklinkEntry,
  WikiRevisionDetail,
} from '@spark/protocol'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'
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
        tokens: Math.max(1, Math.round(r.body.length / 3)),
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

  /** 目录树拖拽移动：只改 parent_id / sort_order，不触碰正文与版本。 */
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
    sourceType: row.source_type,
    authorRole: row.author_role,
    hitCount: row.hit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

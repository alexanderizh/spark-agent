/**
 * @module registerWikiIpc
 *
 * 知识库 / Wiki IPC — 空间与页面 CRUD 骨架 + 检索（S0）。
 *
 * 设计约束：
 *   - 写入一律经 agent-runtime 的 WikiWriteService（统一写入原语：先文件后 DB、
 *     CAS、版本记录、FTS 同事务、indexReady 回执）——本文件不直写 repository。
 *   - 全部 handler 落本文件，ipc/index.ts 仅一行调用（主文件已 1.19 万行）。
 *   - S0 骨架面向 user scope 完整闭环；project scope 正文路径按空间所属
 *     workspace 的 root_path 解析。设置项复用 settings:get/set（键前缀 wiki/），
 *     预算档从 (category='wiki', key='budget/xxx') 读取。
 */

import {
  WikiSpaceRepository,
  WikiPageRepository,
  WikiSearchRepository,
  WikiRevisionRepository,
  WorkspaceRepository,
  SettingsRepository,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import {
  WikiStoreService,
  WikiSpaceService,
  WikiSearchService,
  WikiPageService,
  WikiWriteService,
  resolveWikiBudget,
} from '@spark/agent-runtime'
import type {
  WikiScope,
  WikiSpaceType,
  WikiPageKind,
  WikiPageMeta,
  WikiSpaceSummary,
  WikiPageVersionEntry,
} from '@spark/protocol'
import { typedIpcHandle } from './typed-ipc.js'
import { getDatabase } from '../db.js'
import { createLogger } from '@spark/shared'

const log = createLogger('ipc.wiki')

export function registerWikiIpc(): void {
  const db: SparkDatabase = getDatabase()
  const settingsRepo = new SettingsRepository(db)

  const getBudget = () =>
    resolveWikiBudget({
      readMaxTokens: settingsRepo.get('wiki', 'budget/readMaxTokens'),
      searchLimit: settingsRepo.get('wiki', 'budget/searchLimit'),
      summaryChars: settingsRepo.get('wiki', 'budget/summaryChars'),
      turnTotal: settingsRepo.get('wiki', 'budget/turnTotal'),
    })

  /** 按空间行解析 WikiStoreService（project scope 需要 workspace root）。 */
  const storeForSpace = async (spaceScope: WikiScope, scopeRef: string | null) => {
    let workspaceRootPath: string | undefined
    if (spaceScope === 'project' && scopeRef != null) {
      try {
        const workspace = new WorkspaceRepository(db).get(scopeRef)
        workspaceRootPath = workspace?.root_path ?? undefined
      } catch {
        // workspace 不在 → store 落 home 侧 orphan 路径（写入前校验会拒绝）
      }
    }
    return new WikiStoreService(undefined, workspaceRootPath)
  }

  const spaceRepo = new WikiSpaceRepository(db)
  const pageRepo = new WikiPageRepository(db)
  const searchRepo = new WikiSearchRepository(db)
  const revisionRepo = new WikiRevisionRepository(db)
  const spaceService = new WikiSpaceService(spaceRepo)
  const searchService = () => new WikiSearchService(searchRepo, getBudget())

  // ─── 空间 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:space:list', async (request) => {
    const scopes: Array<{ scope: WikiScope; scopeRef: string | null }> = request.scope
      ? [{ scope: request.scope, scopeRef: request.scopeRef ?? null }]
      : [
          { scope: 'user', scopeRef: null },
          // 全部视图：project 空间按任意 scope_ref 匹配（渲染端列表）
          ...listAllProjectScopes(db),
        ]
    const rows = spaceService.listSpaces(scopes, {
      ...(request.spaceType != null ? { spaceType: request.spaceType } : {}),
    })
    const spaces: WikiSpaceSummary[] = rows.map(toSpaceSummary)
    return { spaces }
  })

  typedIpcHandle('wiki:space:create', async (request) => {
    const writeService = new WikiWriteService(
      spaceRepo,
      pageRepo,
      revisionRepo,
      searchRepo,
      new WikiStoreService(),
    )
    const result = await writeService.createSpace({
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

  typedIpcHandle('wiki:space:archive', async (request) => {
    const space = spaceRepo.getById(request.spaceId)
    if (space == null) throw new Error('空间不存在')
    spaceRepo.archive(request.spaceId)
    log.info(`wiki space archived: ${request.spaceId}`)
    return { ok: true, id: request.spaceId, title: space.name, version: 1, indexReady: true }
  })

  // ─── 页面 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:page:list', async (request) => {
    const pages = pageRepo.listBySpace(request.spaceId, {
      ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
    })
    return { pages: pages.map(toPageMeta) }
  })

  typedIpcHandle('wiki:page:get', async (request) => {
    const page = pageRepo.getById(request.pageId)
    if (page == null) throw new Error('页面不存在')
    const space = spaceRepo.getById(page.space_id)
    if (space == null) throw new Error('页面所属空间不存在')
    const store = await storeForSpace(space.scope, space.scope_ref)
    const pageService = new WikiPageService(pageRepo, revisionRepo, store, getBudget())
    const r = await pageService.readFull(request.pageId)
    if (!r.ok) throw new Error(r.message)
    return {
      page: {
        ...toPageMeta(r.page),
        body: r.body,
        truncated: false,
        nextOffset: null,
        tokens: WikiPageService.estimatePageTokens(r.body),
      },
    }
  })

  typedIpcHandle('wiki:page:create', async (request) => {
    const space = spaceRepo.getById(request.spaceId)
    if (space == null) throw new Error('目标空间不存在')
    const store = await storeForSpace(space.scope, space.scope_ref)
    const writeService = new WikiWriteService(spaceRepo, pageRepo, revisionRepo, searchRepo, store)
    const result = await writeService.commitPage({
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
    const existing = pageRepo.getById(request.pageId)
    if (existing == null) throw new Error('页面不存在')
    const space = spaceRepo.getById(existing.space_id)
    if (space == null) throw new Error('页面所属空间不存在')
    const store = await storeForSpace(space.scope, space.scope_ref)
    const writeService = new WikiWriteService(spaceRepo, pageRepo, revisionRepo, searchRepo, store)
    const result = await writeService.commitPage({
      pageId: request.pageId,
      expectedVersion: request.expectedVersion,
      ...(request.title != null ? { title: request.title } : { title: existing.title }),
      ...(request.body != null ? { body: request.body } : {}),
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

  typedIpcHandle('wiki:page:archive', async (request) => {
    const page = pageRepo.getById(request.pageId)
    if (page == null) throw new Error('页面不存在')
    pageRepo.archive(request.pageId)
    log.info(`wiki page archived: ${request.pageId}`)
    return { ok: true, id: page.id, title: page.title, version: page.version, indexReady: true }
  })

  typedIpcHandle('wiki:page:history', async (request) => {
    const store = new WikiStoreService()
    const pageService = new WikiPageService(pageRepo, revisionRepo, store, getBudget())
    const versions: WikiPageVersionEntry[] = pageService.history(request.pageId)
    return { versions }
  })

  // ─── 检索 ─────────────────────────────────────────────────────────────

  typedIpcHandle('wiki:search', async (request) => {
    const result = searchService().search({
      query: request.query,
      ...(request.spaceIds != null ? { spaceIds: request.spaceIds } : {}),
      ...(request.kind != null ? { kind: request.kind } : {}),
      ...(request.limit != null ? { limit: request.limit } : {}),
    })
    return result
  })
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** 全部 project scope（scope_ref 任意）—— 渲染端"全部"视图用。 */
function listAllProjectScopes(db: SparkDatabase): Array<{ scope: WikiScope; scopeRef: string }> {
  try {
    const rows = db.raw
      .prepare(`SELECT id FROM workspaces`)
      .all() as Array<{ id: string }>
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

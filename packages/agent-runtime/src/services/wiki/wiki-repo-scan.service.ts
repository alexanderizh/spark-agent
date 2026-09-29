/**
 * @module wiki-repo-scan.service
 *
 * Repo Wiki 扫描编排（S4）—— 代码仓库 → 结构化知识页，可重建、可感知漂移。
 *
 * 设计要点（方案 §4.1 / §11.1 / §13 S4）：
 *   - Repo Wiki 是**派生知识**：与人工知识分离（space_type='repo'），
 *     可随代码变更重建，因此扫描必须幂等（同 rev 两次 rebuild 产出同正文）；
 *   - **只读默认**：生成页 source_type='repo-scan'，UI 不给编辑器；
 *     用户可"转人工维护"（'repo-scan-manual'）或"忽略该页"
 *     （'repo-scan-ignored'）——此后重建一律跳过，不覆盖人的改动；
 *   - **漂移可感知**：空间记录生成时的 repo_rev，与当前 HEAD 比较，
 *     落后提交数超过设置阈值即提示重建；
 *   - **成本可控**：文件数上限 + 忽略路径双重约束，截断时如实回报。
 *
 * 写入一律经 WikiWriteService（统一原语）：CAS / 版本记录 / FTS / 双链全部继承，
 * 因此重建产生的每次内容变化都在版本历史里留痕，可回退到任一扫描版本。
 */

import { statSync } from 'node:fs'
import * as path from 'node:path'
import { createLogger } from '@spark/shared'
import { hashWikiBody } from '@spark/storage'
import type {
  WikiPageRepository,
  WikiScope,
  WikiSpaceRepository,
  WikiSpaceRow,
} from '@spark/storage'
import { getDefaultGitCommandService, type GitCommandService } from '../git-command.service.js'
import type { WikiWriteService } from './wiki-write.service.js'
import {
  scanRepoTree,
  WIKI_REPO_DEFAULT_IGNORE,
  WIKI_REPO_DEFAULT_MAX_FILES,
} from './wiki-repo-scan-tree.js'
import { renderRepoPages } from './wiki-repo-scan-render.js'

const log = createLogger('wiki:repo-scan')

/** 生成页的 source_type（所有权标记，见 WikiPageWriteInput.sourceType） */
export const WIKI_REPO_SOURCE_TYPE = 'repo-scan'
export const WIKI_REPO_SOURCE_TYPE_MANUAL = 'repo-scan-manual'
export const WIKI_REPO_SOURCE_TYPE_IGNORED = 'repo-scan-ignored'

/** 页面所有权（用户可切换；决定重建时是否覆写） */
export type WikiRepoPageOwnership = 'generated' | 'manual' | 'ignored'

const OWNERSHIP_TO_SOURCE_TYPE: Record<WikiRepoPageOwnership, string> = {
  generated: WIKI_REPO_SOURCE_TYPE,
  manual: WIKI_REPO_SOURCE_TYPE_MANUAL,
  ignored: WIKI_REPO_SOURCE_TYPE_IGNORED,
}

/** 漂移提示缺省阈值（落后多少个提交提示重建；方案 §12 D 组） */
export const WIKI_REPO_DEFAULT_STALE_COMMITS = 20

export interface WikiRepoScanInput {
  repoPath: string
  /** 复用既有 repo 空间；缺省按 repo_path 查找或新建 */
  spaceId?: string
  scope?: WikiScope
  scopeRef?: string | null
  ignoreGlobs?: readonly string[]
  maxFiles?: number
}

export interface WikiRepoScanResult {
  ok: boolean
  spaceId?: string
  /** 本次扫描记录的代码版本 */
  repoRev?: string | null
  pagesCreated: number
  pagesUpdated: number
  /** 被跳过（人工接管 / 已忽略）的页面数 */
  pagesSkipped: number
  filesScanned: number
  truncated: boolean
  message?: string
}

export interface WikiRepoDriftStatus {
  spaceId: string
  repoPath: string | null
  /** 生成时记录的版本 */
  generatedRev: string | null
  /** 当前版本（取不到时为 null，如 git 不可用） */
  currentRev: string | null
  /** generatedRev 落后 currentRev 多少个提交（无法判定时为 null） */
  commitsBehind: number | null
  stale: boolean
  threshold: number
}

export interface WikiRepoScanServiceOptions {
  git?: GitCommandService
  staleCommits?: number
}

export class WikiRepoScanService {
  private readonly git: GitCommandService
  private readonly staleCommits: number

  constructor(
    private readonly spaceRepo: WikiSpaceRepository,
    private readonly pageRepo: WikiPageRepository,
    private readonly writeService: WikiWriteService,
    options: WikiRepoScanServiceOptions = {},
  ) {
    this.git = options.git ?? getDefaultGitCommandService()
    this.staleCommits = options.staleCommits ?? WIKI_REPO_DEFAULT_STALE_COMMITS
  }

  /** 扫描（或重建）一个仓库的 Repo Wiki。 */
  async scan(input: WikiRepoScanInput): Promise<WikiRepoScanResult> {
    const repoRoot = path.resolve(input.repoPath)
    if (!this.isDirectory(repoRoot)) {
      return { ...emptyResult(), ok: false, message: `仓库路径不存在或不是目录：${repoRoot}` }
    }

    const space = await this.resolveSpace(repoRoot, input)
    if (space == null) {
      return { ...emptyResult(), ok: false, message: '无法创建或定位 Repo Wiki 空间' }
    }

    const rev = await this.currentRev(repoRoot)
    const tree = scanRepoTree(repoRoot, {
      ignoreGlobs: input.ignoreGlobs ?? WIKI_REPO_DEFAULT_IGNORE,
      maxFiles: input.maxFiles ?? WIKI_REPO_DEFAULT_MAX_FILES,
    })
    const drafts = renderRepoPages(path.basename(repoRoot), rev, tree)

    let pagesCreated = 0
    let pagesUpdated = 0
    let pagesSkipped = 0

    for (const draft of drafts) {
      const existing = this.pageRepo.getBySlug(space.id, draft.slug)
      if (existing == null) {
        const written = await this.writeService.commitPage({
          spaceId: space.id,
          slug: draft.slug,
          kind: draft.kind,
          title: draft.title,
          summary: draft.summary,
          body: draft.body,
          status: 'published',
          authorRole: 'import',
          sourceType: WIKI_REPO_SOURCE_TYPE,
        })
        if (written.ok) pagesCreated += 1
        else log.warn(`repo page create failed: slug=${draft.slug} reason=${written.message}`)
        continue
      }
      // 只覆写"仍是生成态"的页面：人工接管 / 已忽略的一律跳过
      if (existing.source_type !== WIKI_REPO_SOURCE_TYPE) {
        pagesSkipped += 1
        continue
      }
      if (
        existing.title === draft.title &&
        existing.summary === draft.summary &&
        existing.content_hash === hashWikiBody(draft.body)
      ) {
        continue // 内容未变：不推进版本号（幂等）
      }
      const written = await this.writeService.commitPage({
        pageId: existing.id,
        expectedVersion: existing.version,
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        authorRole: 'import',
        sourceType: WIKI_REPO_SOURCE_TYPE,
      })
      if (written.ok) pagesUpdated += 1
      else log.warn(`repo page update failed: slug=${draft.slug} reason=${written.message}`)
    }

    // 记录生成版本（漂移检测的基线）
    this.spaceRepo.update(space.id, { repo_rev: rev })
    log.info(
      `repo wiki scanned: space=${space.id} rev=${rev ?? 'unknown'} files=${tree.files.length} ` +
        `created=${pagesCreated} updated=${pagesUpdated} skipped=${pagesSkipped}`,
    )

    return {
      ok: true,
      spaceId: space.id,
      repoRev: rev,
      pagesCreated,
      pagesUpdated,
      pagesSkipped,
      filesScanned: tree.files.length,
      truncated: tree.truncated,
    }
  }

  /** 重建（用空间上记录的 repo_path 重新扫描）。 */
  async rebuild(spaceId: string): Promise<WikiRepoScanResult> {
    const space = this.spaceRepo.getById(spaceId)
    if (space == null) return { ...emptyResult(), ok: false, message: '空间不存在' }
    if (space.space_type !== 'repo') {
      return { ...emptyResult(), ok: false, message: '该空间不是 Repo Wiki 空间' }
    }
    if (space.repo_path == null) {
      return { ...emptyResult(), ok: false, message: '空间未关联仓库路径' }
    }
    return this.scan({ repoPath: space.repo_path, spaceId })
  }

  /** 漂移状态（生成版本 vs 当前 HEAD）。 */
  async status(spaceId: string): Promise<WikiRepoDriftStatus | null> {
    const space = this.spaceRepo.getById(spaceId)
    if (space == null) return null
    const repoPath = space.repo_path
    if (repoPath == null || !this.isDirectory(repoPath)) {
      return {
        spaceId,
        repoPath,
        generatedRev: space.repo_rev,
        currentRev: null,
        commitsBehind: null,
        stale: false,
        threshold: this.staleCommits,
      }
    }
    const currentRev = await this.currentRev(repoPath)
    const commitsBehind =
      space.repo_rev != null && currentRev != null
        ? await this.countCommitsBehind(repoPath, space.repo_rev)
        : null
    return {
      spaceId,
      repoPath,
      generatedRev: space.repo_rev,
      currentRev,
      commitsBehind,
      stale: commitsBehind != null && commitsBehind >= this.staleCommits,
      threshold: this.staleCommits,
    }
  }

  /**
   * 切换页面所有权（生成态 / 人工接管 / 忽略）。
   *
   * 'manual' / 'ignored' 之后重建不再覆写该页；'generated' 则重新纳入重建
   * （内容会在下次扫描时被生成结果覆盖 —— 调用方须明确告知用户这一点）。
   */
  setOwnership(
    pageId: string,
    ownership: WikiRepoPageOwnership,
  ): { ok: boolean; message?: string } {
    const page = this.pageRepo.getById(pageId)
    if (page == null) return { ok: false, message: '页面不存在' }
    const space = this.spaceRepo.getById(page.space_id)
    if (space == null || space.space_type !== 'repo') {
      return { ok: false, message: '该页面不属于 Repo Wiki 空间' }
    }
    const sourceType = OWNERSHIP_TO_SOURCE_TYPE[ownership]
    if (page.source_type === sourceType) return { ok: true }
    // source_type 是元数据字段（非 title/summary 文本字段），不需要携带正文
    this.pageRepo.update(pageId, { source_type: sourceType })
    log.info(`repo page ownership: page=${pageId} -> ${ownership}`)
    return { ok: true }
  }

  /** 页面当前所有权（UI 据此决定是否给编辑器 / 显示什么操作）。 */
  ownershipOf(pageId: string): WikiRepoPageOwnership {
    const page = this.pageRepo.getById(pageId)
    if (page == null) return 'generated'
    switch (page.source_type) {
      case WIKI_REPO_SOURCE_TYPE_MANUAL:
        return 'manual'
      case WIKI_REPO_SOURCE_TYPE_IGNORED:
        return 'ignored'
      default:
        return 'generated'
    }
  }

  /** 定位或新建 repo 空间（同 repo_path 复用，避免重复空间堆积）。 */
  private async resolveSpace(
    repoRoot: string,
    input: WikiRepoScanInput,
  ): Promise<WikiSpaceRow | null> {
    if (input.spaceId != null) {
      const existing = this.spaceRepo.getById(input.spaceId)
      if (existing != null && existing.space_type === 'repo') return existing
      log.warn(`repo scan target space unusable: id=${input.spaceId}`)
      return null
    }
    const scope: WikiScope = input.scope ?? 'project'
    const scopeRef = input.scopeRef ?? null
    const sameRepo = this.spaceRepo
      .listByScopes([{ scope, scopeRef }], { spaceType: 'repo' })
      .find((s) => s.repo_path === repoRoot)
    if (sameRepo != null) return sameRepo

    const created = await this.writeService.createSpace({
      scope,
      scopeRef,
      spaceType: 'repo',
      name: path.basename(repoRoot),
      description: `由代码仓库生成：${repoRoot}`,
      createdBy: 'repo-scan',
      repoPath: repoRoot,
    })
    if (!created.ok) {
      log.warn(`repo space create failed: ${created.message}`)
      return null
    }
    return created.row
  }

  /** 当前 HEAD 短哈希（非 git 仓库 / git 不可用时返回 null，不阻断扫描）。 */
  private async currentRev(repoRoot: string): Promise<string | null> {
    try {
      const result = await this.git.execute(['rev-parse', '--short', 'HEAD'], {
        cwd: repoRoot,
        operation: 'read',
        allowedExitCodes: [0, 128],
      })
      if (result.exitCode !== 0) return null
      const rev = result.stdout.trim()
      return rev.length > 0 ? rev : null
    } catch {
      return null
    }
  }

  /** generatedRev 落后当前 HEAD 多少个提交（无法判定时 null）。 */
  private async countCommitsBehind(repoRoot: string, generatedRev: string): Promise<number | null> {
    try {
      const result = await this.git.execute(['rev-list', '--count', `${generatedRev}..HEAD`], {
        cwd: repoRoot,
        operation: 'read',
        allowedExitCodes: [0, 128],
      })
      if (result.exitCode !== 0) return null
      const count = Number.parseInt(result.stdout.trim(), 10)
      return Number.isFinite(count) && count >= 0 ? count : null
    } catch {
      return null
    }
  }

  private isDirectory(target: string): boolean {
    try {
      return statSync(target).isDirectory()
    } catch {
      return false
    }
  }
}

function emptyResult(): Omit<WikiRepoScanResult, 'ok' | 'message'> {
  return { pagesCreated: 0, pagesUpdated: 0, pagesSkipped: 0, filesScanned: 0, truncated: false }
}

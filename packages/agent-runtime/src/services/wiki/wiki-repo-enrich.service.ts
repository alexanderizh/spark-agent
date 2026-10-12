/**
 * @module wiki-repo-enrich.service
 *
 * Repo Wiki AI 导读编排（方案B §7）—— 闸门 → 空间互斥 → 差集计划 →
 * 并发受限逐页生成 → 入库 / 记失败 → 旧 rev GC。
 *
 * 三层失败隔离（C4）：
 *   1. 触发层：scan 的 enrich hook 由调用方 void 掉，异常止步于日志；
 *   2. 运行层：空间级互斥防「扫描自动触发 + 手动重跑」并发；无可用渠道
 *      整 run 静默退出（no_provider）；
 *   3. 逐页层：模型 null / 校验失败 / 入库异常 → 该页 status='failed' +
 *      error 原因分类，其余页照常（失败页在 UI 上 = 无 AI 块 = 纯骨架）。
 *
 * 闸门口径对齐抽取管道（wiki-extraction.service checkGate）：`repo/enrich/enabled`
 * 只管**自动触发**（扫描后异步增强）；手动重跑（用户显式点击）不受总闸限制——
 * 点击行为本身即成本授权。
 *
 * 所有权保护（C5）双重过滤：生成侧差集只纳入 source_type='repo-scan' 的模块页；
 * 展示侧 getSection 返回前重查页面当前 source_type（竞态窗口兜底）。
 */

import { createLogger } from '@spark/shared'
import type {
  SparkDatabase,
  WikiPageRepository,
  WikiRepoEnrichmentRepository,
  WikiSpaceRepository,
} from '@spark/storage'
import type {
  WikiRepoEnrichmentProgress,
  WikiRepoEnrichmentRunReceipt,
  WikiRepoEnrichmentSection,
} from '@spark/protocol'
import {
  resolveSessionTitleTarget,
  type SessionTitleTargetResolution,
} from '../session/session-title-target.js'
import { WIKI_REPO_PAGE_SLUGS } from './wiki-repo-scan-render.js'
import { WIKI_REPO_SOURCE_TYPE } from './wiki-repo-scan.service.js'
import {
  scanRepoTree,
  WIKI_REPO_DEFAULT_IGNORE,
  type WikiRepoScanTree,
} from './wiki-repo-scan-tree.js'
import { callWikiExtractionModel } from './wiki-extraction-model.js'
import type { WikiExtractionModelCall } from './wiki-extraction.service.js'
import { buildModuleEnrichContext, readRepoDependencyNames } from './wiki-repo-enrich-context.js'
import {
  WIKI_REPO_ENRICH_SYSTEM_PROMPT,
  buildModuleEnrichPrompt,
  validateEnrichSection,
} from './wiki-repo-enrich-prompt.js'

const log = createLogger('wiki:repo-enrich')

/** 单次失败原因分类（入库 error 字段与日志共用同一口径，不含正文片段） */
type WikiRepoEnrichFailureReason = 'model_failed' | 'invalid_output' | 'io_failed'

/**
 * 渠道解析注入点（测试免 Keychain）。
 *
 * profileId 非空 = 按 (category=wiki) 设置指定的渠道 id；
 * null = 默认运行时回落（桌面装配侧注入；agent-runtime 缺省实现直接判
 * 无渠道，与 Dream 的 resolveDefaultRuntime 同一接缝语义）。
 */
export type WikiRepoEnrichTargetResolver = (
  profileId: string | null,
) => Promise<SessionTitleTargetResolution>

export interface WikiRepoEnrichServiceDeps {
  /** DB 句柄（缺省渠道解析链读 Provider 档案用；对齐 WikiExtractionServiceDeps） */
  db: SparkDatabase
  /** 设置读取（(category, key) 二元组；缺省视为全部默认值 → 自动增强关） */
  settingsGet?: (category: string, key: string) => unknown
  /** 模型调用注入（测试用；缺省真实 HTTP） */
  callModel?: WikiExtractionModelCall
  /** 渠道解析注入（测试用；缺省按 profile id 解析，无默认运行时回落） */
  resolveTarget?: WikiRepoEnrichTargetResolver
}

/** 扫描后自动触发的入参（树复用，避免重复同步遍历） */
export interface WikiRepoEnrichScanHookParams {
  spaceId: string
  rev: string | null
  repoRoot: string
  tree: WikiRepoScanTree
}

const MODULE_SLUG_PREFIX = 'repo-module-'

export class WikiRepoEnrichService {
  private readonly db: SparkDatabase
  private readonly settingsGet: (category: string, key: string) => unknown
  private readonly callModel: WikiExtractionModelCall
  private readonly resolveTarget: WikiRepoEnrichTargetResolver
  /** 空间级互斥（Dream runningTracks 同款） */
  private readonly runningSpaces = new Set<string>()
  /** 进行中的 run（waitForIdle 测试辅助的观察面） */
  private readonly runs = new Map<string, Promise<WikiRepoEnrichmentRunReceipt>>()

  constructor(
    private readonly enrichRepo: WikiRepoEnrichmentRepository,
    private readonly spaceRepo: WikiSpaceRepository,
    private readonly pageRepo: WikiPageRepository,
    deps: WikiRepoEnrichServiceDeps,
  ) {
    this.db = deps.db
    this.settingsGet = deps.settingsGet ?? (() => undefined)
    this.callModel = deps.callModel ?? callWikiExtractionModel
    this.resolveTarget =
      deps.resolveTarget ??
      (async (profileId) => {
        if (profileId == null) return { ok: false, code: 'provider_missing' as const }
        return resolveSessionTitleTarget({
          db: this.db,
          session: { provider_profile_id: profileId, model_id: null },
        })
      })
  }

  // ─── 触发入口 ────────────────────────────────────────────────────────────

  /**
   * 扫描后自动增强（scan hook 调用；受 repo/enrich/enabled 总闸）。
   * 绝不向调用方抛异常（触发层隔离），内部已兜 try/catch。
   */
  async enrichAfterScan(params: WikiRepoEnrichScanHookParams): Promise<WikiRepoEnrichmentRunReceipt> {
    try {
      if (!this.booleanSetting('repo/enrich/enabled', false)) {
        return { ...emptyReceipt(), ok: false, reason: 'disabled' }
      }
      return await this.launch(params.spaceId, params.rev, params.repoRoot, params.tree, null)
    } catch (err) {
      log.error(`repo enrich run crashed: space=${params.spaceId} — ${errorMessage(err)}`)
      return { ...emptyReceipt(), ok: false, reason: 'no_provider' }
    }
  }

  /**
   * 手动重跑 / 补跑（IPC 调用；不受总闸限制——点击即成本授权）。
   * 从 space.repo_path + space.repo_rev 重新走 scanRepoTree（低频用户显式操作）。
   * 指定 slug = 单页强制重跑（跳过 ready 缓存差集，仍受所有权过滤）。
   */
  async runManually(params: {
    spaceId: string
    slug?: string | undefined
  }): Promise<WikiRepoEnrichmentRunReceipt> {
    try {
      const space = this.spaceRepo.getById(params.spaceId)
      if (space == null || space.space_type !== 'repo') {
        return { ...emptyReceipt(), ok: false, reason: 'not_repo_space', message: '空间不存在或不是 Repo Wiki 空间' }
      }
      if (space.repo_path == null) {
        return { ...emptyReceipt(), ok: false, reason: 'no_repo_path', message: '空间未关联仓库路径' }
      }
      if (space.repo_rev == null) {
        return { ...emptyReceipt(), ok: false, reason: 'no_rev', message: '空间未记录代码版本，先完成一次扫描' }
      }
      let forcedDir: string | null = null
      if (params.slug != null) {
        forcedDir = this.resolveDirForSlug(params.slug, space.repo_path, space.id)
        if (forcedDir == null) {
          return { ...emptyReceipt(), ok: false, reason: 'no_pages', message: `未找到可增强的模块页：${params.slug}` }
        }
      }
      const tree = scanRepoTree(space.repo_path, { ignoreGlobs: WIKI_REPO_DEFAULT_IGNORE })
      return await this.launch(space.id, space.repo_rev, space.repo_path, tree, forcedDir)
    } catch (err) {
      log.error(`repo enrich run crashed: space=${params.spaceId} — ${errorMessage(err)}`)
      return { ...emptyReceipt(), ok: false, reason: 'no_provider', message: errorMessage(err) }
    }
  }

  /** 等待该空间的进行中 run 结束（fire-and-forget 的测试信号；true=已空闲）。 */
  async waitForIdle(spaceId: string, timeoutMs = 60_000): Promise<boolean> {
    const running = this.runs.get(spaceId)
    if (running == null) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        running.then(
          () => true,
          () => true,
        ),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs)
        }),
      ])
    } finally {
      if (timer != null) clearTimeout(timer)
    }
  }

  // ─── 感知入口（读取 / 进度） ─────────────────────────────────────────────

  /**
   * 页面的 AI 导读段（展示侧双重过滤）。
   * 返回 null = 无 AI 块 → 渲染端回落纯骨架（静默回落语义）。
   */
  getSection(pageId: string): WikiRepoEnrichmentSection | null {
    const page = this.pageRepo.getById(pageId)
    if (page == null || page.kind === 'folder') return null
    const space = this.spaceRepo.getById(page.space_id)
    if (space == null || space.space_type !== 'repo' || space.repo_rev == null) return null
    // C5 展示侧：重查当前所有权——用户转 manual 的竞态窗口由这层兜住
    if (page.source_type !== WIKI_REPO_SOURCE_TYPE) return null
    const row = this.enrichRepo.get(space.id, page.slug, space.repo_rev)
    if (row == null || row.status !== 'ready') return null
    return {
      section: row.section,
      repoRev: row.repo_rev,
      model: row.model,
      provider: row.provider,
      updatedAt: row.updated_at,
    }
  }

  /** 空间级进度（面板轮询；纯 DB 查询，不触发扫描）。 */
  progress(spaceId: string): WikiRepoEnrichmentProgress {
    const space = this.spaceRepo.getById(spaceId)
    const repoRev = space?.repo_rev ?? null
    const rows = repoRev != null ? this.enrichRepo.getBySpace(spaceId, repoRev) : []
    const ready = rows.filter((r) => r.status === 'ready').length
    const failed = rows.filter((r) => r.status === 'failed').length
    const eligible = this.countEligibleModulePages(spaceId)
    return {
      running: this.runningSpaces.has(spaceId),
      repoRev,
      ready,
      failed,
      pending: Math.max(0, eligible - ready - failed),
    }
  }

  // ─── 编排内核 ────────────────────────────────────────────────────────────

  /** 互斥 + 登记 + 执行（busy 时结构化返回，不抛异常）。 */
  private launch(
    spaceId: string,
    rev: string | null,
    repoRoot: string,
    tree: WikiRepoScanTree,
    forcedDir: string | null,
  ): Promise<WikiRepoEnrichmentRunReceipt> {
    if (this.runningSpaces.has(spaceId)) {
      return Promise.resolve({
        ...emptyReceipt(),
        ok: false,
        reason: 'busy',
        message: '该空间的增强任务正在运行',
      })
    }
    this.runningSpaces.add(spaceId)
    const promise = this.executeRun({ spaceId, rev, repoRoot, tree, forcedDir }).finally(() => {
      this.runningSpaces.delete(spaceId)
      this.runs.delete(spaceId)
    })
    this.runs.set(spaceId, promise)
    return promise
  }

  private async executeRun(params: {
    spaceId: string
    rev: string | null
    repoRoot: string
    tree: WikiRepoScanTree
    forcedDir: string | null
  }): Promise<WikiRepoEnrichmentRunReceipt> {
    const { spaceId, rev, tree } = params
    const startedAt = Date.now()
    if (rev == null) {
      return { ...emptyReceipt(), ok: false, reason: 'no_rev', message: '未取到代码版本，跳过增强' }
    }

    // 渠道三级回落：repo/enrich/modelProfile → extract/modelProfile → 默认运行时
    const profileId =
      this.textSetting('repo/enrich/modelProfile') || this.textSetting('extract/modelProfile')
    const resolved = await this.resolveTarget(profileId.length > 0 ? profileId : null)
    if (!resolved.ok) {
      log.info(`repo enrich skipped: space=${spaceId} reason=no_provider code=${resolved.code}`)
      return { ...emptyReceipt(), ok: false, reason: 'no_provider', message: '没有可用的导读模型渠道' }
    }
    const { providerType, apiKey, apiEndpoint, apiEndpointFullUrl, model } = resolved.target

    // 差集计划 = 该 rev 下 slug 存在、页面仍是 repo-scan、无 ready 缓存的模块页
    const targetDirs = this.planTargetDirs(spaceId, tree)
    const cachedSlugs = new Set(
      this.enrichRepo
        .getBySpace(spaceId, rev)
        .filter((row) => row.status === 'ready')
        .map((row) => row.slug),
    )
    let cached = 0
    let plannedDirs: string[]
    if (params.forcedDir != null) {
      // 单页强制重跑：跳过 ready 缓存差集（所有权过滤已在 planTargetDirs 生效）
      plannedDirs = targetDirs.filter((dir) => dir === params.forcedDir)
    } else {
      plannedDirs = targetDirs.filter((dir) => {
        const slug = WIKI_REPO_PAGE_SLUGS.module(dir)
        if (cachedSlugs.has(slug)) {
          cached += 1
          return false
        }
        return true
      })
    }

    const maxPages = this.clampedNumberSetting('repo/enrich/maxPages', 20, 1, 50)
    const droppedByLimit = Math.max(0, plannedDirs.length - maxPages)
    const finalDirs = params.forcedDir != null ? plannedDirs : plannedDirs.slice(0, maxPages)

    log.info(
      `repo enrich planned: space=${spaceId} rev=${rev} target=${finalDirs.length} ` +
        `cached=${cached} droppedByLimit=${droppedByLimit}`,
    )

    let ready = 0
    let failed = 0
    if (finalDirs.length > 0) {
      const dependencyNames = readRepoDependencyNames(tree)
      const concurrency = this.clampedNumberSetting('repo/enrich/concurrency', 2, 1, 4)
      await runWithConcurrency(finalDirs, concurrency, async (dir) => {
        const outcome = await this.enrichOne({
          spaceId,
          rev,
          dir,
          tree,
          dependencyNames,
          target: { providerType, apiKey, apiEndpoint, apiEndpointFullUrl, model },
        })
        if (outcome) ready += 1
        else failed += 1
      })
    }

    // 成功跑完一个新 rev 后回收旧 rev 行（缓存体积上限 = 单空间单 rev 页面数）
    if (ready > 0) {
      const removed = this.enrichRepo.deleteStaleRevs(spaceId, rev)
      if (removed > 0) log.info(`repo enrich stale revs cleaned: space=${spaceId} removed=${removed}`)
    }

    const elapsedMs = Date.now() - startedAt
    log.info(
      `repo enrich done: space=${spaceId} rev=${rev} ready=${ready} failed=${failed} elapsedMs=${elapsedMs}`,
    )
    return {
      ok: true,
      target: finalDirs.length,
      cached,
      droppedByLimit,
      ready,
      failed,
    }
  }

  /** 单页生成（逐页隔离：任何异常都收敛为 failed 行，不影响其余页）。 */
  private async enrichOne(params: {
    spaceId: string
    rev: string
    dir: string
    tree: WikiRepoScanTree
    dependencyNames: string[]
    target: {
      providerType: string
      apiKey: string
      apiEndpoint?: string | undefined
      apiEndpointFullUrl?: boolean | undefined
      model: string
    }
  }): Promise<boolean> {
    const { spaceId, rev, dir, tree, dependencyNames, target } = params
    const ctx = buildModuleEnrichContext({ dir, tree, dependencyNames })
    const writeFailure = (reason: WikiRepoEnrichFailureReason): void => {
      this.enrichRepo.upsert({
        spaceId,
        slug: ctx.slug,
        repoRev: rev,
        section: '',
        status: 'failed',
        error: reason,
        model: target.model,
        provider: target.providerType,
      })
      log.warn(`repo enrich page failed: slug=${ctx.slug} reason=${reason}`)
    }
    try {
      const raw = await this.callModel({
        providerType: target.providerType,
        apiKey: target.apiKey,
        ...(target.apiEndpoint != null ? { apiEndpoint: target.apiEndpoint } : {}),
        ...(target.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
        model: target.model,
        system: WIKI_REPO_ENRICH_SYSTEM_PROMPT,
        prompt: buildModuleEnrichPrompt(ctx.material),
      })
      if (raw == null) {
        writeFailure('model_failed')
        return false
      }
      const validated = validateEnrichSection(raw)
      if (!validated.ok) {
        writeFailure('invalid_output')
        return false
      }
      this.enrichRepo.upsert({
        spaceId,
        slug: ctx.slug,
        repoRev: rev,
        section: validated.section,
        status: 'ready',
        model: target.model,
        provider: target.providerType,
      })
      log.info(
        `repo enrich section saved: slug=${ctx.slug} rev=${rev} model=${target.model} chars=${validated.section.length}`,
      )
      return true
    } catch (err) {
      writeFailure('io_failed')
      log.warn(`repo enrich page failed: slug=${ctx.slug} reason=io_failed detail=${errorMessage(err)}`)
      return false
    }
  }

  /**
   * 差集计划的目标目录（生成侧所有权过滤，C5）：
   * 树的顶层目录中，slug 对应页面存在、仍是 repo-scan 生成态、未归档的。
   */
  private planTargetDirs(spaceId: string, tree: WikiRepoScanTree): string[] {
    return tree.topDirs.filter((dir) => {
      const page = this.pageRepo.getBySlug(spaceId, WIKI_REPO_PAGE_SLUGS.module(dir))
      return (
        page != null &&
        page.kind !== 'folder' &&
        page.source_type === WIKI_REPO_SOURCE_TYPE &&
        page.status !== 'archived'
      )
    })
  }

  /** slug → 顶层目录（单页重跑定位；复用差集计划的所有权过滤，manual/ignored 页拒绝）。 */
  private resolveDirForSlug(slug: string, repoPath: string, spaceId: string): string | null {
    const tree = scanRepoTree(repoPath, { ignoreGlobs: WIKI_REPO_DEFAULT_IGNORE })
    return (
      this.planTargetDirs(spaceId, tree).find(
        (dir) => WIKI_REPO_PAGE_SLUGS.module(dir) === slug,
      ) ?? null
    )
  }

  /** 该空间可增强模块页计数（进度用；页面侧口径，与差集计划一致）。 */
  private countEligibleModulePages(spaceId: string): number {
    return this.pageRepo
      .listBySpace(spaceId)
      .filter(
        (page) =>
          page.slug.startsWith(MODULE_SLUG_PREFIX) &&
          page.source_type === WIKI_REPO_SOURCE_TYPE &&
          page.status !== 'archived',
      ).length
  }

  private booleanSetting(key: string, fallback: boolean): boolean {
    const raw = this.settingsGet('wiki', key)
    return typeof raw === 'boolean' ? raw : fallback
  }

  private textSetting(key: string): string {
    const raw = this.settingsGet('wiki', key)
    return typeof raw === 'string' ? raw.trim() : ''
  }

  /** 数字设置读取 + 硬上下限钳制（设置层已拒绝越界写入，此处防绕过 UI 的值）。 */
  private clampedNumberSetting(key: string, fallback: number, hardMin: number, hardMax: number): number {
    const raw = this.settingsGet('wiki', key)
    const value = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : fallback
    return Math.min(hardMax, Math.max(hardMin, value))
  }
}

function emptyReceipt(): Omit<WikiRepoEnrichmentRunReceipt, 'ok'> {
  return { target: 0, cached: 0, droppedByLimit: 0, ready: 0, failed: 0 }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 并发受限执行（自写信号量，无新依赖）：同一时刻最多 limit 个 fn 在飞，
 * 某个 fn 抛异常不中断其余项（调用方在 fn 内自行收敛异常）。
 */
async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      if (item !== undefined) await fn(item)
    }
  })
  await Promise.all(workers)
}

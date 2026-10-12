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
 * 所有权保护（C5）双重过滤：生成侧差集只纳入 source_type='repo-scan' 的目标页
 * （综述页 + 模块页）；展示侧 getSection 返回前重查页面当前 source_type
 * （竞态窗口兜底）。
 *
 * S3 综述：repo-overview 页纳入增强计划（排首位，不占 maxPages 模块配额——
 * 设置口径即「模块页数」），材料/提示词/校验小节按页变体分派。
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
import {
  buildModuleEnrichContext,
  buildOverviewEnrichContext,
  readRepoDependencyNames,
} from './wiki-repo-enrich-context.js'
import {
  WIKI_REPO_ENRICH_REQUIRED_SECTIONS,
  WIKI_REPO_ENRICH_SYSTEM_PROMPT,
  WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS,
  WIKI_REPO_OVERVIEW_SYSTEM_PROMPT,
  buildModuleEnrichPrompt,
  buildOverviewEnrichPrompt,
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

/**
 * 单个增强目标：综述页（repo-overview，S3）或模块页（repo-module-*）。
 * 材料、提示词与校验小节按 kind 分派；slug 是缓存/差集/GC 的统一身份。
 */
type WikiRepoEnrichPlanTarget =
  | { kind: 'overview'; slug: string }
  | { kind: 'module'; dir: string; slug: string }

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
  async enrichAfterScan(
    params: WikiRepoEnrichScanHookParams,
  ): Promise<WikiRepoEnrichmentRunReceipt> {
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
   * 指定 slug = 单页强制重跑（综述页或模块页；跳过 ready 缓存差集，仍受所有权过滤）。
   */
  async runManually(params: {
    spaceId: string
    slug?: string | undefined
  }): Promise<WikiRepoEnrichmentRunReceipt> {
    try {
      const space = this.spaceRepo.getById(params.spaceId)
      if (space == null || space.space_type !== 'repo') {
        return {
          ...emptyReceipt(),
          ok: false,
          reason: 'not_repo_space',
          message: '空间不存在或不是 Repo Wiki 空间',
        }
      }
      if (space.repo_path == null) {
        return {
          ...emptyReceipt(),
          ok: false,
          reason: 'no_repo_path',
          message: '空间未关联仓库路径',
        }
      }
      if (space.repo_rev == null) {
        return {
          ...emptyReceipt(),
          ok: false,
          reason: 'no_rev',
          message: '空间未记录代码版本，先完成一次扫描',
        }
      }
      let forced: WikiRepoEnrichPlanTarget | null = null
      if (params.slug != null) {
        forced = this.resolveForcedTarget(params.slug, space.repo_path, space.id)
        if (forced == null) {
          return {
            ...emptyReceipt(),
            ok: false,
            reason: 'no_pages',
            message: `未找到可增强的页面：${params.slug}`,
          }
        }
      }
      const tree = scanRepoTree(space.repo_path, { ignoreGlobs: WIKI_REPO_DEFAULT_IGNORE })
      return await this.launch(space.id, space.repo_rev, space.repo_path, tree, forced)
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
    const eligible = this.countEligiblePages(spaceId)
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
    forced: WikiRepoEnrichPlanTarget | null,
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
    const promise = this.executeRun({ spaceId, rev, repoRoot, tree, forced }).finally(() => {
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
    forced: WikiRepoEnrichPlanTarget | null
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
      return {
        ...emptyReceipt(),
        ok: false,
        reason: 'no_provider',
        message: '没有可用的导读模型渠道',
      }
    }
    const { providerType, apiKey, apiEndpoint, apiEndpointFullUrl, model } = resolved.target

    // 计划全集 = 综述页（排首位）+ 模块页；资格口径一致（存在、repo-scan、未归档）
    const overviewTarget = this.planOverviewTarget(spaceId)
    const plannedAll: WikiRepoEnrichPlanTarget[] = [
      ...(overviewTarget != null ? [overviewTarget] : []),
      ...this.planModuleTargets(spaceId, tree),
    ]
    // 差集计划 = 该 rev 下无 ready 缓存的目标页（slug 统一身份）
    const cachedSlugs = new Set(
      this.enrichRepo
        .getBySpace(spaceId, rev)
        .filter((row) => row.status === 'ready')
        .map((row) => row.slug),
    )
    let cached = 0
    let planned: WikiRepoEnrichPlanTarget[]
    if (params.forced != null) {
      // 单页强制重跑：跳过 ready 缓存差集（所有权过滤已在计划阶段生效）
      const forcedSlug = params.forced.slug
      planned = plannedAll.filter((t) => t.slug === forcedSlug)
    } else {
      planned = plannedAll.filter((t) => {
        if (cachedSlugs.has(t.slug)) {
          cached += 1
          return false
        }
        return true
      })
    }

    // maxPages 只约束模块目标（设置口径即「模块页数」）；综述页单页固定成本，
    // 排计划首位且不占配额——maxPages=1 时仍保证综述 + 1 个模块页
    const maxPages = this.clampedNumberSetting('repo/enrich/maxPages', 20, 1, 50)
    let finalTargets: WikiRepoEnrichPlanTarget[]
    let droppedByLimit = 0
    if (params.forced != null) {
      finalTargets = planned
    } else {
      const plannedOverview = planned.filter((t) => t.kind === 'overview')
      const plannedModules = planned.filter((t) => t.kind === 'module')
      droppedByLimit = Math.max(0, plannedModules.length - maxPages)
      finalTargets = [...plannedOverview, ...plannedModules.slice(0, maxPages)]
    }

    log.info(
      `repo enrich planned: space=${spaceId} rev=${rev} target=${finalTargets.length} ` +
        `cached=${cached} droppedByLimit=${droppedByLimit}`,
    )

    let ready = 0
    let failed = 0
    if (finalTargets.length > 0) {
      const dependencyNames = readRepoDependencyNames(tree)
      const concurrency = this.clampedNumberSetting('repo/enrich/concurrency', 2, 1, 4)
      await runWithConcurrency(finalTargets, concurrency, async (plan) => {
        const outcome = await this.enrichOne({
          spaceId,
          rev,
          plan,
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
      if (removed > 0)
        log.info(`repo enrich stale revs cleaned: space=${spaceId} removed=${removed}`)
    }

    const elapsedMs = Date.now() - startedAt
    log.info(
      `repo enrich done: space=${spaceId} rev=${rev} ready=${ready} failed=${failed} elapsedMs=${elapsedMs}`,
    )
    return {
      ok: true,
      target: finalTargets.length,
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
    plan: WikiRepoEnrichPlanTarget
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
    const { spaceId, rev, plan, tree, dependencyNames, target } = params
    // 变体分派：材料 / 系统提示 / 校验小节按页 kind 切换，其余链路同构
    const material =
      plan.kind === 'overview'
        ? buildOverviewEnrichContext({ tree, dependencyNames }).material
        : buildModuleEnrichContext({ dir: plan.dir, tree, dependencyNames }).material
    const system =
      plan.kind === 'overview' ? WIKI_REPO_OVERVIEW_SYSTEM_PROMPT : WIKI_REPO_ENRICH_SYSTEM_PROMPT
    const prompt =
      plan.kind === 'overview'
        ? buildOverviewEnrichPrompt(material)
        : buildModuleEnrichPrompt(material)
    const requiredSections =
      plan.kind === 'overview'
        ? WIKI_REPO_OVERVIEW_REQUIRED_SECTIONS
        : WIKI_REPO_ENRICH_REQUIRED_SECTIONS
    const writeFailure = (reason: WikiRepoEnrichFailureReason): void => {
      this.enrichRepo.upsert({
        spaceId,
        slug: plan.slug,
        repoRev: rev,
        section: '',
        status: 'failed',
        error: reason,
        model: target.model,
        provider: target.providerType,
      })
      log.warn(`repo enrich page failed: slug=${plan.slug} reason=${reason}`)
    }
    try {
      const raw = await this.callModel({
        providerType: target.providerType,
        apiKey: target.apiKey,
        ...(target.apiEndpoint != null ? { apiEndpoint: target.apiEndpoint } : {}),
        ...(target.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
        model: target.model,
        system,
        prompt,
      })
      if (raw == null) {
        writeFailure('model_failed')
        return false
      }
      const validated = validateEnrichSection(raw, requiredSections)
      if (!validated.ok) {
        writeFailure('invalid_output')
        return false
      }
      this.enrichRepo.upsert({
        spaceId,
        slug: plan.slug,
        repoRev: rev,
        section: validated.section,
        status: 'ready',
        model: target.model,
        provider: target.providerType,
      })
      log.info(
        `repo enrich section saved: slug=${plan.slug} rev=${rev} model=${target.model} chars=${validated.section.length}`,
      )
      return true
    } catch (err) {
      writeFailure('io_failed')
      log.warn(
        `repo enrich page failed: slug=${plan.slug} reason=io_failed detail=${errorMessage(err)}`,
      )
      return false
    }
  }

  /** 综述页目标（资格与模块页同口径：存在、非 folder、repo-scan、未归档）。 */
  private planOverviewTarget(spaceId: string): WikiRepoEnrichPlanTarget | null {
    const page = this.pageRepo.getBySlug(spaceId, WIKI_REPO_PAGE_SLUGS.overview)
    if (
      page == null ||
      page.kind === 'folder' ||
      page.source_type !== WIKI_REPO_SOURCE_TYPE ||
      page.status === 'archived'
    ) {
      return null
    }
    return { kind: 'overview', slug: page.slug }
  }

  /**
   * 差集计划的模块目标（生成侧所有权过滤，C5）：
   * 树的顶层目录中，slug 对应页面存在、仍是 repo-scan 生成态、未归档的。
   */
  private planModuleTargets(spaceId: string, tree: WikiRepoScanTree): WikiRepoEnrichPlanTarget[] {
    return tree.topDirs
      .filter((dir) => {
        const page = this.pageRepo.getBySlug(spaceId, WIKI_REPO_PAGE_SLUGS.module(dir))
        return (
          page != null &&
          page.kind !== 'folder' &&
          page.source_type === WIKI_REPO_SOURCE_TYPE &&
          page.status !== 'archived'
        )
      })
      .map((dir) => ({ kind: 'module' as const, dir, slug: WIKI_REPO_PAGE_SLUGS.module(dir) }))
  }

  /**
   * slug → 强制重跑目标（单页重跑定位；综述页免重扫树，模块页复用
   * 计划阶段的所有权过滤，manual/ignored 页拒绝）。
   */
  private resolveForcedTarget(
    slug: string,
    repoPath: string,
    spaceId: string,
  ): WikiRepoEnrichPlanTarget | null {
    const overview = this.planOverviewTarget(spaceId)
    if (overview != null && overview.slug === slug) return overview
    const tree = scanRepoTree(repoPath, { ignoreGlobs: WIKI_REPO_DEFAULT_IGNORE })
    return this.planModuleTargets(spaceId, tree).find((t) => t.slug === slug) ?? null
  }

  /** 该空间可增强页计数（进度用；综述页 + 模块页，与计划阶段口径一致）。 */
  private countEligiblePages(spaceId: string): number {
    const modulePages = this.pageRepo
      .listBySpace(spaceId)
      .filter(
        (page) =>
          page.slug.startsWith(MODULE_SLUG_PREFIX) &&
          page.source_type === WIKI_REPO_SOURCE_TYPE &&
          page.status !== 'archived',
      ).length
    return modulePages + (this.planOverviewTarget(spaceId) != null ? 1 : 0)
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
  private clampedNumberSetting(
    key: string,
    fallback: number,
    hardMin: number,
    hardMax: number,
  ): number {
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

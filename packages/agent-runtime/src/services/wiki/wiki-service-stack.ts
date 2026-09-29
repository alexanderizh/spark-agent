/**
 * @module wiki-service-stack
 *
 * Wiki 服务栈装配工厂 —— 所有调用方（会话 Agent 路径 / 桌面 IPC 路径 / 测试）
 * 必须经此构造服务组合，避免「某处忘了注入双链服务」这类静默降级。
 *
 * 为什么需要工厂：WikiWriteService 依赖双链服务（派生数据同步），若各调用点
 * 各自 new，漏传一个参数就会让链路静默少一半能力（memory 的 6 处入口不一致
 * 教训）。集中构造让「装配完整性」只有一处可出错，且返回类型强制完整。
 */

import type { SparkDatabase } from '@spark/storage'
import {
  SkillRepository,
  WikiCandidateRepository,
  WikiExtractionStateRepository,
  WikiLinkRepository,
  WikiPageRepository,
  WikiRevisionRepository,
  WikiSearchRepository,
  WikiSkillProposalRepository,
  WikiSourceRepository,
  WikiSpaceRepository,
} from '@spark/storage'
import { WikiStoreService } from './wiki-store.service.js'
import { WikiLinkService } from './wiki-link.service.js'
import { WikiPageService } from './wiki-page.service.js'
import { WikiSearchService } from './wiki-search.service.js'
import { WikiSpaceService } from './wiki-space.service.js'
import { WikiWriteService } from './wiki-write.service.js'
import { WikiCandidateService } from './wiki-candidate.service.js'
import { WikiSkillProposerService } from './wiki-skill-proposer.service.js'
import { WikiRepoScanService } from './wiki-repo-scan.service.js'
import {
  WikiExtractionService,
  type WikiExtractionModelCall,
  type WikiExtractionTargetResolver,
} from './wiki-extraction.service.js'
import { resolveWikiBudget, type WikiBudgetProfile } from './wiki-context-budget.js'

export interface WikiServiceStackInput {
  db: SparkDatabase
  /** 预算档（已钳制到硬上限）；缺省用默认值 */
  budget?: WikiBudgetProfile
  /** project scope 正文文件根（会话 workspace / 仓库根） */
  workspaceRootPath?: string
  /** 应用 home 目录（测试可注入临时目录） */
  appHomeDir?: string
  /** 设置读取（(category, key) 二元组）；抽取管道据此读触发闸门与候选策略 */
  settingsGet?: (category: string, key: string) => unknown
  /** 抽取模型调用注入（测试用；缺省真实 HTTP 调用） */
  extractionCallModel?: WikiExtractionModelCall
  /** 抽取渠道解析注入（测试用；缺省走真实解析链，含 Keychain） */
  extractionResolveTarget?: WikiExtractionTargetResolver
  /**
   * 技能仓储注入（S3 提议接受时登记技能）。缺省时内部新建一个
   * （桌面侧传入共享实例，保证与技能管理界面看到同一份数据）。
   */
  skillRepo?: SkillRepository
  /** 用户技能落盘根目录（AppSkillsManager.userDir）；S3 接受时写 SKILL.md/PURPOSE.md */
  skillsRootDir?: string
  /** 漂移提示阈值（落后多少个提交提示重建；方案 §12 D 组 wiki/repo/staleCommits） */
  staleCommits?: number
}

export interface WikiServiceStack {
  spaceRepo: WikiSpaceRepository
  pageRepo: WikiPageRepository
  searchRepo: WikiSearchRepository
  revisionRepo: WikiRevisionRepository
  linkRepo: WikiLinkRepository
  candidateRepo: WikiCandidateRepository
  sourceRepo: WikiSourceRepository
  extractionStateRepo: WikiExtractionStateRepository
  skillProposalRepo: WikiSkillProposalRepository
  store: WikiStoreService
  budget: WikiBudgetProfile
  spaceService: WikiSpaceService
  searchService: WikiSearchService
  pageService: WikiPageService
  linkService: WikiLinkService
  writeService: WikiWriteService
  candidateService: WikiCandidateService
  extractionService: WikiExtractionService
  skillProposerService: WikiSkillProposerService
  repoScanService: WikiRepoScanService
}

/** 从设置读取构建预算档（(category='wiki', key='budget/xxx') 二元组契约）。 */
export function resolveWikiBudgetFromSettings(
  get: (category: string, key: string) => unknown,
): WikiBudgetProfile {
  return resolveWikiBudget({
    readMaxTokens: get('wiki', 'budget/readMaxTokens'),
    searchLimit: get('wiki', 'budget/searchLimit'),
    summaryChars: get('wiki', 'budget/summaryChars'),
    turnTotal: get('wiki', 'budget/turnTotal'),
  })
}

export function createWikiServiceStack(input: WikiServiceStackInput): WikiServiceStack {
  const { db } = input
  const budget = input.budget ?? resolveWikiBudget({})
  const store = new WikiStoreService(input.appHomeDir, input.workspaceRootPath)
  const skillRepo = input.skillRepo ?? new SkillRepository(db)

  const spaceRepo = new WikiSpaceRepository(db)
  const pageRepo = new WikiPageRepository(db)
  const searchRepo = new WikiSearchRepository(db)
  const revisionRepo = new WikiRevisionRepository(db)
  const linkRepo = new WikiLinkRepository(db)
  const candidateRepo = new WikiCandidateRepository(db)
  const sourceRepo = new WikiSourceRepository(db)
  const extractionStateRepo = new WikiExtractionStateRepository(db)
  const skillProposalRepo = new WikiSkillProposalRepository(db)

  const linkService = new WikiLinkService(pageRepo, linkRepo)
  const writeService = new WikiWriteService(
    spaceRepo,
    pageRepo,
    revisionRepo,
    searchRepo,
    store,
    linkService,
  )
  const candidateService = new WikiCandidateService(
    candidateRepo,
    sourceRepo,
    spaceRepo,
    writeService,
  )
  const extractionService = new WikiExtractionService(
    candidateRepo,
    extractionStateRepo,
    spaceRepo,
    {
      db,
      ...(input.settingsGet != null ? { settingsGet: input.settingsGet } : {}),
      ...(input.extractionCallModel != null ? { callModel: input.extractionCallModel } : {}),
      ...(input.extractionResolveTarget != null
        ? { resolveTarget: input.extractionResolveTarget }
        : {}),
    },
  )

  return {
    spaceRepo,
    pageRepo,
    searchRepo,
    revisionRepo,
    linkRepo,
    candidateRepo,
    sourceRepo,
    extractionStateRepo,
    skillProposalRepo,
    store,
    budget,
    spaceService: new WikiSpaceService(spaceRepo),
    searchService: new WikiSearchService(searchRepo, budget),
    pageService: new WikiPageService(pageRepo, revisionRepo, store, budget),
    linkService,
    writeService,
    candidateService,
    extractionService,
    skillProposerService: new WikiSkillProposerService(skillProposalRepo, pageRepo, skillRepo, {
      ...(input.skillsRootDir != null ? { skillsRootDir: input.skillsRootDir } : {}),
    }),
    repoScanService: new WikiRepoScanService(spaceRepo, pageRepo, writeService, {
      ...(input.staleCommits != null ? { staleCommits: input.staleCommits } : {}),
    }),
  }
}

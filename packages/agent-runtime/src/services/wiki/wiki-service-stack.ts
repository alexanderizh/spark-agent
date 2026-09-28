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
  WikiLinkRepository,
  WikiPageRepository,
  WikiRevisionRepository,
  WikiSearchRepository,
  WikiSpaceRepository,
} from '@spark/storage'
import { WikiStoreService } from './wiki-store.service.js'
import { WikiLinkService } from './wiki-link.service.js'
import { WikiPageService } from './wiki-page.service.js'
import { WikiSearchService } from './wiki-search.service.js'
import { WikiSpaceService } from './wiki-space.service.js'
import { WikiWriteService } from './wiki-write.service.js'
import { resolveWikiBudget, type WikiBudgetProfile } from './wiki-context-budget.js'

export interface WikiServiceStackInput {
  db: SparkDatabase
  /** 预算档（已钳制到硬上限）；缺省用默认值 */
  budget?: WikiBudgetProfile
  /** project scope 正文文件根（会话 workspace / 仓库根） */
  workspaceRootPath?: string
  /** 应用 home 目录（测试可注入临时目录） */
  appHomeDir?: string
}

export interface WikiServiceStack {
  spaceRepo: WikiSpaceRepository
  pageRepo: WikiPageRepository
  searchRepo: WikiSearchRepository
  revisionRepo: WikiRevisionRepository
  linkRepo: WikiLinkRepository
  store: WikiStoreService
  budget: WikiBudgetProfile
  spaceService: WikiSpaceService
  searchService: WikiSearchService
  pageService: WikiPageService
  linkService: WikiLinkService
  writeService: WikiWriteService
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

  const spaceRepo = new WikiSpaceRepository(db)
  const pageRepo = new WikiPageRepository(db)
  const searchRepo = new WikiSearchRepository(db)
  const revisionRepo = new WikiRevisionRepository(db)
  const linkRepo = new WikiLinkRepository(db)

  const linkService = new WikiLinkService(pageRepo, linkRepo)

  return {
    spaceRepo,
    pageRepo,
    searchRepo,
    revisionRepo,
    linkRepo,
    store,
    budget,
    spaceService: new WikiSpaceService(spaceRepo),
    searchService: new WikiSearchService(searchRepo, budget),
    pageService: new WikiPageService(pageRepo, revisionRepo, store, budget),
    linkService,
    writeService: new WikiWriteService(
      spaceRepo,
      pageRepo,
      revisionRepo,
      searchRepo,
      store,
      linkService,
    ),
  }
}

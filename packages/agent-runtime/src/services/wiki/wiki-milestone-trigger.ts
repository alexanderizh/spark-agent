/**
 * @module wiki-milestone-trigger
 *
 * 里程碑自动沉淀触发器（milestone 接线，方案 §5）——「谁来拨动开关」的答案。
 *
 * 挂在 runTurnPostProcessing（三引擎成功终态收敛点）之后、fire-and-forget：
 *   本地特征门槛（零模型调用）→ setTimeout 防抖 → 到期复查护栏 → distill(milestone)。
 *
 * 失败语义（与抽取管道既有承诺对齐，§5.5）：
 *   - 回执 ok:false 或意外异常只写日志，不重试、不重排定时器；
 *   - 触发链路任何异常绝不冒泡到主链（与 maybeWriteMemoryFromTurn 同款纪律）；
 *   - 下一次合格 settle 自然重新武装（水位线未推进，同批内容下次仍会采到）。
 *
 * 频次护栏（防抖重置 / 最小间隔 / 每日上限）全部是进程内存态，不持久化——
 * 重启清零是可接受的宽松方向（多触发一次也受水位线增量与去重约束）。
 */

import { createLogger } from '@spark/shared'
import { EventRepository, WikiExtractionStateRepository, type SparkDatabase } from '@spark/storage'
import type { AgentEvent, WikiExtractionReceipt } from '@spark/protocol'
import { sampleWikiExtractionTurns } from './wiki-extraction-sampler.js'
import { createWikiServiceStack, resolveWikiBudgetFromSettings } from './wiki-service-stack.js'
import { hasWikiMilestoneDeliverySignal } from './wiki-milestone-signals.js'

const log = createLogger('wiki:milestone')

/** 追踪会话数上限：防长生命周期进程内存增长，超限逐出最旧（Map 插入序）。 */
const MAX_TRACKED_SESSIONS = 500

export interface WikiMilestoneTriggerDeps {
  /** 设置读取（(category, key) 二元组）；阈值与开关逐次读取，改设置即时生效 */
  settingsGet: (category: string, key: string) => unknown
  /** 轮次注册表：到期复查「会话又在跑则跳过」的判定来源 */
  turnRegistry: { hasActiveSession(sessionId: string): boolean }
  /** 水位线之后新增的有效轮次数（默认实现见 createWikiMilestoneRuntime） */
  countUnextractedTurns: (sessionId: string) => number
  /** 发起 milestone 蒸馏（默认实现见 createWikiMilestoneRuntime） */
  distill: (sessionId: string) => Promise<WikiExtractionReceipt>
  /** 候选产出通知（P1：回执 ok 且 inserted>0 时调用；零产出不打扰） */
  notifyCandidatesReady?: (sessionId: string, inserted: number) => void
}

export interface WikiMilestoneTurnSignal {
  sessionId: string
  turnId: string
  /** 本轮助手完整归并正文（交付 / 修复关键词命中源） */
  assistantTurnText: string
  primaryWorkspaceId?: string | undefined
  /** 本轮文件变更数（claude 引擎闭包现成；codex / spark 暂缺省，靠关键词兜底） */
  fileChangeCount?: number | undefined
}

export class WikiMilestoneTrigger {
  /** 每会话至多一个待触发定时器；同会话新 settle 到来时重置（重新计时）。 */
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 两次 milestone 最小间隔判定（发起时刻记录：失败也计，防快速重烧）。 */
  private readonly lastRunAt = new Map<string, number>()
  /** 每日上限判定（本地日期字符串；跨日自然重置）。 */
  private readonly dailyCount = new Map<string, { day: string; count: number }>()

  constructor(private readonly deps: WikiMilestoneTriggerDeps) {}

  /**
   * 轮次成功终态入口。同步返回，内部全异步旁路，任何路径都不抛异常。
   */
  onTurnSettled(signal: WikiMilestoneTurnSignal): void {
    try {
      const keywordHit = hasWikiMilestoneDeliverySignal(signal.assistantTurnText)
      const fileChanged = (signal.fileChangeCount ?? 0) > 0
      if (!keywordHit && !fileChanged) {
        log.debug(`skip: reason=no_signal session=${signal.sessionId} turn=${signal.turnId}`)
        return
      }
      const minTurns = Math.max(1, this.numberSetting('extract/milestoneMinTurns', 3))
      const unextracted = this.deps.countUnextractedTurns(signal.sessionId)
      if (unextracted < minTurns) {
        log.debug(
          `skip: reason=min_turns session=${signal.sessionId} unextracted=${unextracted} ` +
            `minTurns=${minTurns}`,
        )
        return
      }
      log.debug(
        `turn settled: session=${signal.sessionId} turn=${signal.turnId} ` +
          `keywordHit=${keywordHit} fileChanges=${signal.fileChangeCount ?? 0} ` +
          `unextracted=${unextracted}`,
      )
      this.armDebounce(signal.sessionId)
    } catch (error) {
      log.warn(
        `milestone trigger failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 清理全部定时器与内存 Map（SessionService.dispose 时调用）。 */
  dispose(): void {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer)
    this.pendingTimers.clear()
    this.lastRunAt.clear()
    this.dailyCount.clear()
  }

  /** 防抖武装：连续 settle 自动重置定时器——会话停下来才开始真正倒计时。 */
  private armDebounce(sessionId: string): void {
    const existing = this.pendingTimers.get(sessionId)
    if (existing != null) clearTimeout(existing)
    const delayMs = Math.max(1, this.numberSetting('extract/milestoneDelayMinutes', 3)) * 60_000
    const timer = setTimeout(() => {
      this.pendingTimers.delete(sessionId)
      void this.fire(sessionId)
    }, delayMs)
    setWithCap(this.pendingTimers, sessionId, timer, (evicted) => clearTimeout(evicted))
    log.debug(`debounce (re)armed: session=${sessionId} delayMs=${delayMs}`)
  }

  /** 到期复查 + 发起蒸馏。护栏计数在发起时刻记录（失败不重试，但也占一次名额）。 */
  private async fire(sessionId: string): Promise<void> {
    try {
      const enabled = this.booleanSetting('extract/milestone', true)
      if (!enabled) {
        log.info(`skip at fire: reason=disabled session=${sessionId}`)
        return
      }
      if (this.deps.turnRegistry.hasActiveSession(sessionId)) {
        // 会话又在跑：本次作废，等下一次 settle 重新武装。
        log.info(`skip at fire: reason=session_active session=${sessionId}`)
        return
      }
      const intervalMs =
        Math.max(1, this.numberSetting('extract/milestoneIntervalMinutes', 30)) * 60_000
      const last = this.lastRunAt.get(sessionId)
      if (last != null && Date.now() - last < intervalMs) {
        log.info(`skip at fire: reason=interval session=${sessionId}`)
        return
      }
      const cap = Math.max(1, this.numberSetting('extract/milestoneDailyCap', 2))
      if (this.todayCount(sessionId) >= cap) {
        log.info(`skip at fire: reason=daily_cap session=${sessionId} cap=${cap}`)
        return
      }

      setWithCap(this.lastRunAt, sessionId, Date.now())
      this.bumpDailyCount(sessionId)
      log.info(`distill start: session=${sessionId}`)
      const receipt = await this.deps.distill(sessionId)
      if (receipt.ok) {
        log.info(
          `distill done: session=${sessionId} sampled=${receipt.sampledTurns} ` +
            `inserted=${receipt.inserted} duplicates=${receipt.duplicates}`,
        )
        if (receipt.inserted > 0) this.deps.notifyCandidatesReady?.(sessionId, receipt.inserted)
      } else {
        log.warn(
          `distill done: ok=false session=${sessionId} reason=${receipt.reason ?? 'unknown'} ` +
            `message=${receipt.message ?? ''}`,
        )
      }
    } catch (error) {
      log.warn(
        `milestone trigger failed (non-fatal): session=${sessionId} ` +
          `${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private numberSetting(key: string, fallback: number): number {
    const raw = this.deps.settingsGet('wiki', key)
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  }

  private booleanSetting(key: string, fallback: boolean): boolean {
    const raw = this.deps.settingsGet('wiki', key)
    return typeof raw === 'boolean' ? raw : fallback
  }

  private todayCount(sessionId: string): number {
    const entry = this.dailyCount.get(sessionId)
    return entry != null && entry.day === localDayString() ? entry.count : 0
  }

  private bumpDailyCount(sessionId: string): void {
    const day = localDayString()
    const entry = this.dailyCount.get(sessionId)
    const count = entry != null && entry.day === day ? entry.count + 1 : 1
    setWithCap(this.dailyCount, sessionId, { day, count })
  }
}

/** 本地日期字符串（YYYY-M-D）：跨日语义即可，无需补零对齐。 */
function localDayString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`
}

/** Map 容量护栏：超出上限时逐出最旧（Map 迭代序 = 插入序）；onEvict 释放被逐出条目持有的资源（如定时器句柄）。 */
function setWithCap<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  onEvict?: (evicted: V) => void,
): void {
  if (!map.has(key) && map.size >= MAX_TRACKED_SESSIONS) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) {
      const evicted = map.get(oldest)
      if (evicted !== undefined) onEvict?.(evicted)
      map.delete(oldest)
    }
  }
  map.set(key, value)
}

/* ------------------------------------------------------------------ */
/* 生产运行时（db 驱动的默认实现；测试注入 mock 函数绕开真实栈）          */
/* ------------------------------------------------------------------ */

export interface WikiMilestoneRuntime {
  countUnextractedTurns: (sessionId: string) => number
  distill: (sessionId: string) => Promise<WikiExtractionReceipt>
}

/**
 * 构建生产运行时：
 *   - countUnextractedTurns 复用采样器纯函数做水位线预演（与 distill 内部同口径）；
 *   - distill 懒装配 milestone 专属 wiki 栈（显式传 settingsGet，照抄手动入口
 *     装配方式；不触碰 SessionService.buildWikiServices 的既有行为）。
 */
export function createWikiMilestoneRuntime(deps: {
  db: SparkDatabase
  settingsGet: (category: string, key: string) => unknown
}): WikiMilestoneRuntime {
  let extractionService: ReturnType<typeof createWikiServiceStack>['extractionService'] | undefined

  const resolveExtraction = () => {
    extractionService ??= createWikiServiceStack({
      db: deps.db,
      budget: resolveWikiBudgetFromSettings(deps.settingsGet),
      settingsGet: deps.settingsGet,
    }).extractionService
    return extractionService
  }

  return {
    countUnextractedTurns: (sessionId) => {
      try {
        const events = new EventRepository(deps.db)
          .queryDialogueEvents(sessionId, 1_000)
          .map((row) => JSON.parse(row.event_json) as AgentEvent)
        const watermark = new WikiExtractionStateRepository(deps.db).watermark(sessionId)
        return sampleWikiExtractionTurns(events, watermark).stats.sampledTurns
      } catch (error) {
        // 预演失败按 0 处理：宁可少触发（后续 settle 会重新判定），不抛进主链。
        log.warn(
          `count unextracted turns failed (non-fatal): session=${sessionId} ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
        return 0
      }
    },
    distill: async (sessionId) => resolveExtraction().distill({ sessionId, trigger: 'milestone' }),
  }
}

/**
 * @module dream-orchestrator
 *
 * DreamOrchestrationService —— AutoDream 梦境整理主编排器（计划 §6.1）。
 *
 * 执行模式（照画布后台会话先例，零 session.service 侵入）：
 *   互斥检查 → 读配置 → Orient 快照 → createSession（automation 标记
 *   unattended，免弹窗）→ submitTurn（四阶段提示词 + 本次上下文）→ 轮询
 *   getHistory 判终态 → 解析 dream-proposals 提案块 → 逐条分流落库 →
 *   DreamRunReport 持久化 → deleteSession 清理（不留会话残留）。
 *
 * 安全纵深：
 *   - 梦境会话无任何写入类工具；提案只能以最终输出 JSON 块表达，经
 *     validateDreamProposal 结构化校验后进 candidate 管线（不直接写库）；
 *   - default 权限模式下即使模型被提示注入诱导调用写工具，无人批准必然挂起，
 *     由 turn 超时兜底（一次失败的梦，爆炸半径 = 0 条落库）；
 *   - 全程 dream:* 前缀统一日志 + 每条提案审计。
 */

import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type {
  AgentEvent,
  DreamProposal,
  DreamProposalOutcome,
  DreamProposalResult,
  DreamRunReport,
  DreamRunState,
  DreamRunStats,
  DreamTrack,
  DreamTrigger,
} from '@spark/protocol'
import { DREAM_SETTING_DEFAULTS } from '@spark/protocol'
import { DreamRunStateStore } from './dream-state.js'
import { buildDreamSystemPrompt, buildDreamUserMessage } from './dream-prompt.js'
import { dispatchDreamProposals, parseDreamProposals } from './dream-proposals.js'
import type { DreamAuditEntry } from './dream-proposals.js'

const log = createLogger('dream:orchestrator')

/** 单轮梦境整理的硬超时（大上下文四阶段；超时即取消并出失败报告） */
const DREAM_TURN_TIMEOUT_MS = 20 * 60 * 1000
/** 终态轮询间隔（画布先例 100ms；梦境无需跟流，放宽降负载） */
const POLL_INTERVAL_MS = 400
/** Orient 快照最多列出的记忆条目数 */
const ORIENT_DIGEST_LIMIT = 80

/** 编排器对 SessionService 的最小依赖面（便于单测注入替身） */
export interface DreamSessionControl {
  createSession(params: {
    providerProfileId: string
    modelId?: string
    title?: string
    chatMode?: 'agent'
  }): Promise<{ sessionId: string }>
  submitTurn(params: {
    sessionId: string
    message: string
    providerProfileId?: string
    modelId?: string
  }): Promise<{ turnId: string; started: boolean }>
  patchSessionMetadata(sessionId: string, metadata: Record<string, unknown>): void
  getHistory(params: {
    sessionId: string
    full?: boolean
  }): Promise<{ events: AgentEvent[]; hasMore: boolean }>
  cancelTurn(sessionId: string): Promise<{ cancelled: boolean; turnId?: string }>
  deleteSession(sessionId: string): Promise<{ deleted: boolean }>
}

/** 轨道提案执行器的最小行为面（DreamMemoryProposalSink 满足；测试可注入替身） */
export interface DreamTrackSink {
  buildOrientDigest(limit: number): string
  apply(proposal: DreamProposal, outcome: DreamProposalOutcome): Promise<DreamProposalResult>
}

export interface DreamOrchestratorDeps {
  sessionControl: DreamSessionControl
  stateStore: DreamRunStateStore
  settingsGet: (category: string, key: string) => unknown
  /** 梦境渠道未配置时的默认运行时回落（desktop 装配侧复用既有解析） */
  resolveDefaultRuntime: () => Promise<{ providerProfileId: string; modelId?: string }>
  /** 记忆轨提案执行器 */
  memorySink: DreamTrackSink
  /** 知识库轨提案执行器（S2；缺省时 wiki 轨提案全部 rejected-invalid） */
  wikiSink?: DreamTrackSink
}

export type DreamRunHandle =
  | { ok: true; runId: string }
  | { ok: false; reason: 'busy' | 'disabled' | 'no-runtime'; message: string }

export class DreamOrchestrationService {
  private readonly deps: DreamOrchestratorDeps
  /** 轨级互斥：同轨梦境串行，异轨并行（计划 D1） */
  private readonly runningTracks = new Set<DreamTrack>()
  /** 取消请求标记（轮询循环观测后中止） */
  private readonly cancelRequested = new Set<DreamTrack>()

  constructor(deps: DreamOrchestratorDeps) {
    this.deps = deps
    // 清算上个进程残留的 running 状态（崩溃/退出逃生门，见 dream-state 注释）
    deps.stateStore.reconcileStaleRunning()
  }

  getState(track: DreamTrack): DreamRunState | null {
    return this.deps.stateStore.getState(track)
  }

  getReport(track: DreamTrack): DreamRunReport | null {
    return this.deps.stateStore.getReport(track)
  }

  /** 订阅状态变更（desktop 装配桥 IPC 广播用） */
  onChange(fn: (state: DreamRunState) => void): () => void {
    return this.deps.stateStore.onChange(fn)
  }

  /** 手动取消：停止梦境会话，已产生提案照常走分流（计划 §8.1） */
  async cancel(track: DreamTrack): Promise<{ ok: boolean; message: string }> {
    if (!this.runningTracks.has(track)) {
      return { ok: false, message: '当前没有运行中的梦境' }
    }
    this.cancelRequested.add(track)
    const state = this.deps.stateStore.getState(track)
    if (state?.sessionId != null) {
      try {
        await this.deps.sessionControl.cancelTurn(state.sessionId)
      } catch (err) {
        log.warn(`cancel turn failed (track=${track}): ${errText(err)}`)
      }
    }
    return { ok: true, message: '已请求取消，已产生的提案仍会完成分流' }
  }

  /**
   * 拉起一次梦境整理。manual 触发不检查 enabled（对标 /dream 无门控）；
   * schedule 触发要求总开关开启。立即返回 runId，整理后台异步进行
   * （进度经 onChange / getState 观察）。
   */
  runDream(track: DreamTrack, trigger: DreamTrigger): DreamRunHandle {
    if (this.runningTracks.has(track)) {
      return { ok: false, reason: 'busy', message: '该轨道梦境正在运行中' }
    }
    const cfg = this.readConfig(track)
    if (trigger === 'schedule' && !cfg.enabled) {
      return { ok: false, reason: 'disabled', message: '自动整编总开关未开启' }
    }
    const runId = randomUUID()
    this.runningTracks.add(track)
    // 后台执行；execute 自身保证互斥清理、状态与报告落库
    void this.execute(track, trigger, cfg, runId).catch((err) => {
      log.error(`dream run crashed (track=${track}): ${errText(err)}`)
    })
    return { ok: true, runId }
  }

  // ─── 配置读取（按轨分流：memory 驼峰键 / wiki 子路径键，默认值同源） ────

  private readConfig(track: DreamTrack) {
    if (track === 'wiki') {
      const get = (key: string): unknown => this.deps.settingsGet('wiki', key)
      const num = (key: string, dflt: number): number =>
        typeof get(key) === 'number' ? Number(get(key)) : dflt
      const str = (key: string): string =>
        typeof get(key) === 'string' ? String(get(key)).trim() : ''
      return {
        enabled: get('dream/enabled') === true,
        // 渠道回落链：dream/providerProfile → extract/modelProfile → 会话默认（resolveDefaultRuntime）
        providerId: str('dream/providerProfile') || str('extract/modelProfile'),
        model: str('dream/model'),
        autoApplyThresholdPct: clamp(
          num('dream/autoApplyThreshold', DREAM_SETTING_DEFAULTS.autoApplyThreshold),
          0,
          100,
        ),
        autoDeleteEnabled: get('dream/autoDeleteEnabled') === true,
        sessionScanDays: Math.max(
          1,
          num('dream/scanSessionsDays', DREAM_SETTING_DEFAULTS.sessionScanDays),
        ),
        batchLimit: Math.max(1, num('dream/batchLimit', DREAM_SETTING_DEFAULTS.batchLimit)),
      }
    }
    const get = (key: string): unknown => this.deps.settingsGet('memory', key)
    const num = (key: string, dflt: number): number =>
      typeof get(key) === 'number' ? Number(get(key)) : dflt
    const str = (key: string): string =>
      typeof get(key) === 'string' ? String(get(key)).trim() : ''
    return {
      enabled: get('dreamEnabled') === true,
      providerId: str('dreamProviderId'),
      model: str('dreamModel'),
      autoApplyThresholdPct: clamp(
        num('dreamAutoApplyThreshold', DREAM_SETTING_DEFAULTS.autoApplyThreshold),
        0,
        100,
      ),
      autoDeleteEnabled: get('dreamAutoDeleteEnabled') === true,
      sessionScanDays: Math.max(
        1,
        num('dreamSessionScanDays', DREAM_SETTING_DEFAULTS.sessionScanDays),
      ),
      batchLimit: Math.max(1, num('dreamBatchLimit', DREAM_SETTING_DEFAULTS.batchLimit)),
    }
  }

  // ─── 主执行链 ────────────────────────────────────────────────────────────

  private async execute(
    track: DreamTrack,
    trigger: DreamTrigger,
    cfg: ReturnType<DreamOrchestrationService['readConfig']>,
    runId: string,
  ): Promise<void> {
    const startedAt = Date.now()
    const emptyStats: DreamRunStats = {
      proposals: 0,
      autoApplied: 0,
      pendingReview: 0,
      rejectedInvalid: 0,
      droppedByLimit: 0,
    }
    const state: DreamRunState = {
      track,
      runId,
      trigger,
      status: 'running',
      phase: 'orient',
      startedAt,
      updatedAt: startedAt,
      sessionId: null,
      stats: emptyStats,
    }
    this.deps.stateStore.setState(state)
    let sessionId: string | null = null

    try {
      // 1. Orient：现状快照（轨道 sink 提供）
      const trackSink = track === 'memory' ? this.deps.memorySink : this.deps.wikiSink
      const orientDigest =
        trackSink != null
          ? trackSink.buildOrientDigest(ORIENT_DIGEST_LIMIT)
          : '（该轨道现状快照暂不可用：提案执行器未装配。）'

      // 2. 运行时解析：梦境配置 → 默认运行时回落
      let providerProfileId = cfg.providerId
      let modelId: string | undefined = cfg.model.length > 0 ? cfg.model : undefined
      if (providerProfileId.length === 0) {
        const fallback = await this.deps.resolveDefaultRuntime()
        if (fallback.providerProfileId.length === 0) {
          throw new Error('no-runtime：未配置梦境渠道，且系统无可用默认渠道')
        }
        providerProfileId = fallback.providerProfileId
        if (modelId == null && fallback.modelId != null) modelId = fallback.modelId
      }

      // 3. 拉起梦境会话（隐藏后台会话：automation.unattended 免弹窗）
      const created = await this.deps.sessionControl.createSession({
        providerProfileId,
        ...(modelId != null ? { modelId } : {}),
        title: `自动整编 · ${track === 'memory' ? '记忆' : '知识库'} · ${new Date(startedAt).toLocaleString('zh-CN')}`,
        chatMode: 'agent',
      })
      sessionId = created.sessionId
      state.sessionId = sessionId
      state.updatedAt = Date.now()
      this.deps.stateStore.setState(state)
      this.deps.sessionControl.patchSessionMetadata(sessionId, {
        automation: { source: 'dream', unattended: true },
      })

      // 4. 提交梦境轮次。SendTurnParams 无独立 system prompt 通道（skillId 路径
      //    需要 Skill 表预置，侵入更大），四阶段方法论 + 本次上下文合并为首条
      //    user 消息——automation 的 UNATTENDED 系统段兜底「不提问不暂停」纪律。
      const promptContext = {
        track,
        runId,
        scanSessionsDays: cfg.sessionScanDays,
        batchLimit: cfg.batchLimit,
        autoApplyThresholdPct: cfg.autoApplyThresholdPct,
        autoDeleteEnabled: cfg.autoDeleteEnabled,
        orientDigest,
        lastRunAt: this.lastRunAt(track),
        ...(this.lastReportSummary(track) != null
          ? { lastReportSummary: this.lastReportSummary(track) ?? '' }
          : {}),
      }
      const message = `${buildDreamSystemPrompt(track)}\n\n---\n\n${buildDreamUserMessage(promptContext)}`
      const turn = await this.deps.sessionControl.submitTurn({
        sessionId,
        message,
        providerProfileId,
        ...(modelId != null ? { modelId } : {}),
      })

      // 5. 轮询终态（gather 阶段：模型的四阶段自动进行）
      state.phase = 'gather'
      state.updatedAt = Date.now()
      this.deps.stateStore.setState(state)
      const outcome = await this.pollUntilTerminal(sessionId, turn.turnId, track)

      // 6. 分流落库（settle 阶段）
      state.phase = 'settle'
      state.updatedAt = Date.now()
      this.deps.stateStore.setState(state)

      let stats = emptyStats
      let outcomes: DreamRunReport['outcomes'] = []
      let error: string | undefined

      if (this.cancelRequested.has(track) && (outcome.text ?? '').length === 0) {
        // 取消请求先于终态正文到达：无提案可分流，直接记 cancelled
        state.status = 'cancelled'
      } else if (outcome.terminalError != null) {
        state.status = 'failed'
        error = outcome.terminalError
      } else {
        // 正常终态，或取消请求到达时终态正文已就绪——后者按 cancel() 的承诺
        // 「已产生的提案仍会完成分流」照常分流（丢弃已完整产出的提案集与
        // dispatch 进行中取消的行为不一致，且浪费已消耗的 token）
        const finalText = outcome.text ?? ''
        const parsed = parseDreamProposals(finalText)
        if (parsed.missing) {
          log.warn(`dream final message has no proposals block (track=${track})`)
        }
        const dispatch = await dispatchDreamProposals({
          runId,
          proposals: parsed.proposals,
          invalid: parsed.invalid,
          batchLimit: cfg.batchLimit,
          autoApplyThresholdPct: cfg.autoApplyThresholdPct,
          autoDeleteEnabled: cfg.autoDeleteEnabled,
          applyProposal: (proposal, res) => this.applyTrackProposal(track, proposal, res),
          audit: (entry) => this.audit(entry),
        })
        stats = dispatch.stats
        outcomes = dispatch.results
        state.status = this.cancelRequested.has(track) ? 'cancelled' : 'succeeded'
      }
      state.stats = stats
      if (error != null) state.error = error
      state.updatedAt = Date.now()
      this.deps.stateStore.setState(state)

      const report: DreamRunReport = {
        runId,
        track,
        trigger,
        status: state.status,
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        stats,
        outcomes,
        ...(error != null ? { error } : {}),
      }
      this.deps.stateStore.setReport(report)
      log.info(
        `dream finished (track=${track} status=${state.status}): proposals=${stats.proposals} ` +
          `auto=${stats.autoApplied} pending=${stats.pendingReview} ` +
          `invalid=${stats.rejectedInvalid} dropped=${stats.droppedByLimit}`,
      )
    } catch (err) {
      const message = errText(err)
      log.error(`dream run failed (track=${track}): ${message}`)
      state.status = 'failed'
      state.error = message
      state.updatedAt = Date.now()
      this.deps.stateStore.setState(state)
      this.deps.stateStore.setReport({
        runId,
        track,
        trigger,
        status: 'failed',
        startedAt,
        finishedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        stats: emptyStats,
        outcomes: [],
        error: message,
      })
    } finally {
      this.cancelRequested.delete(track)
      this.runningTracks.delete(track)
      // 梦境会话即用即毁：不留会话列表残留（计划 §10 风险对策）
      if (sessionId != null) {
        try {
          await this.deps.sessionControl.deleteSession(sessionId)
        } catch (err) {
          log.warn(`dream session cleanup failed (${sessionId}): ${errText(err)}`)
        }
      }
    }
  }

  /** 轨道分发：memory 轨 / wiki 轨各走各的 sink，kind 与 track 必须一致 */
  private async applyTrackProposal(
    track: DreamTrack,
    proposal: DreamProposal,
    outcome: DreamProposalOutcome,
  ): Promise<DreamProposalResult> {
    if (track === 'memory' && proposal.kind === 'memory') {
      return this.deps.memorySink.apply(proposal, outcome)
    }
    if (track === 'wiki' && proposal.kind === 'wiki') {
      if (this.deps.wikiSink == null) {
        return { outcome: 'rejected-invalid', note: 'wiki 轨提案执行器未装配' }
      }
      return this.deps.wikiSink.apply(proposal, outcome)
    }
    return {
      outcome: 'rejected-invalid',
      note: `提案 kind=${proposal.kind} 与轨道 ${track} 不匹配`,
    }
  }

  /** 审计：每条提案一行结构化日志（dream runId 溯源；S4 扩展持久化审计表时复用） */
  private audit(entry: DreamAuditEntry): void {
    log.info(
      `dream-audit run=${entry.runId} kind=${entry.kind} op=${entry.op} ` +
        `target=${entry.targetId ?? '-'} confidence=${entry.confidence.toFixed(2)} ` +
        `outcome=${entry.outcome}${entry.note != null ? ` note=${entry.note}` : ''}`,
    )
  }

  private lastRunAt(track: DreamTrack): number | null {
    const report = this.deps.stateStore.getReport(track)
    return report?.finishedAt ?? null
  }

  private lastReportSummary(track: DreamTrack): string | undefined {
    const report = this.deps.stateStore.getReport(track)
    if (report == null) return undefined
    const parts = [
      `提案 ${report.stats.proposals}、自动落库 ${report.stats.autoApplied}、待人审 ${report.stats.pendingReview}`,
    ]
    if (report.error != null) parts.push(`上次错误：${report.error.slice(0, 120)}`)
    return parts.join('；')
  }

  /** 轮询直至终态 / 超时 / 取消。终态判定与画布同口径：isFinal 优先，agent_status 兜底。 */
  private async pollUntilTerminal(
    sessionId: string,
    turnId: string,
    track: DreamTrack,
  ): Promise<{ text?: string; terminalError?: string }> {
    const deadline = Date.now() + DREAM_TURN_TIMEOUT_MS
    // 读路径容错：单次 getHistory 异常（DB 抖动等）不毁掉整场梦境，连续失败
    // 达阈值才判失败——20 分钟的大上下文梦境不应死于一次瞬时读错误。
    let consecutiveReadFailures = 0
    const MAX_READ_FAILURES = 5
    while (Date.now() < deadline) {
      if (this.cancelRequested.has(track)) {
        return {}
      }
      let events: AgentEvent[]
      try {
        events = (await this.deps.sessionControl.getHistory({ sessionId, full: true })).events
        consecutiveReadFailures = 0
      } catch (err) {
        consecutiveReadFailures += 1
        log.warn(
          `dream poll getHistory failed (${consecutiveReadFailures}/${MAX_READ_FAILURES}): ${errText(err)}`,
        )
        if (consecutiveReadFailures >= MAX_READ_FAILURES) {
          return {
            terminalError: `读取梦境会话进度连续失败 ${MAX_READ_FAILURES} 次：${errText(err)}`,
          }
        }
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      // 严格按 turnId 过滤（画布同口径）：梦境会话是全新会话，正常只有本 turn 事件；
      // 防御性过滤仍然必要——僵尸恢复等路径可能补发历史事件。
      const turnEvents = events.filter((e) => (e as { turnId?: string }).turnId === turnId)
      const resolved = resolveDreamTurnResult(turnEvents)
      if (resolved.terminal) {
        return resolved.error != null
          ? { terminalError: resolved.error }
          : { text: resolved.text ?? '' }
      }
      await sleep(POLL_INTERVAL_MS)
    }
    log.warn(`dream turn timed out after ${DREAM_TURN_TIMEOUT_MS / 60000}min, cancelling`)
    try {
      await this.deps.sessionControl.cancelTurn(sessionId)
    } catch (err) {
      log.warn(`timeout cancel failed: ${errText(err)}`)
    }
    return { terminalError: `自动整编超时（${DREAM_TURN_TIMEOUT_MS / 60000} 分钟），已自动取消` }
  }

  /** @visibleForTesting 轨级运行态（测试互斥/取消用） */
  isRunning(track: DreamTrack): boolean {
    return this.runningTracks.has(track)
  }
}

// ─── 终态判定（与画布 resolveCanvasAgentTurnResult 同口径；见其注释：
//     中间消息可能 mode=complete 但 turn 未结束，只有 isFinal 在终态前权威） ──

type DreamTurnPollResult = { terminal: boolean; text?: string; error?: string }

export function resolveDreamTurnResult(events: AgentEvent[]): DreamTurnPollResult {
  const terminalError = events.find((event) => event.type === 'agent_error')
  if (terminalError?.type === 'agent_error') {
    return { terminal: true, error: terminalError.message }
  }
  const assistantMessages = events.filter(
    (event): event is Extract<AgentEvent, { type: 'assistant_message' }> =>
      event.type === 'assistant_message' &&
      event.mode === 'complete' &&
      event.content.trim().length > 0,
  )
  for (let i = assistantMessages.length - 1; i >= 0; i -= 1) {
    const candidate = assistantMessages[i]
    if (candidate?.isFinal === true) {
      return { terminal: true, text: candidate.content }
    }
  }
  let terminalStatus: Extract<AgentEvent, { type: 'agent_status' }> | undefined
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const candidate = events[i]
    if (
      candidate?.type === 'agent_status' &&
      (candidate.status === 'completed' ||
        candidate.status === 'cancelled' ||
        candidate.status === 'error')
    ) {
      terminalStatus = candidate
      break
    }
  }
  if (terminalStatus == null) return { terminal: false }
  if (terminalStatus.status !== 'completed') {
    return {
      terminal: true,
      error: terminalStatus.message || `本地 Agent 状态：${terminalStatus.status}`,
    }
  }
  const fallback = assistantMessages.at(-1)
  return { terminal: true, ...(fallback != null ? { text: fallback.content } : {}) }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

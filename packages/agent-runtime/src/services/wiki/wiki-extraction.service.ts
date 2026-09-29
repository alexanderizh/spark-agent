/**
 * @module wiki-extraction.service
 *
 * 抽取管道编排（S2）—— 对话 → 候选知识（wiki_candidate）。
 *
 * 触发矩阵（方案 §9.2，默认策略 §9.6）：
 *   - manual（用户显式"沉淀此对话"）：默认开，**主路径**；
 *   - milestone（长任务交付 / 目标达成）：默认开；
 *   - idle（会话空闲异步）：默认关；
 *   - schedule（定时批处理兜底）：默认关；
 *   - **每轮实时抽取：禁止**——本服务只被上述四种入口调用，Agent 主循环
 *     不触达（主链路多跑一次抽取模型就是实打实的 token 与延迟成本）。
 *
 * 流水线：闸门 → 增量采样（本地噪声过滤）→ 小模型抽取 → 严格解析 → 候选入库。
 * 每一步失败都返回结构化回执（计数 + 原因分类），不向主链路抛异常。
 *
 * 成本与可信三约束在这里收口：
 *   - 增量：只喂水位线之后的新增轮次（§9.3）；
 *   - 溯源：候选必须带来源轮次 + 依据片段，无来源不入库（§9.4）；
 *   - 人审：产物一律 pending，用户经可信界面确认才成为页面（§9.4）。
 */

import { createLogger } from '@spark/shared'
import {
  EventRepository,
  SessionRepository,
  WorkspaceRepository,
  type SparkDatabase,
  type WikiCandidateRepository,
  type WikiExtractionStateRepository,
  type WikiExtractionTriggerKind,
  type WikiSpaceRepository,
} from '@spark/storage'
import type { AgentEvent, WikiExtractionReceipt, WikiExtractionTrigger } from '@spark/protocol'
import {
  resolveSessionTitleTarget,
  type SessionTitleTargetResolution,
} from '../session/session-title-target.js'
import {
  WIKI_EXTRACTION_SYSTEM_PROMPT,
  buildWikiExtractionPrompt,
  parseWikiExtractionResponse,
} from './wiki-extraction-prompt.js'
import { renderSampledTurns, sampleWikiExtractionTurns } from './wiki-extraction-sampler.js'
import { callWikiExtractionModel } from './wiki-extraction-model.js'
import { hashWikiCandidateContent } from '@spark/storage'

const log = createLogger('wiki:extraction')

/** 回执失败原因（与 protocol WikiExtractionReceipt.reason 对齐） */
type WikiExtractionFailureReason = NonNullable<WikiExtractionReceipt['reason']>

/** 抽取模型调用形态（测试可注入；缺省真实 HTTP） */
export type WikiExtractionModelCall = (params: {
  providerType: string
  apiKey: string
  apiEndpoint?: string | undefined
  apiEndpointFullUrl?: boolean | undefined
  model: string
  system: string
  prompt: string
}) => Promise<string | null>

/** 抽取渠道解析形态（测试可注入；缺省走 resolveSessionTitleTarget 真实链） */
export type WikiExtractionTargetResolver = (session: {
  provider_profile_id: string | null
  model_id: string | null
}) => Promise<SessionTitleTargetResolution>

export interface WikiExtractionServiceDeps {
  db: SparkDatabase
  /** 设置读取（(category, key) 二元组；缺省视为全部默认值） */
  settingsGet?: (category: string, key: string) => unknown
  /** 模型调用注入（测试用） */
  callModel?: WikiExtractionModelCall
  /**
   * 抽取渠道解析注入（测试用）。
   *
   * 为什么需要这个 seam：真实解析链要读 Keychain（`resolveProviderApiKey`），
   * 在测试环境必然失败。抽取管道的语义（闸门 / 增量 / 解析 / 人审）与渠道
   * 解析无关，因此把它与模型调用一起作为可注入依赖。
   */
  resolveTarget?: (session: {
    provider_profile_id: string | null
    model_id: string | null
  }) => Promise<SessionTitleTargetResolution>
}

export interface WikiDistillInput {
  sessionId: string
  trigger: WikiExtractionTrigger
  /** 目标 scope；缺省按会话派生（有 workspace → project，否则 user） */
  scope?: 'user' | 'project' | 'agent' | 'team'
  scopeRef?: string | null
  /** 目标空间（可为 NULL，确认时再选） */
  spaceId?: string | null
}

export class WikiExtractionService {
  private readonly db: SparkDatabase
  private readonly settingsGet: (category: string, key: string) => unknown
  private readonly callModel: WikiExtractionModelCall
  private readonly resolveTarget: (session: {
    provider_profile_id: string | null
    model_id: string | null
  }) => Promise<SessionTitleTargetResolution>

  constructor(
    private readonly candidateRepo: WikiCandidateRepository,
    private readonly stateRepo: WikiExtractionStateRepository,
    private readonly spaceRepo: WikiSpaceRepository,
    deps: WikiExtractionServiceDeps,
  ) {
    this.db = deps.db
    this.settingsGet = deps.settingsGet ?? (() => undefined)
    this.callModel = deps.callModel ?? callWikiExtractionModel
    this.resolveTarget =
      deps.resolveTarget ??
      ((session) =>
        resolveSessionTitleTarget({
          db: this.db,
          session: { provider_profile_id: session.provider_profile_id, model_id: session.model_id },
        }))
  }

  /**
   * 蒸馏一个会话 → 候选。
   *
   * 返回结构化回执（不含正文片段）：sampledTurns / inserted / duplicates 供成本
   * 归因，失败带 machine readable reason。绝不向调用方抛异常。
   */
  async distill(input: WikiDistillInput): Promise<WikiExtractionReceipt> {
    const gate = this.checkGate(input.trigger)
    if (!gate.allowed) {
      return {
        ok: false,
        sampledTurns: 0,
        inserted: 0,
        duplicates: 0,
        reason: gate.reason,
        message: gate.message,
      }
    }

    const session = new SessionRepository(this.db).get(input.sessionId)
    if (session == null) {
      return {
        ok: false,
        sampledTurns: 0,
        inserted: 0,
        duplicates: 0,
        reason: 'dialogue_empty',
        message: '会话不存在',
      }
    }

    const scopeInfo = this.resolveScope(input, session)
    const watermark = this.stateRepo.watermark(input.sessionId)

    const events = new EventRepository(this.db)
      .queryDialogueEvents(input.sessionId, 1_000)
      .map((row) => JSON.parse(row.event_json) as AgentEvent)
    const sample = sampleWikiExtractionTurns(events, watermark)

    if (sample.turns.length === 0) {
      // 没有新增有意义轮次：不调模型、不烧钱，但推进水位线（避免反复空跑）。
      this.stateRepo.advance({
        sessionId: input.sessionId,
        scope: scopeInfo.scope,
        scopeRef: scopeInfo.scopeRef,
        turnIndex: sample.stats.totalTurns,
        trigger: input.trigger,
      })
      return {
        ok: true,
        sampledTurns: 0,
        inserted: 0,
        duplicates: 0,
      }
    }

    const resolved = await this.resolveModelTarget(session)
    if (!resolved.ok) {
      this.stateRepo.recordError(input.sessionId, resolved.code, {
        scope: scopeInfo.scope,
        scopeRef: scopeInfo.scopeRef,
      })
      return {
        ok: false,
        sampledTurns: sample.stats.sampledTurns,
        inserted: 0,
        duplicates: 0,
        reason: 'no_provider',
        message: '没有可用的抽取模型渠道',
      }
    }

    const sampledIndexes = new Set(sample.turns.map((turn) => turn.turnIndex))
    const raw = await this.callModel({
      providerType: resolved.target.providerType,
      apiKey: resolved.target.apiKey,
      ...(resolved.target.apiEndpoint != null ? { apiEndpoint: resolved.target.apiEndpoint } : {}),
      ...(resolved.target.apiEndpointFullUrl === true ? { apiEndpointFullUrl: true } : {}),
      model: resolved.target.model,
      system: WIKI_EXTRACTION_SYSTEM_PROMPT,
      prompt: buildWikiExtractionPrompt(renderSampledTurns(sample.turns)),
    })
    if (raw == null) {
      this.stateRepo.recordError(input.sessionId, 'model_failed', {
        scope: scopeInfo.scope,
        scopeRef: scopeInfo.scopeRef,
      })
      return {
        ok: false,
        sampledTurns: sample.stats.sampledTurns,
        inserted: 0,
        duplicates: 0,
        reason: 'model_failed',
        message: '抽取模型调用失败',
      }
    }

    const parsed = parseWikiExtractionResponse(raw, sampledIndexes)
    if (!parsed.ok) {
      this.stateRepo.recordError(input.sessionId, parsed.reason, {
        scope: scopeInfo.scope,
        scopeRef: scopeInfo.scopeRef,
      })
      return {
        ok: false,
        sampledTurns: sample.stats.sampledTurns,
        inserted: 0,
        duplicates: 0,
        reason: 'invalid_output',
        message: `抽取输出不可用：${parsed.reason}`,
      }
    }

    const ttlMs = this.numberSetting('candidate/ttlDays', 14) * 86_400_000
    const maxPending = this.numberSetting('candidate/maxPending', 200)
    const spaceId = input.spaceId ?? null

    let inserted = 0
    let duplicates = 0
    for (const item of parsed.items) {
      const payload = {
        kind: item.kind,
        title: item.title,
        summary: item.summary,
        body: item.body,
        tags: item.tags,
        confidence: item.confidence,
        rationale: item.rationale,
        sources: [
          {
            sessionId: input.sessionId,
            turnIndex: item.turnIndex,
            excerpt: item.excerpt,
          },
        ],
      }
      const result = this.candidateRepo.insertPending(
        { scope: scopeInfo.scope, scopeRef: scopeInfo.scopeRef, spaceId, payload },
        { maxPending, ttlMs },
      )
      if (result.inserted) inserted += 1
      else duplicates += 1
    }

    // 成功抽取才推进水位线（失败已在上面 return，不推进）。
    const maxTurn = Math.max(...sample.turns.map((turn) => turn.turnIndex))
    this.stateRepo.advance({
      sessionId: input.sessionId,
      scope: scopeInfo.scope,
      scopeRef: scopeInfo.scopeRef,
      turnIndex: maxTurn,
      trigger: input.trigger,
    })
    log.info(
      `wiki extraction done: session=${input.sessionId} trigger=${input.trigger} ` +
        `sampled=${sample.stats.sampledTurns} inserted=${inserted} duplicates=${duplicates}`,
    )
    return {
      ok: true,
      sampledTurns: sample.stats.sampledTurns,
      inserted,
      duplicates,
    }
  }

  /**
   * 触发闸门（§9.6 默认策略；全部可在设置里调整）。
   *
   * 总闸 `extract/enabled` 只管**后台自动触发**（idle / schedule）——方案 §9.6
   * 明确"自动抽取关闭时，仍保留用户显式沉淀与里程碑收尾"这两条人审路径，
   * 它们的开关各自独立（默认均开）。把 manual/milestone 也挂在总闸下会让
   * 首期唯一的入口失效，与"人在回路优先"的取向相反。
   */
  private checkGate(
    trigger: WikiExtractionTrigger,
  ): { allowed: true } | { allowed: false; reason: WikiExtractionFailureReason; message: string } {
    if (trigger === 'manual') {
      if (!this.booleanSetting('extract/manual', true)) {
        return { allowed: false, reason: 'disabled', message: '显式沉淀已在设置中关闭' }
      }
      return { allowed: true }
    }
    if (trigger === 'milestone') {
      if (!this.booleanSetting('extract/milestone', true)) {
        return { allowed: false, reason: 'disabled', message: '里程碑沉淀未开启' }
      }
      return { allowed: true }
    }
    const autoEnabled = this.booleanSetting('extract/enabled', false)
    if (trigger === 'idle') {
      if (!autoEnabled || !this.booleanSetting('extract/idle', false)) {
        return { allowed: false, reason: 'disabled', message: '空闲沉淀未开启' }
      }
      return { allowed: true }
    }
    if (!autoEnabled || !this.booleanSetting('extract/schedule', false)) {
      return { allowed: false, reason: 'disabled', message: '定时批处理未开启' }
    }
    return { allowed: true }
  }

  /**
   * 目标 scope 派生：显式指定优先；否则按会话是否绑定 workspace 决定
   * （有 workspace → project，scopeRef 取 workspace id；否则 user）。
   */
  private resolveScope(
    input: WikiDistillInput,
    session: { workspace_ids_json: string },
  ): { scope: 'user' | 'project' | 'agent' | 'team'; scopeRef: string | null } {
    if (input.scope != null) {
      return { scope: input.scope, scopeRef: input.scopeRef ?? null }
    }
    const workspaceId = firstWorkspaceId(session.workspace_ids_json)
    if (workspaceId != null) {
      const workspace = new WorkspaceRepository(this.db).get(workspaceId)
      if (workspace != null) {
        return { scope: 'project', scopeRef: workspace.id }
      }
    }
    return { scope: 'user', scopeRef: null }
  }

  /**
   * 抽取模型解析：`extract/modelProfile` 非空时按渠道 id 覆盖（留空 = 跟随
   * 会话渠道）。复用标题链路的解析（含智能路由回退与本地 CLI 渠道不可用判定）。
   */
  private async resolveModelTarget(session: {
    provider_profile_id: string | null
    model_id: string | null
  }): Promise<SessionTitleTargetResolution> {
    const profile = String(this.settingsGet('wiki', 'extract/modelProfile') ?? '').trim()
    if (profile.length > 0) {
      const override = await this.resolveTarget({
        provider_profile_id: profile,
        model_id: null,
      })
      if (override.ok) return override
      log.warn(`extraction model profile unusable: ${profile} code=${override.code}`)
    }
    return this.resolveTarget(session)
  }

  private booleanSetting(key: string, fallback: boolean): boolean {
    const raw = this.settingsGet('wiki', key)
    return typeof raw === 'boolean' ? raw : fallback
  }

  private numberSetting(key: string, fallback: number): number {
    const raw = this.settingsGet('wiki', key)
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  }

  /** 候选摘要（供调用方复用同一口径；本服务不直接消费，导出便于测试断言）。 */
  static digestOf(payload: Parameters<typeof hashWikiCandidateContent>[0]): string {
    return hashWikiCandidateContent(payload)
  }
}

function firstWorkspaceId(json: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) {
      const first = parsed.find(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      )
      return first ?? null
    }
    return null
  } catch {
    return null
  }
}

export type { WikiExtractionTriggerKind }

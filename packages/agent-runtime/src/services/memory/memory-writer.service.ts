/**
 * @module memory-writer.service
 *
 * 记忆写入服务 — 从对话轮次中抽取记忆并经四道闸门后持久化
 *
 * 职责：
 *   - 调用小模型（通过 ModelService）抽取候选记忆
 *   - 五道闸门：瞬时数据 → 置信度 → 去重/合并 → 配额 → 敏感词
 *   - 通过后写文件 + 写 SQLite + 更新 MEMORY.md 索引
 *   - fire-and-forget：所有异常仅 log，不向上抛
 *
 * 依赖：
 *   - MemoryRepository (SQLite CRUD)
 *   - MemoryStoreService (文件系统)
 *   - ModelService (调用小模型)
 *   - SettingsService (读取 memory 配置)
 */

import { MemoryRepository } from '@spark/storage'
import type { MemoryEntryRow } from '@spark/storage'
import { createLogger, SparkError } from '@spark/shared'
import { MemoryStoreService } from './memory-store.service.js'
import { isMemorySensitive, detectTransientMemory } from './sanitizer.js'
import { resolveValidUntil } from './memory-temporal.js'
import { buildExtractionPrompt, buildDedupPrompt } from './memory-extraction.prompt.js'
import { MemoryEvolutionService } from './memory-evolution.service.js'
import type { EvolutionVerdict } from './memory-evolution.service.js'
import { MemoryCommitService } from './memory-commit.service.js'
import type { MemoryCandidateRepository, MemoryEntityRepository } from '@spark/storage'

const log = createLogger('memory:writer')

// ─── Types ────────────────────────────────────────────────────────────────

export interface TurnPayload {
  sessionId: string
  workspaceId: string
  agentId: string
  userMessage: string
  assistantMessage: string
  recentSummary: string
  /**
   * 来源绑定（S2.1）。全部可选（旧调用/测试兼容），全部由系统侧
   * （session.service 装配点）填充 —— 与 LLM 抽取结果无关，
   * MemoryCandidate 中不存在任何来源字段，无 LLM 注入点。
   */
  /** 本轮 turn_id（agent_events.turn_id，同 turn 重试据此识别） */
  turnId?: string
  /** 真实事件引用（agent_events.id，承载本轮用户消息的事件） */
  sourceEventId?: string | null
  /** 作者角色：'host_agent' | 'team_member'（缺省按 agentId 有无推断为 host 路径） */
  authorRole?: 'host_agent' | 'team_member'
  /** 实际调用的提取模型 id（settings / fallback 真实值） */
  extractionModel?: string | null
}

export interface MemoryCandidate {
  scope: 'user' | 'project' | 'agent'
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  body: string
  confidence: number
  links?: string[]
  /** V2: 抽取出的实体名（人名/库名/框架/模块/系统），用于实体关联图。可选（旧候选无）。 */
  entities?: string[]
}

export interface MemoryInjection {
  block: string
  injectedIds: string[]
  droppedCount: number
}

/**
 * 来源绑定（S2.1）：从 TurnPayload（系统侧装配上下文）构造新建条目的来源。
 * authorRole 未显式给出但 agentId 存在 → host 路径（member 路径总是显式传
 * 'team_member'）；无 agentId 则角色未知（不补造）。
 */
function buildTurnSourceAttribution(payload: TurnPayload): {
  turnId?: string
  sourceEventId: string | null
  authorRole?: string
  authorAgentId: string | null
  extractionKind: string
  extractionModel: string | null
} {
  return {
    ...(payload.turnId != null ? { turnId: payload.turnId } : {}),
    sourceEventId: payload.sourceEventId ?? null,
    ...(payload.authorRole != null
      ? { authorRole: payload.authorRole }
      : payload.agentId
        ? { authorRole: 'host_agent' }
        : {}),
    authorAgentId: payload.agentId || null,
    extractionKind: 'turn_extraction',
    extractionModel: payload.extractionModel ?? null,
  }
}

/** 默认配额 */
const DEFAULT_QUOTA = { user: 100, project: 200, agent: 50 }

/** LLM 调用函数签名 */
export type LLMCallFn = (prompt: string) => Promise<string>

// ─── Service ──────────────────────────────────────────────────────────────

export class MemoryWriterService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
    private readonly callLLM: LLMCallFn,
    /**
     * V2 演化决策服务（ADD/UPDATE/DELETE/NOOP）。为 null 时退回 V1：无相似召回，
     * 一律 ADD（保守不丢信息）。生产路径由 session.service 注入。
     */
    private readonly evolutionService: MemoryEvolutionService | null = null,
    /**
     * V2 实体关联图 repo。提供时，ADD/UPDATE 落库候选的 entities；为 null 则跳过（旧测试兼容）。
     */
    private readonly entityRepo: MemoryEntityRepository | null = null,
    /**
     * 【S1B.1】托管提交原语。所有写入（新建/去重合并/演化更新/手工）统一走
     * "先写新快照文件 → DB CAS 提交（version+content_hash）"。缺省由 repo+store
     * 内部构造（现有测试/调用无需改构造）；可注入 mock 做提交语义测试。
     */
    private readonly commitService: MemoryCommitService = new MemoryCommitService(
      memoryRepo,
      storeService,
    ),
    /**
     * 【P2-A 冲突性写入】候选确认区 repo。提供时，演化 UPDATE/DELETE 的目标
     * 是"用户明确表达/手动创建"的记忆 → 不自动执行，转候选等用户确认；
     * 为 null（旧测试 / 未接候选区）保持全自动原行为。
     */
    private readonly candidateRepo: MemoryCandidateRepository | null = null,
  ) {}

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * 从一轮对话中抽取并写入记忆（异步、fire-and-forget）
   *
   * 所有异常被 catch 并 log，永远不向上抛。
   */
  async maybeWriteFromTurn(payload: TurnPayload): Promise<void> {
    try {
      if (!this.isEnabled()) return

      // 【全流程日志·节点1】payload 入参（让"抽取拿到什么"可见，含 workspaceId 是否传到位）
      log.debug(
        `【记忆抽取】开始处理 turn：session=${payload.sessionId} ` +
          `workspace=${payload.workspaceId || '(无，非项目会话)'} ` +
          `agent=${payload.agentId || '(无)'} ` +
          `user=${payload.userMessage.length}字符 assistant=${payload.assistantMessage.length}字符`,
      )

      // 获取该 scope 下已有记忆（用于 prompt 去重和去重闸门）
      const existingUser = this.memoryRepo.listByScope('user', null)
      const existingProject = payload.workspaceId
        ? this.memoryRepo.listByScope('project', payload.workspaceId)
        : []
      const existingAgent = payload.agentId
        ? this.memoryRepo.listByScope('agent', payload.agentId)
        : []

      const allExisting = [...existingUser, ...existingProject, ...existingAgent]
      // 【全流程日志·节点2】已有记忆范围（让"去重池里有什么"可见）
      log.debug(
        `【记忆抽取】去重池：user=${existingUser.length}条 ` +
          `project=${existingProject.length}条${payload.workspaceId ? `(workspace=${payload.workspaceId})` : '(未绑定)'} ` +
          `agent=${existingAgent.length}条${payload.agentId ? `(agent=${payload.agentId})` : '(未绑定)'}`,
      )
      const existingSummary = allExisting
        .map((e) => `- [${e.scope}/${e.scope_ref ?? 'global'}] ${e.name}: ${e.description}`)
        .join('\n')

      // 调用 LLM 抽取候选记忆
      const prompt = buildExtractionPrompt({
        userMessage: payload.userMessage,
        assistantMessage: payload.assistantMessage,
        recentSummary: payload.recentSummary,
        existingMemoriesSummary: existingSummary,
        workspaceId: payload.workspaceId,
        agentId: payload.agentId,
      })
      // 【S1A.1 日志治理】不再打印完整提取 prompt（含用户对话原文），
      // 只记录长度；排查 prompt 问题时应临时下断点/写临时文件，不进默认日志。
      log.info(`【记忆抽取】buildExtractionPrompt 完成：${prompt.length} 字符（内容不入日志）`)
      const rawResponse = await this.callLLM(prompt)
      // 【全流程日志·节点3】LLM 返回（让"LLM 判断了什么"可见）。
      // 【S1A.1 日志治理】不再打印返回预览（候选 JSON 内嵌 name/description/body，
      // 可能含用户原文与敏感片段；logger 的 sanitize 只作用于 args 不作用于 message）。
      log.info(`【记忆抽取】LLM 返回 ${rawResponse.length} 字符（内容不入日志）`)
      const candidates = parseCandidates(rawResponse)
      // 【全流程日志·节点4】候选解析结果（每条的 scope/type/name，让"scope 归类"可审计）
      log.debug(
        `【记忆抽取】解析出 ${candidates.length} 条候选：` +
          candidates
            .map((c) => `[${c.scope}/${c.type}] ${c.name}(conf=${c.confidence})`)
            .join(' | ') || '（空）',
      )

      if (candidates.length === 0) {
        // 提级到 info：让"LLM 主动判断无可记内容"在默认日志级别可见（区别于"抽取失败"）
        log.info(
          '【记忆抽取】本轮无可写入候选 — LLM 判断本次对话没有值得长期记住的内容（返回空或无法解析）',
        )
        return
      }

      // 逐条过闸门；per-candidate 错误隔离：单条失败（DB 约束/IO/LLM 透传）不拖死整轮
      for (const candidate of candidates) {
        try {
          const scopeRef = this.resolveScopeRef(candidate.scope, payload)
          // 【全流程日志·节点5】每条候选的 scope 解析（让"project scope 是否拿到 workspaceId"可审计）
          log.debug(
            `【记忆抽取】候选 "${candidate.name}" → scope=${candidate.scope} ` +
              `scopeRef=${scopeRef ?? '(null=user scope)'}`,
          )
          await this.processCandidate(
            candidate,
            scopeRef,
            payload.sessionId,
            buildTurnSourceAttribution(payload),
          )
        } catch (err) {
          log.warn(
            `【记忆抽取】候选 "${candidate.name}" 处理失败（已隔离，其余继续）：${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      // 更新各 scope 的 MEMORY.md 索引
      await this.refreshIndex('user', null)
      if (payload.workspaceId) {
        await this.refreshIndex('project', payload.workspaceId)
      }
      if (payload.agentId) {
        await this.refreshIndex('agent', payload.agentId)
      }
    } catch (err) {
      log.warn(`maybeWriteFromTurn failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 手动写入一条记忆
   *
   * 跳过 LLM 抽取和置信度闸门，但仍走去重/配额/敏感词闸门。
   */
  async manualWrite(
    input: Omit<MemoryCandidate, 'confidence'> & {
      scopeRef: string | null
      /** 【S2.6 / N5】有效期输入（规范化见 memory-temporal）；缺省 = 长期 */
      validUntil?: { validUntil: string; precision: 'instant' | 'date'; timezone?: string }
    },
  ): Promise<MemoryEntryRow> {
    const candidate: MemoryCandidate = { ...input, confidence: 1.0 }

    // scopeRef 空串/undefined 归一为 null（与 resolveScopeRef 对称，防 scope_ref='' 孤儿）。
    // project/agent scope 必须有合法 scopeRef；user scope 永远 null。
    const scopeRef = input.scopeRef && input.scopeRef.length > 0 ? input.scopeRef : null
    if ((candidate.scope === 'project' || candidate.scope === 'agent') && scopeRef == null) {
      throw new SparkError(
        'VALIDATION_FAILED',
        `${candidate.scope} scope 记忆需要 scopeRef（${candidate.scope === 'project' ? 'workspaceId' : 'agentId'}）。请在记忆面板选择对应项目/Agent。`,
      )
    }

    // 敏感词闸门
    if (isMemorySensitive(candidate.description, candidate.body)) {
      throw new SparkError(
        'VALIDATION_FAILED',
        '记忆内容含敏感信息，已被拒绝保存。请去掉密钥/凭证/个人隐私后重试。',
      )
    }

    // 去重闸门
    const existing = this.memoryRepo.findByName(candidate.scope, scopeRef, candidate.name)
    if (existing != null) {
      throw new SparkError(
        'ALREADY_EXISTS',
        `该 scope 下已存在同名记忆 "${candidate.name}"。请改名，或在记忆面板里编辑已有那条。`,
      )
    }

    // 配额闸门
    await this.enforceQuota(candidate.scope, scopeRef)

    // 写入（【S1B.1】统一提交原语）；来源绑定（S2.1）：手工入口固定标记
    // manual_user / manual。
    // 【S2.5】"保存意愿"与"证据状态"拆分：legacy confidence 固定 1.0 只表达
    // 用户明确要存（迁移期只读保留，不参与合并/比较）；证据的可解释状态由
    // 展示层从 authorRole/evidenceStatus 派生（MemoryPanel），不再把 1.0
    // 当作"100% 正确"的证据强度。
    // 【S2.6 / N5】有效期规范化：非法输入结构化拒绝（不静默丢弃也不捏造）
    let validUntilMs: number | null = null
    let validUntilMetaJson: string | null = null
    if (input.validUntil != null && input.validUntil.validUntil.trim() !== '') {
      const resolved = resolveValidUntil(input.validUntil)
      if (!resolved.ok) {
        throw new SparkError('VALIDATION_FAILED', `有效期设置无效：${resolved.error}`)
      }
      validUntilMs = resolved.untilMs
      validUntilMetaJson = JSON.stringify(resolved.meta)
    }
    const r = await this.commitService.commitWrite({
      scope: candidate.scope,
      scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      confidence: 1.0,
      body: candidate.body,
      authorRole: 'manual_user',
      extractionKind: 'manual',
      ...(validUntilMs != null
        ? { validUntil: validUntilMs, validUntilMeta: validUntilMetaJson }
        : {}),
      links: candidate.links ?? [],
    })
    if (!r.ok) {
      // 同名预检（上方 findByName）与唯一索引兜底之间的并发窗口
      if (r.reason === 'already_exists') {
        throw new SparkError(
          'ALREADY_EXISTS',
          `该 scope 下已存在同名记忆 "${candidate.name}"（并发写入）。请改名或稍后重试。`,
        )
      }
      throw new Error(`commitWrite failed (${r.reason}): ${r.message}`)
    }

    await this.refreshIndex(candidate.scope, scopeRef)
    return r.row
  }

  // ─── Gates ───────────────────────────────────────────────────────────

  /**
   * 闸门 0：瞬时数据
   *
   * 兜底防御：即便抽取 prompt 描述得再具体，依赖小模型守 prompt 仍可能漏判。
   * 这里对 name/description 做硬性正则检测，命中即丢。log debug 带命中原因。
   */
  private passTransientGate(candidate: MemoryCandidate): boolean {
    const hit = detectTransientMemory(candidate.name, candidate.description)
    if (hit != null) {
      log.debug(
        `Candidate dropped (transient: ${hit}): ${candidate.name} — desc="${candidate.description.slice(0, 60)}"`,
      )
      return false
    }
    return true
  }

  /**
   * 闸门 1：置信度 >= 0.6
   */
  private passConfidenceGate(candidate: MemoryCandidate): boolean {
    return candidate.confidence >= 0.6
  }

  /**
   * 闸门 2：去重/合并
   * 返回 true 表示候选应被写入（或已合并更新），false 表示应丢弃
   */
  private async passDedupGate(
    candidate: MemoryCandidate,
    scopeRef: string | null,
  ): Promise<'write' | 'merge' | 'skip'> {
    // 精确 name 匹配
    const existing = this.memoryRepo.findByName(candidate.scope, scopeRef, candidate.name)
    if (existing != null) {
      const decision = await this.llmDedupDecide(existing, candidate)
      if (decision === 'replace' || decision === 'merge') {
        // 【S1B.1】去重合并/替换统一走提交原语（先快照后 CAS）：
        // - body 带 E4 修复（FTS 正文完整）
        // - expectedVersion 持读取时版本，写入间隙条目被归档/删除/他人更新时失配丢弃
        const mergedBody =
          decision === 'merge'
            ? `${await this.storeService.readFile(existing.file_path).catch(() => '')}\n\n---\n\n${candidate.body}`
            : candidate.body
        // 【S2.5】置信度按更新类型重估（废除单调取最大）：
        // merge = 同一断言的重复提及/转述 —— 频次不是证据，独立性不可识别
        // 时不自动升级，保持既有值；replace = 新版本独立评估，用候选自身值
        const nextConfidence = decision === 'merge' ? existing.confidence : candidate.confidence
        return this.commitDedupUpdate(existing, candidate, scopeRef, mergedBody, nextConfidence)
      }
      // skip
      return 'skip'
    }

    // 关键词重叠检测（description 70%+）
    const scopeEntries = this.memoryRepo.listByScope(candidate.scope, scopeRef)
    for (const entry of scopeEntries) {
      if (keywordOverlap(entry.description, candidate.description) >= 0.7) {
        const decision = await this.llmDedupDecide(entry, candidate)
        if (decision === 'skip') return 'skip'
        if (decision === 'replace' || decision === 'merge') {
          const mergedBody =
            decision === 'merge'
              ? `${await this.storeService.readFile(entry.file_path).catch(() => '')}\n\n---\n\n${candidate.body}`
              : candidate.body
          // 【S2.5】同上：merge 不升置信（重复提及非独立证据）
          const overlapConfidence = decision === 'merge' ? entry.confidence : candidate.confidence
          return this.commitDedupUpdate(entry, candidate, scopeRef, mergedBody, overlapConfidence)
        }
      }
    }

    return 'write'
  }

  /**
   * 去重命中后的托管更新（【S1B.1】经 MemoryCommitService CAS 提交）。
   * 版本失配（条目已被归档/删除/并发更新）→ 丢弃本候选并返回 'skip'，
   * 不覆盖当前状态；晚到快照成为待清理孤儿（content_hash 失配可识别）。
   */
  private async commitDedupUpdate(
    existing: MemoryEntryRow,
    candidate: MemoryCandidate,
    scopeRef: string | null,
    body: string,
    confidence: number,
  ): Promise<'write' | 'merge' | 'skip'> {
    const r = await this.commitService.commitWrite({
      entryId: existing.id,
      expectedVersion: existing.version,
      scope: existing.scope,
      scopeRef,
      type: candidate.type,
      name: existing.name,
      description: candidate.description,
      confidence,
      body,
      links: candidate.links ?? [],
      preserveFrom: existing,
    })
    if (!r.ok) {
      log.warn(
        `dedup commit discarded (${r.reason}): id=${existing.id} name=${candidate.name} — ` +
          `${r.message}（晚到/并发写入不覆盖当前状态）`,
      )
      return 'skip'
    }
    return 'merge'
  }

  /**
   * 闸门 3：配额限制
   * 超额时自动归档末位条目
   */
  private async enforceQuota(scope: string, scopeRef: string | null): Promise<void> {
    const quota = this.getQuota(scope)
    const current = this.memoryRepo.countByScope(scope, scopeRef)
    if (current < quota) return

    const overflow = current - quota + 1 // 至少归档 1 条腾位置
    const candidates = this.memoryRepo.findEvictionCandidates(scope, scopeRef, overflow)
    for (const candidate of candidates) {
      this.memoryRepo.archive(candidate.id)
      log.info(`Memory evicted (quota): ${candidate.id} (${candidate.name})`)
    }
  }

  /**
   * 闸门 4：敏感信息
   */
  private passSensitiveGate(candidate: MemoryCandidate): boolean {
    return !isMemorySensitive(candidate.description, candidate.body)
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private async processCandidate(
    candidate: MemoryCandidate,
    scopeRef: string | null,
    sessionId: string,
    /**
     * 来源绑定（S2.1）：系统侧装配上下文，随新建落库。更新路径
     * （演化 UPDATE / V1 merge）不带来源 —— 条目来源 = 首次创建来源，
     * 更新来龙去脉由 revision 历史记录（S2.2）。
     */
    source?: {
      turnId?: string
      sourceEventId?: string | null
      authorRole?: string
      authorAgentId?: string | null
      extractionKind: string
      extractionModel?: string | null
    },
  ): Promise<void> {
    // 闸门 0：瞬时数据（兜底，置于最前以省后续开销）
    if (!this.passTransientGate(candidate)) {
      return
    }

    // 闸门 1：置信度
    if (!this.passConfidenceGate(candidate)) {
      log.debug(`Candidate dropped (confidence ${candidate.confidence} < 0.6): ${candidate.name}`)
      return
    }

    // 闸门 4：敏感词（提前检测，节省后续开销）
    if (!this.passSensitiveGate(candidate)) {
      log.debug(`Candidate dropped (sensitive content): ${candidate.name}`)
      return
    }

    // 闸门 2：演化决策（V2）或去重（V1 回退）
    if (this.evolutionService != null) {
      const verdict = await this.evolutionService.decide(candidate, candidate.scope, scopeRef)
      if (verdict.decision === 'NOOP') {
        // 【S1A.1 日志治理】演化 reason 是 LLM 自由文本、可能转述候选正文，
        // 只落决策枚举与 reason 长度，不落内容。
        log.debug(
          `Candidate NOOP (evolution): ${candidate.name}（reason ${verdict.reason.length} 字符，内容不入日志）`,
        )
        return
      }
      if (verdict.decision === 'DELETE' && verdict.targetId != null) {
        // 【P2-A 冲突性写入】目标是用户明确表达/手动创建的记忆 → 不自动失效，
        // 转候选进确认区等用户裁决（候选区不可用/入候选失败时降级走原路径）
        if (await this.deferManualTargetToCandidate(candidate, scopeRef, verdict, 'delete')) {
          return
        }
        await this.invalidateEntry(verdict.targetId)
        log.info(
          `Memory invalidated (evolution DELETE): ${verdict.targetId} ← "${candidate.name}"（reason ${verdict.reason.length} 字符，内容不入日志）`,
        )
        return
      }
      if (verdict.decision === 'UPDATE' && verdict.targetId != null) {
        // 【P2-A 冲突性写入】同上：手动来源目标的更新同样转候选
        if (await this.deferManualTargetToCandidate(candidate, scopeRef, verdict, 'update')) {
          return
        }
        await this.updateEntry(verdict.targetId, candidate, scopeRef)
        log.info(
          `Memory updated (evolution UPDATE): ${verdict.targetId} ← "${candidate.name}"（reason ${verdict.reason.length} 字符，内容不入日志）`,
        )
        return
      }
      // ADD：落到下面的配额 + 写入逻辑
      log.debug(
        `Candidate ADD (evolution): ${candidate.name}（reason ${verdict.reason.length} 字符，内容不入日志）`,
      )
    } else {
      // V1 回退：evolutionService 未注入（旧测试 / 未配检索栈）
      const dedupResult = await this.passDedupGate(candidate, scopeRef)
      if (dedupResult === 'skip') {
        log.debug(`Candidate skipped (dedup v1): ${candidate.name}`)
        return
      }
      if (dedupResult === 'merge') {
        log.debug(`Candidate merged (dedup v1): ${candidate.name}`)
        return
      }
    }

    // 闸门 3：配额
    await this.enforceQuota(candidate.scope, scopeRef)

    // 写入（【S1B.1】统一提交原语：先写快照文件，DB insert 落 version=1 + content_hash）
    const committed = await this.commitService.commitWrite({
      scope: candidate.scope,
      scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      confidence: candidate.confidence,
      body: candidate.body,
      sourceSessionId: sessionId,
      // 来源绑定（S2.1）：仅新建落来源；LLM candidate 无来源字段，此处值全部来自系统侧
      sourceEventId: source?.sourceEventId ?? null,
      sourceTurnId: source?.turnId ?? null,
      authorRole: source?.authorRole ?? null,
      authorAgentId: source?.authorAgentId ?? null,
      extractionKind: source?.extractionKind ?? null,
      extractionModel: source?.extractionModel ?? null,
      links: candidate.links ?? [],
    })
    if (!committed.ok) {
      if (committed.reason === 'already_exists') {
        // 并发窗口内同 scope 同名条目已建立（唯一索引兜底）——按去重语义放弃本条
        log.info(`Memory write skipped (concurrent duplicate): ${candidate.name}`)
        return
      }
      throw new Error(`commitWrite failed (${committed.reason}): ${committed.message}`)
    }

    log.info(
      `Memory written: ${committed.row.id} (${candidate.name}) [${candidate.scope}/${candidate.type}]`,
    )
    this.persistEntities(committed.row.id, candidate, scopeRef)
  }

  /**
   * 持久化候选的实体到关联图（实体规范化 + 链接全量替换）。
   * entityRepo 未注入或候选无实体时跳过；任何异常只 log（实体图是增强，不影响主写入）。
   */
  private persistEntities(
    memoryId: string,
    candidate: MemoryCandidate,
    scopeRef: string | null,
  ): void {
    if (this.entityRepo == null) return
    const names = candidate.entities
    if (names == null || names.length === 0) return
    try {
      this.entityRepo.upsertEntitiesForMemory(memoryId, candidate.scope, scopeRef, names)
    } catch (err) {
      log.warn(
        `entity persistence failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  /**
   * 演化 DELETE：使目标条目失效（bi-temporal），不物理删除。
   * 设 invalid_at = now、superseded_by = null（候选表明它过时，但候选本身未留存为替代）。
   * FTS 行由 memoryRepo.update 的 becomesInactive 分支自动移除；vec 行靠检索层 invalid_at 过滤（惰性）。
   */
  private async invalidateEntry(targetId: string): Promise<void> {
    const target = this.memoryRepo.getById(targetId)
    if (target == null || target.archived === 1 || target.invalid_at != null) return
    this.memoryRepo.update(targetId, { invalid_at: Date.now(), superseded_by: null })
  }

  /**
   * 演化 UPDATE：保留 id / hit_count / created_at，更新 description/body/confidence/type，
   * 旧正文追加到文件末尾的 ## History 区段（最多留 3 版），刷新 updated_at。
   * memoryRepo.update 带 body 时同事务重建 FTS 行。
   */
  private async updateEntry(
    targetId: string,
    candidate: MemoryCandidate,
    scopeRef: string | null,
  ): Promise<void> {
    const target = this.memoryRepo.getById(targetId)
    if (target == null) return

    const newBody = await this.buildEvolvedBody(target, candidate)

    // 【S2.5】演化 UPDATE 生成新版本：置信度独立评估、不继承旧值（用户
    // 纠正/实质改写允许下降 —— 单调 max 会让错误的高分永远压过纠正）
    const nextConfidence = candidate.confidence
    // 【S1B.1】统一提交原语：先写新快照文件，再 CAS 提交（expectedVersion 持
    // 读取时版本——演化决策期间的并发更新/归档/删除会失配丢弃，不覆盖当前状态）。
    const r = await this.commitService.commitWrite({
      entryId: targetId,
      expectedVersion: target.version,
      scope: target.scope,
      scopeRef,
      type: candidate.type,
      name: target.name,
      description: candidate.description,
      confidence: nextConfidence,
      body: newBody,
      links: candidate.links ?? [],
      preserveFrom: target,
    })
    if (!r.ok) {
      log.warn(
        `evolution UPDATE discarded (${r.reason}): id=${targetId} ← "${candidate.name}" — ` +
          `${r.message}（晚到/并发写入不覆盖当前状态）`,
      )
      return
    }
    this.persistEntities(targetId, candidate, scopeRef)
  }

  /**
   * 演化 UPDATE 的演化后正文：候选正文在前，旧正文摘录追加到 ## History
   * 区段（500 字截断）。旧正文读取失败如实回退为纯候选正文（不中断更新）。
   * 自动执行（updateEntry）与冲突转候选（deferManualTargetToCandidate，P2-A）
   * 共用本口径，保证用户确认后落库结果与自动路径一致。
   */
  private async buildEvolvedBody(
    target: MemoryEntryRow,
    candidate: MemoryCandidate,
  ): Promise<string> {
    let newBody = candidate.body
    try {
      const oldBody = await this.storeService.readFile(target.file_path).catch(() => '')
      if (oldBody.length > 0) {
        const stamp = new Date().toISOString()
        const oldExcerpt = oldBody.slice(0, 500)
        newBody = `${candidate.body}\n\n## History\n\n### ${stamp}（被 "${candidate.name}" 更新）\n${oldExcerpt}${oldBody.length > 500 ? ' …' : ''}`
      }
    } catch (err) {
      log.warn(
        `buildEvolvedBody: failed to read old body, overwriting: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return newBody
  }

  /**
   * 【P2-A 冲突性写入】演化 UPDATE/DELETE 的目标是"用户明确表达/手动创建"
   * 的记忆（author_role='manual_user' 或 extraction_kind='manual'）时不自动
   * 执行，转为携带 action/targetId 的候选进确认区，等用户确认后由
   * MemoryCandidateService.confirm 按动作路由执行。
   *
   * DELETE 候选展示目标当前内容（删除对象）；UPDATE 候选展示演化后正文
   * （确认后按此落库）。digest 去重由 insertPending 承担（同一冲突反复
   * 演化不累积候选票数）。
   *
   * 降级约定（候选区故障不能阻断写入链路）：repo 未注入 / 目标不存在 /
   * 目标非手动来源 / insertPending 抛错或 digest 已存在（inserted:false）
   * → 返回 false，调用方继续原自动执行路径。
   *
   * @returns true = 已转候选（调用方不再执行原失效/更新）
   */
  private async deferManualTargetToCandidate(
    candidate: MemoryCandidate,
    scopeRef: string | null,
    verdict: EvolutionVerdict,
    action: 'update' | 'delete',
  ): Promise<boolean> {
    const targetId = verdict.targetId
    if (targetId == null) return false
    if (this.candidateRepo == null) return false
    const target = this.memoryRepo.getById(targetId)
    if (target == null) return false
    if (target.author_role !== 'manual_user' && target.extraction_kind !== 'manual') return false

    try {
      const body =
        action === 'delete'
          ? await this.storeService.readFile(target.file_path).catch(() => '')
          : await this.buildEvolvedBody(target, candidate)
      const { inserted, row } = this.candidateRepo.insertPending({
        scope: candidate.scope,
        scopeRef,
        payload: {
          // target.type 与候选 type 同为四值枚举，直接兼容
          type: action === 'delete' ? target.type : candidate.type,
          name: action === 'delete' ? target.name : candidate.name,
          description: action === 'delete' ? target.description : candidate.description,
          body,
          confidence: action === 'delete' ? 1 : candidate.confidence,
          sourceIds: [],
          action,
          targetId,
        },
      })
      if (!inserted) {
        log.warn(
          `【冲突写入转候选】降级自动执行：同摘要候选已存在（status=${row?.status ?? '?'}）：` +
            `target=${target.id} ← "${candidate.name}"`,
        )
        return false
      }
      log.info(
        `【冲突写入转候选】演化 ${action === 'delete' ? 'DELETE' : 'UPDATE'} 目标为手动记忆，` +
          `转候选 #${row?.id ?? '?'} 等用户确认：target=${target.id} "${target.name}" ← ` +
          `"${candidate.name}"（reason ${verdict.reason.length} 字符，内容不入日志）`,
      )
      return true
    } catch (err) {
      log.warn(
        `【冲突写入转候选】降级自动执行（候选区故障）：target=${targetId} ← ` +
          `"${candidate.name}" — ${err instanceof Error ? err.message : String(err)}`,
      )
      return false
    }
  }

  private async llmDedupDecide(
    existing: MemoryEntryRow,
    candidate: MemoryCandidate,
  ): Promise<'merge' | 'replace' | 'skip'> {
    try {
      const prompt = buildDedupPrompt(
        { name: existing.name, description: existing.description },
        { name: candidate.name, description: candidate.description },
      )
      const raw = await this.callLLM(prompt)
      const trimmed = raw.trim().toLowerCase()
      if (trimmed === 'merge') return 'merge'
      if (trimmed === 'replace') return 'replace'
      return 'skip'
    } catch (err) {
      log.warn(
        `LLM dedup decide failed, defaulting to skip: ${err instanceof Error ? err.message : String(err)}`,
      )
      return 'skip'
    }
  }

  private resolveScopeRef(scope: string, payload: TurnPayload): string | null {
    switch (scope) {
      case 'user':
        return null
      // 空串/undefined 归一为 null（防孤儿 project 记忆）：
      // 会话未绑定 workspace 时 payload.workspaceId 是 ''（primaryWorkspaceId ?? '' 链路），
      // 原样透传会写入 scope_ref=''（非 NULL 的第三态），DB 里既不是 NULL 也不是合法 UUID，
      // 永远查不到。归一为 null 后，下游 listByScope('project', null) 精确匹配 IS NULL，
      // 配合 reader.buildScopes 的"project 必须 workspaceId"约束，空候选会被自然过滤。
      case 'project':
        return payload.workspaceId || null
      case 'agent':
        return payload.agentId || null
      default:
        return null
    }
  }

  private isEnabled(): boolean {
    const val = this.settingsGet('memory', 'enabled')
    return val !== false && val !== 0 // 默认启用
  }

  private getQuota(scope: string): number {
    const settingsQuota = this.settingsGet('memory', 'quota') as Record<string, number> | null
    if (settingsQuota && typeof settingsQuota === 'object') {
      const override = settingsQuota[scope]
      if (typeof override === 'number' && override > 0) return override
    }
    return DEFAULT_QUOTA[scope as keyof typeof DEFAULT_QUOTA] ?? 100
  }

  private async refreshIndex(
    scope: 'user' | 'project' | 'agent',
    scopeRef: string | null,
  ): Promise<void> {
    try {
      const entries = this.memoryRepo.listByScope(scope, scopeRef)
      await this.storeService.updateIndexFile(
        scope,
        scopeRef,
        entries.map((e) => ({ name: e.name, description: e.description, id: e.id })),
      )
    } catch (err) {
      log.warn(
        `refreshIndex failed for ${scope}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

export function parseCandidates(raw: string): MemoryCandidate[] {
  // 尝试提取 JSON 部分（LLM 可能包裹在 ```json``` 中）
  let json = raw.trim()
  const jsonMatch = json.match(/\[[\s\S]*\]/)
  if (jsonMatch) json = jsonMatch[0]!

  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return filterAndShapeCandidates(parsed)
    }
  } catch (err) {
    // JSON.parse 失败最常见原因：LLM 在字符串值内写了裸双引号（如 "用户叫助手"牛马王""），
    // 破坏 JSON 结构。下面用宽松提取（基于字段名前瞻）兜底，避免整轮记忆因单条脏数据丢失。
    log.warn(
      `JSON.parse 失败，启用宽松提取兜底：${(err instanceof Error ? err.message : String(err)).slice(0, 100)}`,
    )
    const loose = parseCandidatesLoose(json)
    if (loose.length > 0) {
      log.info(`宽松提取恢复 ${loose.length} 条候选（原 JSON 因未转义引号等问题无法解析）`)
      return loose
    }
    log.warn(`宽松提取也失败，丢弃本轮候选 | raw=${raw.slice(0, 200)}`)
  }
  return []
}

/** 严格 JSON.parse 成功后的过滤 + entities 整形 */
function filterAndShapeCandidates(parsed: unknown[]): MemoryCandidate[] {
  return parsed
    .filter((item: unknown): item is MemoryCandidate => {
      if (typeof item !== 'object' || item == null) return false
      const obj = item as Record<string, unknown>
      const scopeOk = obj.scope === 'user' || obj.scope === 'project' || obj.scope === 'agent'
      const typeOk =
        obj.type === 'user' ||
        obj.type === 'feedback' ||
        obj.type === 'project' ||
        obj.type === 'reference'
      return (
        scopeOk &&
        typeOk &&
        typeof obj.name === 'string' &&
        typeof obj.description === 'string' &&
        typeof obj.body === 'string' &&
        typeof obj.confidence === 'number'
      )
    })
    .map((item) => {
      const ents = (item as unknown as { entities?: unknown }).entities
      if (Array.isArray(ents) && ents.every((e) => typeof e === 'string')) {
        return { ...item, entities: ents as string[] }
      }
      return item
    })
}

/**
 * 宽松候选提取（JSON.parse 失败时的 fallback）。
 *
 * 不依赖整体 JSON 合法性，而是按已知 schema 的字段名顺序，用"下一个字段名"或 `}` 作为
 * 当前字符串值结束的前瞻，从而容忍值内的裸双引号（最常见的 LLM JSON bug）。
 *
 * 例：description = "用户叫助手"牛马王"" —— 严格 JSON.parse 在第一个内嵌引号处断裂，
 * 这里通过前瞻 ",\n  "body" 或 `}` 找到 description 的真正结束位置，正确还原值。
 */
const STRING_FIELD_ORDER = ['scope', 'type', 'name', 'description', 'body'] as const

function parseCandidatesLoose(json: string): MemoryCandidate[] {
  // 按对象块分割（顶层 [...] 内的每个 {...}）
  const blocks = json.match(/\{[\s\S]*?\}/g)
  if (blocks == null) return []
  const candidates: MemoryCandidate[] = []
  for (const block of blocks) {
    const c = extractCandidateLoose(block)
    if (c != null) candidates.push(c)
  }
  return candidates
}

function extractCandidateLoose(block: string): MemoryCandidate | null {
  const get = (field: string, nextField?: string): string | undefined => {
    const startRe = new RegExp(`"${field}"\\s*:\\s*"`)
    const startMatch = block.match(startRe)
    if (startMatch == null || startMatch.index == null) return undefined
    const startIdx = startMatch.index + startMatch[0].length
    // 值结束于：",\s*"<nextField>" 或 "\s*,?\s*}（用前瞻，不消耗）
    let endIdx = -1
    if (nextField != null) {
      const endRe = new RegExp(`"\\s*,\\s*"${nextField}"\\s*:`)
      const endMatch = block.slice(startIdx).match(endRe)
      endIdx = endMatch != null && endMatch.index != null ? startIdx + endMatch.index : -1
    }
    if (endIdx === -1) {
      // 当前是最后一个字符串字段（body）：结束于 "}\s*$ 或 "\s*,\s*"(confidence|links|entities)"
      const endMatch = block
        .slice(startIdx)
        .match(/"\s*(?:,\s*"(?:confidence|links|entities)"|,?\s*\})/)
      endIdx = endMatch != null && endMatch.index != null ? startIdx + endMatch.index : block.length
    }
    return block.slice(startIdx, endIdx)
  }

  const scope = get('scope', 'type')
  const type = get('type', 'name')
  const name = get('name', 'description')
  const description = get('description', 'body')
  const body = get('body')
  if (scope == null || type == null || name == null || description == null || body == null)
    return null
  // 枚举校验（与严格路径一致）
  if (scope !== 'user' && scope !== 'project' && scope !== 'agent') return null
  if (type !== 'user' && type !== 'feedback' && type !== 'project' && type !== 'reference')
    return null
  // confidence（数值字段，单独提）
  const confMatch = block.match(/"confidence"\s*:\s*([0-9]+\.?[0-9]*)/)
  const confidence = confMatch != null ? Number(confMatch[1]) : 0.7
  // entities（数组字段，宽松提取）
  const entities: string[] = []
  const entMatch = block.match(/"entities"\s*:\s*\[([\s\S]*?)\]/)
  if (entMatch != null) {
    for (const em of entMatch[1]!.matchAll(/"([^"]+)"/g)) {
      entities.push(em[1]!)
    }
  }
  return {
    scope,
    type,
    name,
    description,
    body,
    confidence,
    ...(entities.length > 0 ? { entities } : {}),
  }
}

/**
 * 简易关键词重叠率计算
 * 基于 word-level Jaccard similarity
 */
function keywordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++
  }
  const union = new Set([...wordsA, ...wordsB]).size
  return union > 0 ? intersection / union : 0
}

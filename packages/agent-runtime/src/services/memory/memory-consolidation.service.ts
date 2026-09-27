/**
 * @module memory-consolidation.service
 *
 * 记忆整合（consolidation）—— 回顾性反思 job。
 *
 * 写入时的演化决策（T2.1）处理「新候选 vs 已有」；整合处理「已积累记忆之间的回顾性关系」：
 *   - MERGE：同一事实被存成多条（写入时漏判）→ 保留最完整的一条，合并要点，其余失效
 *   - ELEVATE：多条低阶 feedback 暗示通用模式 → 升华一条高阶 feedback
 *
 * 触发（settings memory.consolidation.* 可配，默认 threshold=30 / intervalDays=7）：
 *   某 scope 有效条目 ≥ threshold 且距上次整合 ≥ intervalDays → 在 reader 注入点
 *   fire-and-forget 触发。进程度量：app_settings(memory / lastConsolidationAt:<scopeKey>)。
 *
 * 全程 fire-and-forget + try/catch：任何失败仅 log，绝不阻塞主对话。
 */

import { createLogger } from '@spark/shared'
import type {
  MemoryRepository,
  MemoryEntityRepository,
  MemoryEntryRow,
  MemoryRevisionRepository,
  MemoryCandidateRepository,
} from '@spark/storage'
import { normalizeBodyForGuard } from '@spark/storage'
import type { MemoryStoreService } from './memory-store.service.js'
import { MemoryCommitService } from './memory-commit.service.js'
import { buildConsolidationPrompt } from './memory-extraction.prompt.js'
import { isMemorySensitive } from './sanitizer.js'

const log = createLogger('memory:consolidation')

const DEFAULT_THRESHOLD = 30
const DEFAULT_INTERVAL_DAYS = 7
const DAY_MS = 86_400_000
const SOURCE_TAG = 'consolidation'

type Scope = 'user' | 'project' | 'agent'

export interface ConsolidationScopeRef {
  scope: Scope
  scopeRef: string | null
}

export class MemoryConsolidationService {
  /**
   * 【S1B.3】进程级互斥（static）：实例每 turn 在 session.service 新建，
   * 实例字段的锁形同虚设；static 让同进程内所有实例共享同一把锁。
   * 跨进程/长窗口重入由 lastConsolidationAt 持久占坑（见 consolidateIfDue）兜底。
   */
  private static running = false

  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
    private readonly callLLM: (prompt: string) => Promise<string>,
    private readonly entityRepo: MemoryEntityRepository | null = null,
    /** 读/写 app_settings（lastConsolidationAt 标记）；默认走 memoryRepo.db 不便，故注入 */
    private readonly settingsSet?: (category: string, key: string, value: unknown) => void,
    /** 【S2.2】revision 历史与派生边（MERGE/ELEVATE 保留旧版本与来源关系）；缺省不记录 */
    private readonly revisionRepo: MemoryRevisionRepository | null = null,
    /**
     * 【审查修复】提交原语（MERGE 经 commitUpdate 走"CAS 失配恢复权威正文"，
     * 与 writer 全部更新路径同一不变量）；缺省内部构造，零破坏。
     */
    private readonly commitService: MemoryCommitService | null = null,
    /**
     * 【S2.3】候选确认区：ELEVATE 不再直接写入稳定 feedback，先入候选区
     * 待真实用户结构化确认（缺省 null = 跳过 ELEVATE，不产生候选）。
     */
    private readonly candidateRepo: MemoryCandidateRepository | null = null,
  ) {
    this.commitSvc = commitService ?? new MemoryCommitService(memoryRepo, storeService)
  }

  /** 实际使用的提交原语（见构造器说明） */
  private readonly commitSvc: MemoryCommitService

  /** @visibleForTesting 复位进程级互斥（仅测试隔离用） */
  static resetReentrancyForTest(): void {
    MemoryConsolidationService.running = false
  }

  /**
   * 检查并执行到期的 scope（fire-and-forget 入口）。
   * 进程级互斥 + 持久占坑双重防重入；任何异常仅 log。
   *
   * @param scopes 本次会话相关的 scope 组合（user + 当前 workspace + 当前 agent）
   */
  async maybeConsolidate(scopes: ConsolidationScopeRef[]): Promise<void> {
    if (MemoryConsolidationService.running) return
    if (!this.isEnabled()) return
    MemoryConsolidationService.running = true
    try {
      for (const { scope, scopeRef } of scopes) {
        try {
          await this.consolidateIfDue(scope, scopeRef)
        } catch (err) {
          log.warn(
            `consolidation failed for ${scope}/${scopeRef ?? '∅'} (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    } finally {
      MemoryConsolidationService.running = false
    }
  }

  private async consolidateIfDue(scope: Scope, scopeRef: string | null): Promise<void> {
    const entries = this.memoryRepo.listByScope(scope, scopeRef) // 默认排除归档
    // 只算有效（未失效）条目
    const active = entries.filter((e) => e.invalid_at == null)
    const threshold = this.getThreshold()
    if (active.length < threshold) return

    const last = this.getLastConsolidationAt(scope, scopeRef)
    const intervalMs = this.getIntervalDays() * DAY_MS
    if (last != null && Date.now() - last < intervalMs) return // 未到间隔

    // 【S1B.3】持久占坑：检查通过即写 lastConsolidationAt（LLM 调用前）。
    // 实例每 turn 新建，实例锁无法防跨实例重入；本标记落在 app_settings，
    // 任何后续实例/进程触发都会被上面的间隔条件挡住——LLM 调用进行中
    // （可达数十秒）的窗口期不再产生重复整合。占坑后失败不回滚：整合是
    // 幂等收益型操作，宁可等下个 interval 重试，不可重复执行。
    this.markConsolidated(scope, scopeRef)

    const prompt = buildConsolidationPrompt(
      scope,
      active.map((e) => ({ id: e.id, name: e.name, type: e.type, description: e.description })),
    )
    const raw = await this.callLLM(prompt)
    const actions = parseActions(raw, active)
    if (actions.length === 0) {
      log.debug(`consolidation: no actions for ${scope}/${scopeRef ?? '∅'}`)
      return
    }

    let applied = 0
    for (const action of actions) {
      try {
        if (action.action === 'MERGE') {
          await this.applyMerge(action, scope, scopeRef)
        } else if (action.action === 'ELEVATE') {
          await this.applyElevate(action, scope, scopeRef)
        }
        applied += 1
      } catch (err) {
        log.warn(
          `consolidation action failed (${action.action}): ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    log.info(
      `consolidation ${scope}/${scopeRef ?? '∅'}: ${applied}/${actions.length} actions applied (${active.length} entries reviewed)`,
    )
  }

  // ─── 动作执行 ─────────────────────────────────────────────────────────

  /** MERGE：keepId 更新为合并描述 + 吸收 dropIds 要点；dropIds 置失效指向 keepId。 */
  private async applyMerge(
    action: Extract<ConsolidationAction, { action: 'MERGE' }>,
    scope: Scope,
    scopeRef: string | null,
  ): Promise<void> {
    const keep = this.memoryRepo.getById(action.keepId)
    if (keep == null || keep.invalid_at != null) return

    // 读 keep + 各 drop 的正文，合并要点进 keep 的 History
    let mergedBody = ''
    try {
      mergedBody = await this.storeService.readFile(keep.file_path).catch(() => '')
    } catch {
      /* keep 无正文也能继续 */
    }
    // 【S2.2】keep 的被覆盖版本正文由提交原语在写新快照前自行读取并随 CAS
    // 进 revision 历史（kind='merge'），此处不再单独保留。

    const drops: MemoryEntryRow[] = []
    const dropBodies = new Map<string, string>()
    for (const dropId of action.dropIds) {
      const drop = this.memoryRepo.getById(dropId)
      if (drop == null || drop.invalid_at != null || drop.id === keep.id) continue
      drops.push(drop)
      try {
        const dropBody = normalizeBodyForGuard(
          await this.storeService.readFile(drop.file_path).catch(() => ''),
        )
        dropBodies.set(drop.id, dropBody)
        if (dropBody.length > 0 || drop.description.length > 0) {
          // drop 随后会失效；这里必须保留全文，否则旧实现只取前 400 字会造成不可恢复的数据丢失。
          mergedBody += `\n\n## 合并自 ${drop.id}（${drop.name}）\n${drop.description}${dropBody.length > 0 ? '\n\n' + dropBody : ''}`
        }
      } catch {
        /* 读不到也继续 */
      }
    }
    if (drops.length === 0) return // 没有有效 drop，不操作

    // 【S2.4 统一写入不变量】入口 4 敏感内容闸门：整合产物（合并描述/正文）
    // 不得绕过 —— 命中即丢弃本动作（code=sensitive，结构化日志按类别断言）
    if (isMemorySensitive(action.mergedDescription, mergedBody)) {
      log.info(
        `consolidation MERGE dropped (rejection_code=sensitive): keep=${keep.id} — ` +
          `合并产物含敏感信息，不写入`,
      )
      return
    }

    const nextConfidence = Math.max(keep.confidence, ...drops.map((d) => d.confidence))
    // 【审查修复】经提交原语 CAS 更新（先写文件后 CAS 的顺序不变，但失配时
    // 会尽力恢复被覆盖的权威正文——原实现直接 compareAndSwap 失配后 keep 的
    // 正文文件已被 mergedBody 覆盖，违反"旧权威版本仍完整"）。expectedVersion
    // 持读取时版本，整合期间 keep 被并发更新/归档时失配丢弃，不覆盖当前状态。
    // 被覆盖的 keep 版本进 revision 历史（kind='merge'）。
    const committed = await this.commitSvc.commitWrite({
      entryId: keep.id,
      expectedVersion: keep.version,
      scope: keep.scope,
      scopeRef: keep.scope_ref,
      type: keep.type,
      name: keep.name,
      description: action.mergedDescription,
      confidence: nextConfidence,
      body: mergedBody,
      preserveFrom: keep,
      revisionKind: 'merge',
    })
    if (!committed.ok) {
      log.warn(
        `consolidation MERGE discarded (${committed.reason}): keep=${keep.id} ` +
          `expectedVersion=${keep.version}（并发写入/归档，不覆盖当前状态）`,
      )
      return
    }

    // dropIds 失效，指向 keep。【S2.2】每个 drop 的当前版本进 revision 历史
    // （kind='supersede'，successor 指向 keep）+ 记录派生边 drop → keep
    //（来源撤回时可沿边找到派生条目，H2 纠正影响传播）
    const now = Date.now()
    for (const drop of drops) {
      this.memoryRepo.update(drop.id, { invalid_at: now, superseded_by: keep.id }, undefined, {
        oldBody: dropBodies.get(drop.id) ?? '',
        kind: 'supersede',
        successorId: keep.id,
        note: 'consolidation merge',
      })
      this.revisionRepo?.insertDerivation(drop.id, keep.id, 'merge')
    }
    log.debug(`consolidation MERGE: keep ${keep.id} ← drop ${drops.map((d) => d.id).join(',')}`)
  }

  /**
   * ELEVATE（S2.3 重设计）：提议进候选区，不直接写入稳定 feedback。
   *
   * 晋级须真实用户经可信界面的结构化确认（candidate id + 内容摘要），
   * 由 MemoryCandidateService.confirm 创建条目并记派生边 —— 模型自称
   * 确认无可达通道（N12）。同 scope 同摘要的既有候选（任意状态，含已
   * 拒绝）不重复征集（N1/N2：重复总结/整合不累积票数）。
   */
  private async applyElevate(
    action: Extract<ConsolidationAction, { action: 'ELEVATE' }>,
    scope: Scope,
    scopeRef: string | null,
  ): Promise<void> {
    if (this.candidateRepo == null) {
      // 未接候选仓库（旧调用方）：ELEVATE 直接跳过 —— 宁可不晋级，
      // 也不绕过确认入口自动写入稳定 feedback
      log.debug('consolidation ELEVATE skipped (candidate repo not wired)')
      return
    }
    // sourceIds 必须仍有效（>=2 条低阶证据才成候选）
    const validSources = action.sourceIds
      .map((id) => this.memoryRepo.getById(id))
      .filter((e): e is MemoryEntryRow => e != null && e.invalid_at == null)
    if (validSources.length < 2) return

    // 撞名保护：提议名与现有有效条目撞（确认落库会撞唯一约束）→ 不征集
    if (this.memoryRepo.findByName(scope, scopeRef, action.newMemory.name) != null) {
      log.debug(`consolidation ELEVATE skipped (name collision): ${action.newMemory.name}`)
      return
    }

    // 【S2.4】入口 4 敏感内容闸门：候选载荷含敏感信息不征集（确认侧另有
    // 二道防线 —— 候选入库前与晋级落库前各查一次）
    if (isMemorySensitive(action.newMemory.description, action.newMemory.body)) {
      log.info(
        `consolidation ELEVATE dropped (rejection_code=sensitive): ${action.newMemory.name} — ` +
          `提议含敏感信息，不进候选区`,
      )
      return
    }

    const { inserted, row } = this.candidateRepo.insertPending({
      scope,
      scopeRef,
      payload: {
        type: action.newMemory.type,
        name: action.newMemory.name,
        description: action.newMemory.description,
        body: action.newMemory.body,
        confidence: action.newMemory.confidence,
        ...(action.newMemory.entities != null && action.newMemory.entities.length > 0
          ? { entities: action.newMemory.entities }
          : {}),
        sourceIds: validSources.map((s) => s.id),
      },
    })
    if (!inserted) {
      // 同摘要既有候选（pending/confirmed/rejected/expired）—— 不重复征集
      log.debug(
        `consolidation ELEVATE deduped (digest exists, status=${row?.status ?? '?'}): ` +
          action.newMemory.name,
      )
      return
    }
    log.info(
      `consolidation ELEVATE proposed as candidate #${row?.id ?? '?'} ` +
        `(${scope}/${scopeRef ?? '∅'} "${action.newMemory.name}") — 等待用户确认晋级`,
    )
  }

  // ─── 配置 / 标记 ─────────────────────────────────────────────────────

  private isEnabled(): boolean {
    const v = this.settingsGet('memory', 'consolidationEnabled')
    return v !== false && v !== 0 // 默认启用
  }
  private getThreshold(): number {
    const v = this.settingsGet('memory', 'consolidationThreshold')
    return typeof v === 'number' && v > 0 ? Math.floor(v) : DEFAULT_THRESHOLD
  }
  private getIntervalDays(): number {
    const v = this.settingsGet('memory', 'consolidationIntervalDays')
    return typeof v === 'number' && v > 0 ? v : DEFAULT_INTERVAL_DAYS
  }

  private scopeKey(scope: Scope, scopeRef: string | null): string {
    return `lastConsolidationAt:${scope}:${scopeRef ?? '∅'}`
  }
  private getLastConsolidationAt(scope: Scope, scopeRef: string | null): number | null {
    const v = this.settingsGet('memory', this.scopeKey(scope, scopeRef))
    if (typeof v === 'number' && v > 0) return v
    // 兼容字符串时间戳
    if (typeof v === 'string') {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
    return null
  }
  private markConsolidated(scope: Scope, scopeRef: string | null): void {
    try {
      this.settingsSet?.('memory', this.scopeKey(scope, scopeRef), Date.now())
    } catch (err) {
      log.debug(
        `markConsolidated failed (will re-trigger next time): ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

// ─── 动作解析 ────────────────────────────────────────────────────────────

type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

type ConsolidationAction =
  | {
      action: 'MERGE'
      keepId: string
      dropIds: string[]
      mergedDescription: string
      reason: string
    }
  | {
      action: 'ELEVATE'
      sourceIds: string[]
      newMemory: {
        name: string
        description: string
        body: string
        type: MemoryType
        confidence: number
        entities?: string[]
      }
      reason: string
    }

/**
 * 解析整合 LLM 输出。校验 id 都在 entries 列表内；非法动作丢弃。
 * 导出供单测。
 */
export function parseActions(raw: string, entries: Array<{ id: string }>): ConsolidationAction[] {
  try {
    let json = raw.trim()
    const m = json.match(/\[[\s\S]*\]/)
    if (m) json = m[0]!
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []

    const validIds = new Set(entries.map((e) => e.id))
    const out: ConsolidationAction[] = []
    for (const item of arr) {
      if (typeof item !== 'object' || item == null) continue
      const obj = item as Record<string, unknown>
      if (obj.action === 'MERGE') {
        const keepId = typeof obj.keepId === 'string' ? obj.keepId : undefined
        const dropIds = Array.isArray(obj.dropIds)
          ? obj.dropIds.filter((x): x is string => typeof x === 'string')
          : []
        const mergedDescription =
          typeof obj.mergedDescription === 'string' ? obj.mergedDescription : ''
        if (keepId == null || !validIds.has(keepId)) continue
        const validDrops = dropIds.filter((id) => validIds.has(id) && id !== keepId)
        if (validDrops.length === 0) continue
        out.push({
          action: 'MERGE',
          keepId,
          dropIds: validDrops,
          mergedDescription: mergedDescription.slice(0, 200),
          reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '',
        })
      } else if (obj.action === 'ELEVATE') {
        const sourceIds = Array.isArray(obj.sourceIds)
          ? obj.sourceIds.filter((x): x is string => typeof x === 'string')
          : []
        const validSources = sourceIds.filter((id) => validIds.has(id))
        const nm = obj.newMemory as Record<string, unknown> | undefined
        if (validSources.length < 2 || nm == null) continue
        if (
          typeof nm.name !== 'string' ||
          typeof nm.description !== 'string' ||
          typeof nm.body !== 'string'
        )
          continue
        const confidence = typeof nm.confidence === 'number' ? nm.confidence : 0.7
        const rawType = typeof nm.type === 'string' ? nm.type : 'feedback'
        const type: MemoryType =
          rawType === 'user' ||
          rawType === 'feedback' ||
          rawType === 'project' ||
          rawType === 'reference'
            ? rawType
            : 'feedback'
        out.push({
          action: 'ELEVATE',
          sourceIds: validSources,
          newMemory: {
            name: nm.name,
            description: nm.description,
            body: nm.body,
            type,
            confidence,
            ...(Array.isArray(nm.entities) && nm.entities.every((e) => typeof e === 'string')
              ? { entities: nm.entities as string[] }
              : {}),
          },
          reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '',
        })
      }
    }
    return out
  } catch {
    log.debug(`consolidation parse failed: ${raw.slice(0, 200)}`)
    return []
  }
}

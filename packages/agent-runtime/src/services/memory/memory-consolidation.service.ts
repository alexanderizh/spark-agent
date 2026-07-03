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

import crypto from 'node:crypto'
import { createLogger } from '@spark/shared'
import type { MemoryRepository, MemoryEntityRepository, MemoryEntryRow } from '@spark/storage'
import type { MemoryStoreService } from './memory-store.service.js'
import type { MemoryFileMeta } from './memory-store.service.js'
import { buildConsolidationPrompt } from './memory-extraction.prompt.js'

const log = createLogger('memory:consolidation')

const DEFAULT_THRESHOLD = 30
const DEFAULT_INTERVAL_DAYS = 7
const DAY_MS = 86_400_000
const SOURCE_TAG = 'consolidation'

const SCOPE_PREFIX: Record<string, string> = { user: 'usr', project: 'prj', agent: 'agt' }

type Scope = 'user' | 'project' | 'agent'

export interface ConsolidationScopeRef {
  scope: Scope
  scopeRef: string | null
}

export class MemoryConsolidationService {
  private running = false

  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
    private readonly callLLM: (prompt: string) => Promise<string>,
    private readonly entityRepo: MemoryEntityRepository | null = null,
    /** 读/写 app_settings（lastConsolidationAt 标记）；默认走 memoryRepo.db 不便，故注入 */
    private readonly settingsSet?: (category: string, key: string, value: unknown) => void,
  ) {}

  /**
   * 检查并执行到期的 scope（fire-and-forget 入口）。
   * 进程内防重入；任何异常仅 log。
   *
   * @param scopes 本次会话相关的 scope 组合（user + 当前 workspace + 当前 agent）
   */
  async maybeConsolidate(scopes: ConsolidationScopeRef[]): Promise<void> {
    if (this.running) return
    if (!this.isEnabled()) return
    this.running = true
    try {
      for (const { scope, scopeRef } of scopes) {
        try {
          await this.consolidateIfDue(scope, scopeRef)
        } catch (err) {
          log.warn(`consolidation failed for ${scope}/${scopeRef ?? '∅'} (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    } finally {
      this.running = false
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

    const prompt = buildConsolidationPrompt(
      scope,
      active.map((e) => ({ id: e.id, name: e.name, type: e.type, description: e.description })),
    )
    const raw = await this.callLLM(prompt)
    const actions = parseActions(raw, active)
    if (actions.length === 0) {
      log.debug(`consolidation: no actions for ${scope}/${scopeRef ?? '∅'}`)
      this.markConsolidated(scope, scopeRef)
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
        log.warn(`consolidation action failed (${action.action}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.markConsolidated(scope, scopeRef)
    log.info(`consolidation ${scope}/${scopeRef ?? '∅'}: ${applied}/${actions.length} actions applied (${active.length} entries reviewed)`)
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
    } catch { /* keep 无正文也能继续 */ }

    const drops: MemoryEntryRow[] = []
    for (const dropId of action.dropIds) {
      const drop = this.memoryRepo.getById(dropId)
      if (drop == null || drop.invalid_at != null || drop.id === keep.id) continue
      drops.push(drop)
      try {
        const dropBody = await this.storeService.readFile(drop.file_path).catch(() => '')
        if (dropBody.length > 0 || drop.description.length > 0) {
          mergedBody += `\n\n## 合并自 ${drop.id}（${drop.name}）\n${drop.description}${dropBody.length > 0 ? '\n\n' + dropBody.slice(0, 400) : ''}`
        }
      } catch { /* 读不到也继续 */ }
    }
    if (drops.length === 0) return // 没有有效 drop，不操作

    const nextConfidence = Math.max(keep.confidence, ...drops.map((d) => d.confidence))
    // 先写文件（事实来源）再更新 DB+FTS（与 updateEntry 同样的稳健顺序）
    const meta: MemoryFileMeta = {
      id: keep.id, scope: keep.scope, scopeRef: keep.scope_ref, type: keep.type,
      name: keep.name, description: action.mergedDescription, confidence: nextConfidence,
      createdAt: keep.created_at, updatedAt: Date.now(), hitCount: keep.hit_count,
      lastHitAt: keep.last_hit_at, sourceSessionId: keep.source_session_id,
      links: [], archived: false,
    }
    await this.storeService.writeFile({ meta, body: mergedBody })
    this.memoryRepo.update(keep.id, { description: action.mergedDescription, confidence: nextConfidence }, mergedBody)

    // dropIds 失效，指向 keep
    const now = Date.now()
    for (const drop of drops) {
      this.memoryRepo.update(drop.id, { invalid_at: now, superseded_by: keep.id })
    }
    log.debug(`consolidation MERGE: keep ${keep.id} ← drop ${drops.map((d) => d.id).join(',')}`)
  }

  /** ELEVATE：新增一条高阶 feedback，source_session_id='consolidation' 标识来源。 */
  private async applyElevate(
    action: Extract<ConsolidationAction, { action: 'ELEVATE' }>,
    scope: Scope,
    scopeRef: string | null,
  ): Promise<void> {
    // sourceIds 必须仍有效
    const validSources = action.sourceIds
      .map((id) => this.memoryRepo.getById(id))
      .filter((e): e is MemoryEntryRow => e != null && e.invalid_at == null)
    if (validSources.length < 2) return

    // 撞名保护：新升华条目 name 若与现有有效条目撞（唯一约束 scope+scope_ref+name），
    // insert 会抛 UNIQUE。此时跳过（升华非关键，宁可不做，避免 per-action catch 吞错后丢动作）。
    if (this.memoryRepo.findByName(scope, scopeRef, action.newMemory.name) != null) {
      log.debug(`consolidation ELEVATE skipped (name collision): ${action.newMemory.name}`)
      return
    }

    const id = generateId(scope)
    const filePath = this.storeService.getFilePath(scope, scopeRef, id)
    const now = Date.now()
    const meta: MemoryFileMeta = {
      id, scope, scopeRef, type: action.newMemory.type,
      name: action.newMemory.name, description: action.newMemory.description,
      confidence: action.newMemory.confidence,
      createdAt: now, updatedAt: now, hitCount: 0, lastHitAt: null,
      sourceSessionId: SOURCE_TAG, links: [], archived: false,
    }
    const body = `${action.newMemory.body}\n\n## 升华来源\n${validSources.map((s) => `- [${s.id}] ${s.name}`).join('\n')}`
    // 先写文件（事实来源）再落库（与 writer 稳健顺序一致），insert 传 body 让 FTS 索引正文
    await this.storeService.writeFile({ meta, body })
    this.memoryRepo.insert({
      id, scope, scope_ref: scopeRef, type: action.newMemory.type,
      name: action.newMemory.name, description: action.newMemory.description,
      file_path: filePath, confidence: action.newMemory.confidence,
      hit_count: 0, last_hit_at: null, source_session_id: SOURCE_TAG, archived: 0,
    }, body)
    // 升华条目的实体落库（entityRepo 提供时；此前构造收下但未使用 → 死依赖，现接上）
    if (this.entityRepo != null && action.newMemory.entities != null && action.newMemory.entities.length > 0) {
      try {
        this.entityRepo.upsertEntitiesForMemory(id, scope, scopeRef, action.newMemory.entities)
      } catch (err) {
        log.warn(`ELEVATE entity persist failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    log.debug(`consolidation ELEVATE: ${id} ← sources ${validSources.map((s) => s.id).join(',')}`)
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
      log.debug(`markConsolidated failed (will re-trigger next time): ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── 动作解析 ────────────────────────────────────────────────────────────

type MemoryType = 'user' | 'feedback' | 'project' | 'reference'

type ConsolidationAction =
  | { action: 'MERGE'; keepId: string; dropIds: string[]; mergedDescription: string; reason: string }
  | { action: 'ELEVATE'; sourceIds: string[]; newMemory: { name: string; description: string; body: string; type: MemoryType; confidence: number; entities?: string[] }; reason: string }

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
        const dropIds = Array.isArray(obj.dropIds) ? obj.dropIds.filter((x): x is string => typeof x === 'string') : []
        const mergedDescription = typeof obj.mergedDescription === 'string' ? obj.mergedDescription : ''
        if (keepId == null || !validIds.has(keepId)) continue
        const validDrops = dropIds.filter((id) => validIds.has(id) && id !== keepId)
        if (validDrops.length === 0) continue
        out.push({
          action: 'MERGE', keepId, dropIds: validDrops, mergedDescription: mergedDescription.slice(0, 200),
          reason: typeof obj.reason === 'string' ? obj.reason.slice(0, 200) : '',
        })
      } else if (obj.action === 'ELEVATE') {
        const sourceIds = Array.isArray(obj.sourceIds) ? obj.sourceIds.filter((x): x is string => typeof x === 'string') : []
        const validSources = sourceIds.filter((id) => validIds.has(id))
        const nm = obj.newMemory as Record<string, unknown> | undefined
        if (validSources.length < 2 || nm == null) continue
        if (typeof nm.name !== 'string' || typeof nm.description !== 'string' || typeof nm.body !== 'string') continue
        const confidence = typeof nm.confidence === 'number' ? nm.confidence : 0.7
        const rawType = typeof nm.type === 'string' ? nm.type : 'feedback'
        const type: MemoryType = rawType === 'user' || rawType === 'feedback' || rawType === 'project' || rawType === 'reference' ? rawType : 'feedback'
        out.push({
          action: 'ELEVATE', sourceIds: validSources,
          newMemory: {
            name: nm.name, description: nm.description, body: nm.body, type, confidence,
            ...(Array.isArray(nm.entities) && nm.entities.every((e) => typeof e === 'string') ? { entities: nm.entities as string[] } : {}),
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

function generateId(scope: string): string {
  const prefix = SCOPE_PREFIX[scope] ?? 'mem'
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

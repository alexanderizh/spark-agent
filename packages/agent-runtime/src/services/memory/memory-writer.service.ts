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

import crypto from 'node:crypto'
import { MemoryRepository } from '@spark/storage'
import type { MemoryEntryRow } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { MemoryStoreService } from './memory-store.service.js'
import { isMemorySensitive, detectTransientMemory } from './sanitizer.js'
import { buildExtractionPrompt, buildDedupPrompt } from './memory-extraction.prompt.js'
import type { MemoryFileMeta } from './memory-store.service.js'

const log = createLogger('memory:writer')

// ─── Types ────────────────────────────────────────────────────────────────

export interface TurnPayload {
  sessionId: string
  workspaceId: string
  agentId: string
  userMessage: string
  assistantMessage: string
  recentSummary: string
}

export interface MemoryCandidate {
  scope: 'user' | 'project' | 'agent'
  type: 'user' | 'feedback' | 'project' | 'reference'
  name: string
  description: string
  body: string
  confidence: number
  links?: string[]
}

export interface MemoryInjection {
  block: string
  injectedIds: string[]
  droppedCount: number
}

/** 默认配额 */
const DEFAULT_QUOTA = { user: 100, project: 200, agent: 50 }

/** ID 前缀映射 */
const SCOPE_PREFIX: Record<string, string> = {
  user: 'usr',
  project: 'prj',
  agent: 'agt',
}

/** LLM 调用函数签名 */
export type LLMCallFn = (prompt: string) => Promise<string>

// ─── Service ──────────────────────────────────────────────────────────────

export class MemoryWriterService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
    private readonly callLLM: LLMCallFn,
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

      // 获取该 scope 下已有记忆（用于 prompt 去重和去重闸门）
      const existingUser = this.memoryRepo.listByScope('user', null)
      const existingProject = payload.workspaceId
        ? this.memoryRepo.listByScope('project', payload.workspaceId)
        : []
      const existingAgent = payload.agentId
        ? this.memoryRepo.listByScope('agent', payload.agentId)
        : []

      const allExisting = [...existingUser, ...existingProject, ...existingAgent]
      const existingSummary = allExisting
        .map((e) => `- [${e.scope}/${e.scope_ref ?? 'global'}] ${e.name}: ${e.description}`)
        .join('\n')

      // 调用 LLM 抽取候选记忆
      const prompt = buildExtractionPrompt({
        userMessage: payload.userMessage,
        assistantMessage: payload.assistantMessage,
        recentSummary: payload.recentSummary,
        existingMemoriesSummary: existingSummary,
      })

      const rawResponse = await this.callLLM(prompt)
      const candidates = parseCandidates(rawResponse)

      if (candidates.length === 0) {
        log.debug('No memory candidates extracted from this turn')
        return
      }

      // 逐条过四道闸门
      for (const candidate of candidates) {
        const scopeRef = this.resolveScopeRef(candidate.scope, payload)
        await this.processCandidate(candidate, scopeRef, payload.sessionId)
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
    input: Omit<MemoryCandidate, 'confidence'> & { scopeRef: string | null },
  ): Promise<MemoryEntryRow> {
    const candidate: MemoryCandidate = { ...input, confidence: 1.0 }

    // 敏感词闸门
    if (isMemorySensitive(candidate.description, candidate.body)) {
      throw new Error('Memory contains sensitive content and was rejected')
    }

    // 去重闸门
    const existing = this.memoryRepo.findByName(candidate.scope, input.scopeRef, candidate.name)
    if (existing != null) {
      throw new Error(`Memory with name "${candidate.name}" already exists in this scope. Use update instead.`)
    }

    // 配额闸门
    await this.enforceQuota(candidate.scope, input.scopeRef)

    // 写入
    const id = generateId(candidate.scope)
    const filePath = this.storeService.getFilePath(candidate.scope, input.scopeRef, id)

    const meta: MemoryFileMeta = {
      id,
      scope: candidate.scope,
      scopeRef: input.scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      confidence: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hitCount: 0,
      lastHitAt: null,
      sourceSessionId: null,
      links: candidate.links ?? [],
      archived: false,
    }

    await this.storeService.writeFile({ meta, body: candidate.body })

    const row = this.memoryRepo.insert({
      id,
      scope: candidate.scope,
      scope_ref: input.scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      file_path: filePath,
      confidence: 1.0,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: null,
      archived: 0,
    })

    await this.refreshIndex(candidate.scope, input.scopeRef)
    return row
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
      log.debug(`Candidate dropped (transient: ${hit}): ${candidate.name} — desc="${candidate.description.slice(0, 60)}"`)
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
      if (decision === 'replace') {
        // 替换：删除旧文件，更新 SQLite
        await this.storeService.deleteFile(existing.file_path)
        this.memoryRepo.update(existing.id, {
          description: candidate.description,
          file_path: this.storeService.getFilePath(candidate.scope, scopeRef, existing.id),
          confidence: candidate.confidence,
        })
        // 写入新文件
        const meta = rowToMeta(existing, candidate)
        await this.storeService.writeFile({
          meta,
          body: candidate.body,
        })
        return 'merge'
      }
      if (decision === 'merge') {
        // 合并：保留旧 body + 追加
        const existingBody = await this.storeService.readFile(existing.file_path).catch(() => '')
        await this.storeService.deleteFile(existing.file_path)
        this.memoryRepo.update(existing.id, {
          description: candidate.description,
          file_path: this.storeService.getFilePath(candidate.scope, scopeRef, existing.id),
          confidence: Math.max(existing.confidence, candidate.confidence),
        })
        const meta = rowToMeta(existing, candidate)
        await this.storeService.writeFile({
          meta,
          body: `${existingBody}\n\n---\n\n${candidate.body}`,
        })
        return 'merge'
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
          // 先读取旧正文（合并用），再删除旧文件
          const existingBody = decision === 'merge'
            ? await this.storeService.readFile(entry.file_path).catch(() => '')
            : ''
          await this.storeService.deleteFile(entry.file_path)
          const meta = rowToMeta(entry, candidate)
          this.memoryRepo.update(entry.id, {
            description: candidate.description,
            file_path: this.storeService.getFilePath(candidate.scope, scopeRef, entry.id),
            confidence: Math.max(entry.confidence, candidate.confidence),
          })
          await this.storeService.writeFile({
            meta,
            body: decision === 'merge' ? `${existingBody}\n\n---\n\n${candidate.body}` : candidate.body,
          })
          return 'merge'
        }
      }
    }

    return 'write'
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

    // 闸门 2：去重
    const dedupResult = await this.passDedupGate(candidate, scopeRef)
    if (dedupResult === 'skip') {
      log.debug(`Candidate skipped (dedup): ${candidate.name}`)
      return
    }
    if (dedupResult === 'merge') {
      log.debug(`Candidate merged (dedup): ${candidate.name}`)
      return
    }

    // 闸门 3：配额
    await this.enforceQuota(candidate.scope, scopeRef)

    // 写入
    const id = generateId(candidate.scope)
    const filePath = this.storeService.getFilePath(candidate.scope, scopeRef, id)

    const meta: MemoryFileMeta = {
      id,
      scope: candidate.scope,
      scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      confidence: candidate.confidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      hitCount: 0,
      lastHitAt: null,
      sourceSessionId: sessionId,
      links: candidate.links ?? [],
      archived: false,
    }

    await this.storeService.writeFile({ meta, body: candidate.body })

    this.memoryRepo.insert({
      id,
      scope: candidate.scope,
      scope_ref: scopeRef,
      type: candidate.type,
      name: candidate.name,
      description: candidate.description,
      file_path: filePath,
      confidence: candidate.confidence,
      hit_count: 0,
      last_hit_at: null,
      source_session_id: sessionId,
      archived: 0,
    })

    log.info(`Memory written: ${id} (${candidate.name}) [${candidate.scope}/${candidate.type}]`)
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
      log.warn(`LLM dedup decide failed, defaulting to skip: ${err instanceof Error ? err.message : String(err)}`)
      return 'skip'
    }
  }

  private resolveScopeRef(scope: string, payload: TurnPayload): string | null {
    switch (scope) {
      case 'user': return null
      case 'project': return payload.workspaceId
      case 'agent': return payload.agentId
      default: return null
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

  private async refreshIndex(scope: 'user' | 'project' | 'agent', scopeRef: string | null): Promise<void> {
    try {
      const entries = this.memoryRepo.listByScope(scope, scopeRef)
      await this.storeService.updateIndexFile(
        scope,
        scopeRef,
        entries.map((e) => ({ name: e.name, description: e.description, id: e.id })),
      )
    } catch (err) {
      log.warn(`refreshIndex failed for ${scope}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function generateId(scope: string): string {
  const prefix = SCOPE_PREFIX[scope] ?? 'mem'
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

function parseCandidates(raw: string): MemoryCandidate[] {
  try {
    // 尝试提取 JSON 部分（LLM 可能包裹在 ```json``` 中）
    let json = raw.trim()
    const jsonMatch = json.match(/\[[\s\S]*\]/)
    if (jsonMatch) json = jsonMatch[0]!

    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item: unknown): item is MemoryCandidate => {
      if (typeof item !== 'object' || item == null) return false
      const obj = item as Record<string, unknown>
      return (
        typeof obj.scope === 'string' &&
        typeof obj.type === 'string' &&
        typeof obj.name === 'string' &&
        typeof obj.description === 'string' &&
        typeof obj.body === 'string' &&
        typeof obj.confidence === 'number'
      )
    })
  } catch {
    log.debug(`Failed to parse LLM memory candidates: ${raw.slice(0, 200)}`)
    return []
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

function rowToMeta(row: MemoryEntryRow, candidate: MemoryCandidate): MemoryFileMeta {
  return {
    id: row.id,
    scope: row.scope,
    scopeRef: row.scope_ref,
    type: candidate.type,
    name: row.name,
    description: candidate.description,
    confidence: Math.max(row.confidence, candidate.confidence),
    createdAt: row.created_at,
    updatedAt: Date.now(),
    hitCount: row.hit_count,
    lastHitAt: row.last_hit_at,
    sourceSessionId: row.source_session_id,
    links: candidate.links ?? [],
    archived: false,
  }
}

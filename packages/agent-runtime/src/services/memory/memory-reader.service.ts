/**
 * @module memory-reader.service
 *
 * 记忆读取服务 — 会话开始时组装 memory block 注入 system prompt
 *
 * 职责：
 *   - 并行查询三层记忆（user / project / agent）
 *   - 按 token 预算裁剪（优先级：feedback > user > project > reference）
 *   - 拼装 XML 结构化 block
 *   - recall_memory 工具实现：读取完整 markdown + bumpHit
 *
 * 依赖：
 *   - MemoryRepository (SQLite 查询)
 *   - MemoryStoreService (文件读取)
 *   - SettingsService (读取 memory 配置)
 */

import { MemoryRepository } from '@spark/storage'
import type { MemoryEntryRow, MemoryScopeFilter } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { MemoryStoreService } from './memory-store.service.js'
import type { MemorySearchService } from './memory-search.service.js'

const log = createLogger('memory:reader')

/** 默认注入 token 上限 */
const DEFAULT_MAX_INJECT_TOKENS = 4000

/** 类型优先级（数值越小优先级越高） */
const TYPE_PRIORITY: Record<string, number> = {
  feedback: 0,
  user: 1,
  project: 2,
  reference: 3,
}

export interface MemoryInjection {
  /** 拼好的 XML 字符串，直接拼入 system prompt */
  block: string
  /** 本次注入的记忆 id 列表 */
  injectedIds: string[]
  /** 因 token 预算被裁掉的数量 */
  droppedCount: number
}

export class MemoryReaderService {
  constructor(
    private readonly memoryRepo: MemoryRepository,
    private readonly storeService: MemoryStoreService,
    private readonly settingsGet: (category: string, key: string) => unknown | null,
    /**
     * V2 检索服务（可选）。提供时，会话注入改为：
     *   - feedback 类型始终全量注入（行为守则不靠召回）
     *   - 其余类型按 seedQuery 做混合检索取相关子集
     * 为 null/未提供时退回 V1 行为（全量 + type 优先级裁剪）。
     */
    private readonly searchService: MemorySearchService | null = null,
  ) {}

  /**
   * 为一次会话加载三层记忆并拼装注入 block
   *
   * @param input.seedQuery 会话种子查询（agent 名 + 描述 + workspace 名 + 近期摘要），
   *   用于驱动非 feedback 记忆的相关性检索；为空时非 feedback 走 V1 优先级排序。
   */
  async loadForSession(input: {
    workspaceId: string
    agentId: string
    seedQuery?: string
  }): Promise<MemoryInjection> {
    // 检查是否启用
    const enabled = this.settingsGet('memory', 'enabled')
    if (enabled === false || enabled === 0) {
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    const scopes = this.buildScopes(input.workspaceId, input.agentId)

    // feedback 始终全量注入（直接从 DB 取，绝不依赖召回——行为守则不能靠运气）
    const feedbackEntries = scopes.flatMap((s) =>
      this.memoryRepo.listByScope(s.scope, s.scopeRef, { type: 'feedback' }),
    )
    // feedback 内部按 hit_count desc → updated_at desc（高频守则靠前）
    feedbackEntries.sort((a, b) => b.hit_count - a.hit_count || b.updated_at - a.updated_at)

    // 非 feedback：优先 seed 检索取相关子集；不可用/无结果回退 V1 全量优先级排序
    // （搜索只在找到东西时改善选择，找不到时退回 V1，保证绝不比 V1 差）
    let otherEntries: MemoryEntryRow[]
    let searchUsed = false
    const seed = input.seedQuery?.trim()
    if (this.searchService != null && seed != null && seed.length > 0) {
      try {
        const hits = await this.searchService.search(seed, { scopes, limit: 30 })
        if (hits != null && hits.length > 0) {
          const feedbackIds = new Set(feedbackEntries.map((e) => e.id))
          otherEntries = hits
            .map((h) => h.entry)
            .filter((e) => !feedbackIds.has(e.id))
          searchUsed = true
        } else {
          otherEntries = this.loadOthersFallback(scopes)
        }
      } catch (err) {
        log.warn(
          `memory seed search failed, falling back to V1 priority sort: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        otherEntries = this.loadOthersFallback(scopes)
      }
    } else {
      otherEntries = this.loadOthersFallback(scopes)
    }

    if (!searchUsed) {
      otherEntries.sort(byV1Priority)
    }

    const allEntries = [...feedbackEntries, ...otherEntries]
    if (allEntries.length === 0) {
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    // token 裁剪（feedback 在前，预算优先分给 feedback，余量给检索/优先级排序后的非 feedback）
    const maxTokens = this.getMaxInjectTokens()
    const { selected, droppedCount } = trimToTokenBudget(allEntries, maxTokens)

    const block = renderMemoryBlock(selected, input.workspaceId)
    const injectedIds = selected.map((e) => e.id)

    log.debug(
      `Memory injection: ${injectedIds.length} entries (feedback=${feedbackEntries.length}, search=${searchUsed}), ${droppedCount} dropped`,
    )
    return { block, injectedIds, droppedCount }
  }

  /**
   * 构建本次会话的三层 scope 过滤器（跳过空 scopeRef 的层）。
   */
  private buildScopes(workspaceId: string, agentId: string): MemoryScopeFilter[] {
    const scopes: MemoryScopeFilter[] = [{ scope: 'user', scopeRef: null }]
    if (workspaceId) scopes.push({ scope: 'project', scopeRef: workspaceId })
    if (agentId) scopes.push({ scope: 'agent', scopeRef: agentId })
    return scopes
  }

  /**
   * V1 回退：加载三层全部非 feedback 条目（后续由调用方按 byV1Priority 排序）。
   */
  private loadOthersFallback(scopes: MemoryScopeFilter[]): MemoryEntryRow[] {
    return scopes
      .flatMap((s) => this.memoryRepo.listByScope(s.scope, s.scopeRef))
      .filter((e) => e.type !== 'feedback')
  }

  /**
   * recall_memory 工具实现：读取完整 markdown 正文 + bumpHit
   */
  async recall(id: string): Promise<{ content: string; error?: string }> {
    const entry = this.memoryRepo.getById(id)
    if (entry == null) {
      return { content: '', error: `Memory not found: ${id}` }
    }
    if (entry.archived === 1) {
      return { content: '', error: `Memory archived: ${id}` }
    }

    try {
      const markdown = await this.storeService.readFile(entry.file_path)
      // bumpHit
      this.memoryRepo.bumpHit(id)
      return { content: markdown }
    } catch (err) {
      log.warn(`recall failed for ${id}: ${err instanceof Error ? err.message : String(err)}`)
      return { content: '', error: `Failed to read memory file: ${id}` }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private getMaxInjectTokens(): number {
    const val = this.settingsGet('memory', 'maxInjectTokens')
    if (typeof val === 'number' && val > 0) return val
    return DEFAULT_MAX_INJECT_TOKENS
  }
}

// ─── Block Rendering ────────────────────────────────────────────────────

function renderMemoryBlock(entries: MemoryEntryRow[], workspaceId: string): string {
  if (entries.length === 0) return ''

  const userEntries = entries.filter((e) => e.scope === 'user')
  const projectEntries = entries.filter((e) => e.scope === 'project')
  const agentEntries = entries.filter((e) => e.scope === 'agent')

  const sections: string[] = []

  if (userEntries.length > 0) {
    sections.push('<user-memory>')
    for (const e of userEntries) {
      sections.push(`- [${e.id}] ${e.name} (${e.type}): ${e.description}`)
    }
    sections.push('</user-memory>')
  }

  if (projectEntries.length > 0) {
    sections.push(`<project-memory workspace="${workspaceId}">`)
    for (const e of projectEntries) {
      sections.push(`- [${e.id}] ${e.name} (${e.type}): ${e.description}`)
    }
    sections.push('</project-memory>')
  }

  if (agentEntries.length > 0) {
    sections.push('<agent-memory>')
    for (const e of agentEntries) {
      sections.push(`- [${e.id}] ${e.name} (${e.type}): ${e.description}`)
    }
    sections.push('</agent-memory>')
  }

  if (sections.length === 0) return ''

  return [
    '# Long-term Memory',
    '',
    sections.join('\n'),
    '',
    '需要查看某条记忆的完整正文（含 Why / How to apply），使用 recall_memory 工具，传入方括号内的 id。',
  ].join('\n')
}

// ─── V1 Priority Comparator ─────────────────────────────────────────────

/**
 * V1 优先级排序：type 优先级（feedback>user>project>reference）→ hit_count desc → updated_at desc。
 * 仅用于 searchService 不可用 / 无 seed / 搜索无结果时的非 feedback 回退路径。
 */
function byV1Priority(a: MemoryEntryRow, b: MemoryEntryRow): number {
  const pa = TYPE_PRIORITY[a.type] ?? 99
  const pb = TYPE_PRIORITY[b.type] ?? 99
  if (pa !== pb) return pa - pb
  if (a.hit_count !== b.hit_count) return b.hit_count - a.hit_count
  return b.updated_at - a.updated_at
}

// ─── Token Budget ───────────────────────────────────────────────────────

/**
 * 按 token 预算裁剪记忆列表
 *
 * 估算：1 字 ≈ 1.5 token（英文偏少，中文偏多，取保守上限）
 */
function trimToTokenBudget(
  entries: MemoryEntryRow[],
  maxTokens: number,
): { selected: MemoryEntryRow[]; droppedCount: number } {
  let usedTokens = 0
  const selected: MemoryEntryRow[] = []

  for (const entry of entries) {
    // 估算：description 字符数 × 1.5 + 固定开销
    const estimatedTokens = Math.ceil(entry.description.length * 1.5) + 20
    if (usedTokens + estimatedTokens > maxTokens) {
      // 预算已满，后续全部丢弃
      break
    }
    usedTokens += estimatedTokens
    selected.push(entry)
  }

  const droppedCount = entries.length - selected.length
  return { selected, droppedCount }
}

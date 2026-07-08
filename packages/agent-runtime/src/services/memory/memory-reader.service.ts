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
    // 【全流程日志·入口】让"注入是否发生"在默认日志级别可见。用户实测"从没看到 memory:reader
    // 日志"，需区分：enabled 禁用 / 三层 scope 空 / 注入 0 条 / 注入 N 条 四种情况。
    log.info(
      `【记忆注入】开始加载：workspaceId=${input.workspaceId || '(无)'} ` +
      `agentId=${input.agentId || '(无)'} seedQuery=${input.seedQuery?.length ?? 0}字符`,
    )
    // 检查是否启用
    const enabled = this.settingsGet('memory', 'enabled')
    if (enabled === false || enabled === 0) {
      log.info('【记忆注入】memory.enabled=false，跳过注入')
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    const scopes = this.buildScopes(input.workspaceId, input.agentId)
    log.info(
      `【记忆注入】scope 集合：` +
      scopes.map((s) => `${s.scope}/${s.scopeRef ?? 'global'}`).join(' | ') || '（空）',
    )

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
      // 显式 info：让"scope 内无记忆"可见（区别于"禁用"和"注入成功"）
      log.info('【记忆注入】三层 scope 内无有效记忆，不注入（检查记忆是否写入到匹配的 scope/scopeRef）')
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    // token 裁剪（feedback 在前，预算优先分给 feedback，余量给检索/优先级排序后的非 feedback）
    const maxTokens = this.getMaxInjectTokens()
    const { selected, droppedCount } = trimToTokenBudget(allEntries, maxTokens)

    const block = renderMemoryBlock(selected, input.workspaceId)
    const injectedIds = selected.map((e) => e.id)

    // 【全流程日志·结果】提级到 info：让"注入了 N 条"在默认日志级别可见。
    // droppedCount>0 额外 warn 提示预算压力。
    const summary = `【记忆注入】完成：注入 ${injectedIds.length} 条（feedback=${feedbackEntries.length}, search=${searchUsed}, dropped=${droppedCount}）`
    log.info(summary)
    if (droppedCount > 0) {
      log.warn('  ⚠ 预算压力：有记忆被裁剪掉，考虑调大 maxInjectTokens 或精简 feedback 记忆')
    }
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
   *
   * 若条目已失效（invalid_at 非空，bi-temporal），正文前会插入醒目标注，
   * 但仍返回正文（供 agent 理解历史演变）；superseded_by 非空时一并提示被哪条取代。
   */
  async recall(id: string): Promise<{ content: string; error?: string }> {
    // recall_memory 工具调用日志：让"agent 是否真调了 recall"可见，对应 hitCount 增长。
    // 没这条日志时，用户只能从面板 hitCount 反推，无法从日志确认调用链。
    const entry = this.memoryRepo.getById(id)
    if (entry == null) {
      log.info(`【recall_memory】未命中：id=${id}（可能已删除或 id 错误）`)
      return { content: '', error: `Memory not found: ${id}` }
    }
    if (entry.archived === 1) {
      log.info(`【recall_memory】已归档拒绝：id=${id} (${entry.name})`)
      return { content: '', error: `Memory archived: ${id}` }
    }
    log.info(`【recall_memory】命中读取：id=${id} (${entry.name}) [${entry.scope}/${entry.type}] → hitCount+1`)

    try {
      const markdown = await this.storeService.readFile(entry.file_path)
      // bumpHit
      this.memoryRepo.bumpHit(id)

      // 失效标注（bi-temporal）：仍返回正文，但前置警示
      if (entry.invalid_at != null) {
        const when = new Date(entry.invalid_at).toISOString()
        const superseded = entry.superseded_by != null ? `，已被 [${entry.superseded_by}] 取代` : ''
        return {
          content: `> ⚠️ 此记忆已于 ${when} 失效${superseded}。仅作历史参考，决策时请以取代条目或最新事实为准。\n\n${markdown}`,
        }
      }
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
  // name/description 来自 LLM 抽取，可能含 < > 破坏 <user-memory> 等结构标签
  // （误导 LLM 把内容当成新的 memory 区段边界）。轻量转义尖括号。
  const line = (e: MemoryEntryRow): string =>
    `- [${e.id}] ${sanitizeInline(e.name)} (${e.type}): ${sanitizeInline(e.description)}`

  if (userEntries.length > 0) {
    sections.push('<user-memory>')
    for (const e of userEntries) sections.push(line(e))
    sections.push('</user-memory>')
  }

  if (projectEntries.length > 0) {
    sections.push(`<project-memory workspace="${sanitizeInline(workspaceId)}">`)
    for (const e of projectEntries) sections.push(line(e))
    sections.push('</project-memory>')
  }

  if (agentEntries.length > 0) {
    sections.push('<agent-memory>')
    for (const e of agentEntries) sections.push(line(e))
    sections.push('</agent-memory>')
  }

  if (sections.length === 0) return ''

  return [
    '# Long-term Memory',
    '',
    sections.join('\n'),
    '',
    '上面的摘要只展示与当前会话最相关的子集（受 token 预算裁剪）。',
    '需要更多记忆时用 search_memory 按语义/关键词检索；',
    '需要某条的完整正文（含 Why / How to apply）用 recall_memory，传入方括号内的 id。',
    '关于"记住某事"该写往哪里、如何向用户说明去向，见下方 [Memory Behavior] 段。',
  ].join('\n')
}

/**
 * 转义单行注入内容里的尖括号，避免记忆的 name/description 含 `<...>` 破坏
 * `<user-memory>` 等结构标签。仅处理 < >（换行已由单行拼接隐含约束）。
 */
function sanitizeInline(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›').replace(/[\r\n]+/g, ' ')
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

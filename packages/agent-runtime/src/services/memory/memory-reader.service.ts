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
import type { MemoryEntryRow } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { MemoryStoreService } from './memory-store.service.js'

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
  ) {}

  /**
   * 为一次会话加载三层记忆并拼装注入 block
   */
  async loadForSession(input: { workspaceId: string; agentId: string }): Promise<MemoryInjection> {
    // 检查是否启用
    const enabled = this.settingsGet('memory', 'enabled')
    if (enabled === false || enabled === 0) {
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    // 并行查询三层
    const [userEntries, projectEntries, agentEntries] = await Promise.all([
      Promise.resolve(this.memoryRepo.listByScope('user', null)),
      input.workspaceId
        ? Promise.resolve(this.memoryRepo.listByScope('project', input.workspaceId))
        : Promise.resolve([]),
      input.agentId
        ? Promise.resolve(this.memoryRepo.listByScope('agent', input.agentId))
        : Promise.resolve([]),
    ])

    const allEntries = [...userEntries, ...projectEntries, ...agentEntries]

    if (allEntries.length === 0) {
      return { block: '', injectedIds: [], droppedCount: 0 }
    }

    // 按 type 优先级 + hit_count / updated_at 排序
    const sorted = allEntries.sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 99
      const pb = TYPE_PRIORITY[b.type] ?? 99
      if (pa !== pb) return pa - pb
      // 同类型内：hit_count desc → updated_at desc
      if (a.hit_count !== b.hit_count) return b.hit_count - a.hit_count
      return b.updated_at - a.updated_at
    })

    // token 裁剪
    const maxTokens = this.getMaxInjectTokens()
    const { selected, droppedCount } = trimToTokenBudget(sorted, maxTokens)

    // 拼 XML block
    const block = renderMemoryBlock(selected, input.workspaceId)
    const injectedIds = selected.map((e) => e.id)

    log.debug(`Memory injection: ${injectedIds.length} entries, ${droppedCount} dropped`)
    return { block, injectedIds, droppedCount }
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

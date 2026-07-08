import { randomUUID } from 'node:crypto'
import type { RuleItem, RuleScope } from '@spark/protocol'
import { RulesRepository } from '@spark/storage'
import type { RuleRow } from '@spark/storage'

export interface ListRulesParams {
  scope?: RuleScope
  scopeRef?: string
}

export interface CreateRuleParams {
  scope: RuleScope
  scopeRef?: string
  name: string
  content: string
  priority?: number
  enabled?: boolean
}

export interface UpdateRuleFields {
  name?: string
  content?: string
  priority?: number
  enabled?: boolean
}

const SYSTEM_SEED_RULES: Array<Omit<CreateRuleParams, 'scope'>> = [
  {
    name: '安全约束',
    content: '不要执行可能损坏系统、删除用户数据或泄露密钥的命令。高风险操作必须先请求用户确认。',
    priority: 100,
  },
  {
    name: '代码风格',
    content: '使用 TypeScript strict 模式，优先遵循仓库现有风格，并为高风险改动补充聚焦测试。',
    priority: 50,
  },
]

export class RulesService {
  constructor(private readonly repo: RulesRepository) {
    this.seedSystemRulesIfEmpty()
  }

  list(filters: ListRulesParams = {}): RuleItem[] {
    this.seedSystemRulesIfEmpty()
    return this.repo.list(filters).map(rowToRuleItem)
  }

  create(params: CreateRuleParams): RuleItem {
    const row = this.repo.create({
      id: randomUUID(),
      scope: params.scope,
      ...(params.scopeRef !== undefined && { scopeRef: params.scopeRef }),
      name: params.name,
      content: params.content,
      priority: params.priority ?? 0,
      enabled: params.enabled ?? true,
    })
    return rowToRuleItem(row)
  }

  update(id: string, fields: UpdateRuleFields): RuleItem {
    const existing = this.repo.getById(id)
    if (existing == null) throw new Error(`Rule not found: ${id}`)

    if (existing.scope === 'system' && hasSystemReadonlyFields(fields)) {
      throw new Error('System rules can only be enabled or disabled')
    }

    const updated = this.repo.update(id, fields)
    if (updated == null) throw new Error(`Rule not found: ${id}`)
    return rowToRuleItem(updated)
  }

  delete(id: string): boolean {
    const existing = this.repo.getById(id)
    if (existing == null) throw new Error(`Rule not found: ${id}`)
    if (existing.scope === 'system') {
      throw new Error('System rules cannot be deleted')
    }
    return this.repo.delete(id)
  }

  toggle(id: string, enabled: boolean): RuleItem {
    const updated = this.repo.toggle(id, enabled)
    if (updated == null) throw new Error(`Rule not found: ${id}`)
    return rowToRuleItem(updated)
  }

  private seedSystemRulesIfEmpty(): void {
    if (this.repo.hasAny()) return

    for (const rule of SYSTEM_SEED_RULES) {
      this.repo.create({
        id: randomUUID(),
        scope: 'system',
        name: rule.name,
        content: rule.content,
        ...(rule.priority !== undefined && { priority: rule.priority }),
        enabled: true,
      })
    }
  }
}

function hasSystemReadonlyFields(fields: UpdateRuleFields): boolean {
  return fields.name !== undefined || fields.content !== undefined || fields.priority !== undefined
}

function rowToRuleItem(row: RuleRow): RuleItem {
  return {
    id: row.id,
    scope: row.scope as RuleScope,
    scopeRef: row.scope_ref,
    name: row.name,
    content: row.content,
    priority: row.priority,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RulesService } from '../../services/rules.service.js'

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    scope: 'user',
    scope_ref: null,
    name: 'Rule',
    content: 'Content',
    priority: 0,
    enabled: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeRepo(hasAny = true) {
  const rows = new Map<string, ReturnType<typeof makeRow>>()

  return {
    rows,
    hasAny: vi.fn(() => hasAny || rows.size > 0),
    list: vi.fn(() => [...rows.values()]),
    getById: vi.fn((id: string) => rows.get(id) ?? null),
    create: vi.fn((params) => {
      const row = makeRow({
        id: params.id,
        scope: params.scope,
        scope_ref: params.scopeRef ?? null,
        name: params.name,
        content: params.content,
        priority: params.priority ?? 0,
        enabled: (params.enabled ?? true) ? 1 : 0,
      })
      rows.set(row.id, row)
      return row
    }),
    update: vi.fn((id: string, fields) => {
      const existing = rows.get(id)
      if (existing == null) return null
      const updated = {
        ...existing,
        ...(fields.name !== undefined && { name: fields.name }),
        ...(fields.content !== undefined && { content: fields.content }),
        ...(fields.priority !== undefined && { priority: fields.priority }),
        ...(fields.enabled !== undefined && { enabled: fields.enabled ? 1 : 0 }),
      }
      rows.set(id, updated)
      return updated
    }),
    delete: vi.fn((id: string) => rows.delete(id)),
    toggle: vi.fn((id: string, enabled: boolean) => {
      const existing = rows.get(id)
      if (existing == null) return null
      const updated = { ...existing, enabled: enabled ? 1 : 0 }
      rows.set(id, updated)
      return updated
    }),
  }
}

describe('RulesService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds default system rules when repository is empty', () => {
    const repo = makeRepo(false)
    const service = new RulesService(repo as never)

    const rules = service.list()

    expect(repo.create).toHaveBeenCalledTimes(2)
    expect(rules).toHaveLength(2)
    expect(rules.every((rule) => rule.scope === 'system')).toBe(true)
  })

  it('creates user rules and maps boolean enabled fields', () => {
    const repo = makeRepo()
    const service = new RulesService(repo as never)

    const rule = service.create({
      scope: 'user',
      name: 'Style',
      content: 'Use concise Chinese.',
      priority: 20,
      enabled: false,
    })

    expect(rule.scope).toBe('user')
    expect(rule.enabled).toBe(false)
    expect(rule.priority).toBe(20)
  })

  it('allows system rule toggle but rejects content updates', () => {
    const repo = makeRepo()
    repo.rows.set('system-1', makeRow({ id: 'system-1', scope: 'system', enabled: 1 }))
    const service = new RulesService(repo as never)

    const toggled = service.update('system-1', { enabled: false })
    expect(toggled.enabled).toBe(false)

    expect(() => service.update('system-1', { content: 'Changed' })).toThrow('System rules can only be enabled or disabled')
  })

  it('rejects deleting system rules', () => {
    const repo = makeRepo()
    repo.rows.set('system-1', makeRow({ id: 'system-1', scope: 'system' }))
    const service = new RulesService(repo as never)

    expect(() => service.delete('system-1')).toThrow('System rules cannot be deleted')
    expect(repo.delete).not.toHaveBeenCalled()
  })
})

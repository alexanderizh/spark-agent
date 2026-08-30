import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModelService } from '../../services/model.service.js'

vi.mock('@spark/shared', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))

function makeRepo() {
  const rows = new Map<string, Record<string, unknown>>()
  let seq = 0
  const make = (params: Record<string, unknown>) => ({
    id: `model-${++seq}`,
    provider_id: params.providerId,
    name: params.name,
    config_json: params.configJson ?? '{}',
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return {
    ensureSchema: vi.fn(),
    list: vi.fn((filters?: { providerId?: string }) =>
      [...rows.values()].filter((r) => !filters?.providerId || r.provider_id === filters.providerId)
    ),
    getById: vi.fn((id: string) => rows.get(id) ?? null),
    findByProviderAndName: vi.fn((providerId: string, name: string) =>
      [...rows.values()].find((r) => r.provider_id === providerId && r.name === name) ?? null
    ),
    create: vi.fn((params) => { const r = make(params); rows.set(r.id, r); return r }),
    update: vi.fn((id: string, fields: Record<string, unknown>) => {
      const r = rows.get(id)
      if (!r) return null
      if (fields.name !== undefined) r.name = fields.name
      if (fields.configJson !== undefined) r.config_json = fields.configJson
      if (fields.enabled !== undefined) r.enabled = fields.enabled ? 1 : 0
      return r
    }),
    deleteById: vi.fn((id: string) => rows.delete(id)),
    hasModels: vi.fn(() => rows.size > 0),
    count: vi.fn(() => rows.size),
  }
}

describe('ModelService integration', () => {
  let repo: ReturnType<typeof makeRepo>
  let svc: ModelService

  beforeEach(() => {
    repo = makeRepo()
    svc = new ModelService(repo as never)
  })

  it('create → list returns the model', () => {
    svc.create({ providerId: 'p1', name: 'gpt-4o' })
    const list = svc.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('gpt-4o')
    expect(list[0]!.enabled).toBe(true)
  })

  it('list with providerId filter returns only matching models', () => {
    svc.create({ providerId: 'p1', name: 'gpt-4o' })
    svc.create({ providerId: 'p2', name: 'claude-3' })
    expect(svc.list({ providerId: 'p1' })).toHaveLength(1)
    expect(svc.list({ providerId: 'p2' })).toHaveLength(1)
  })

  it('update toggles enabled=false', () => {
    const m = svc.create({ providerId: 'p1', name: 'gpt-4o' })
    const updated = svc.update(m.id, { enabled: false })
    expect(updated.enabled).toBe(false)
  })

  it('update with unknown id throws', () => {
    expect(() => svc.update('no-such-id', { name: 'x' })).toThrow('Model not found')
  })

  it('delete removes the model', () => {
    const m = svc.create({ providerId: 'p1', name: 'gpt-4o' })
    expect(svc.delete(m.id)).toBe(true)
    expect(svc.list()).toHaveLength(0)
  })

  it('seedDefaultModels creates models for known providers', () => {
    svc.seedDefaultModels([
      { id: 'p1', provider: 'anthropic' },
      { id: 'p2', provider: 'openai' },
    ])
    expect(svc.list({ providerId: 'p1' })).toHaveLength(2) // claude-sonnet-4 + haiku
    expect(svc.list({ providerId: 'p2' })).toHaveLength(2) // gpt-4o + gpt-4o-mini
  })

  it('seedDefaultModels skips already-existing models', () => {
    svc.create({ providerId: 'p1', name: 'claude-sonnet-4-20250514' })
    svc.seedDefaultModels([{ id: 'p1', provider: 'anthropic' }])
    // only haiku added, sonnet already exists
    expect(svc.list({ providerId: 'p1' })).toHaveLength(2)
  })
})

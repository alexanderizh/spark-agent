import { describe, it, expect, beforeEach, vi } from 'vitest'
import { McpService } from '../../services/mcp-server.service.js'

vi.mock('@spark/shared', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))

function makeRepo() {
  const rows = new Map<string, Record<string, unknown>>()
  let seq = 0
  const make = (params: Record<string, unknown>) => ({
    id: params.id ?? `mcp-${++seq}`,
    scope: params.scope,
    name: params.name,
    config_json: params.configJson ?? '{}',
    enabled: params.enabled === false ? 0 : 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  return {
    listAll: vi.fn(() => [...rows.values()]),
    findByScope: vi.fn((scope: string) => [...rows.values()].filter((r) => r.scope === scope)),
    get: vi.fn((id: string) => rows.get(id) ?? undefined),
    create: vi.fn((params) => { const r = make(params); rows.set(r.id as string, r); return r }),
    update: vi.fn((id: string, fields: Record<string, unknown>) => {
      const r = rows.get(id)
      if (!r) return undefined
      if (fields.name !== undefined) r.name = fields.name
      if (fields.configJson !== undefined) r.config_json = fields.configJson
      if (fields.enabled !== undefined) r.enabled = fields.enabled ? 1 : 0
      r.updated_at = new Date().toISOString()
      return r
    }),
    deleteById: vi.fn((id: string) => { return rows.delete(id) }),
  }
}

describe('McpService integration', () => {
  let repo: ReturnType<typeof makeRepo>
  let svc: McpService

  beforeEach(() => {
    repo = makeRepo()
    svc = new McpService(repo as never)
  })

  it('createServer → listServers returns the new server', () => {
    svc.createServer({ scope: 'user', name: 'test-server', configJson: '{"type":"stdio","command":"npx"}' })
    const list = svc.listServers()
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('test-server')
    expect(list[0]!.enabled).toBe(true)
  })

  it('listServers with scope filter returns only matching servers', () => {
    svc.createServer({ scope: 'user', name: 'user-server', configJson: '{"type":"stdio","command":"npx"}' })
    svc.createServer({ scope: 'project', name: 'project-server', configJson: '{"type":"stdio","command":"npx"}' })
    expect(svc.listServers({ scope: 'user' })).toHaveLength(1)
    expect(svc.listServers({ scope: 'project' })).toHaveLength(1)
  })

  it('updateServer toggles enabled=false', () => {
    const created = svc.createServer({ scope: 'user', name: 'srv', configJson: '{"type":"stdio","command":"npx"}' })
    const updated = svc.updateServer(created.id, { enabled: false })
    expect(updated.enabled).toBe(false)
  })

  it('updateServer with unknown id throws', () => {
    expect(() => svc.updateServer('no-such-id', { name: 'x' })).toThrow('MCP server not found')
  })

  it('deleteServer removes the server', () => {
    const s = svc.createServer({ scope: 'user', name: 'to-delete', configJson: '{"type":"stdio","command":"npx"}' })
    expect(svc.deleteServer(s.id)).toBe(true)
    expect(svc.listServers()).toHaveLength(0)
  })

  it('full lifecycle: create → update → delete', () => {
    const s = svc.createServer({ scope: 'user', name: 'lifecycle', configJson: '{"type":"sse","url":"http://localhost"}' })
    expect(s.name).toBe('lifecycle')

    const updated = svc.updateServer(s.id, { name: 'lifecycle-renamed', configJson: '{"type":"sse","url":"http://remote"}' })
    expect(updated.name).toBe('lifecycle-renamed')

    svc.deleteServer(s.id)
    expect(svc.listServers()).toHaveLength(0)
  })
})

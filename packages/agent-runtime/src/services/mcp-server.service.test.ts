/**
 * McpService — managed scope protection tests
 *
 * Verifies that servers with scope = MANAGED_MCP_SCOPE ('managed') cannot be
 * deleted or renamed via the public API. Other operations (config update,
 * enable/disable, lifecycle) remain unaffected.
 *
 * Uses an in-memory mock repository to avoid the native better-sqlite3
 * dependency (which can have NODE_MODULE_VERSION mismatches in dev envs).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { McpService, MANAGED_MCP_SCOPE, PLAYWRIGHT_MCP_NAME } from './mcp-server.service.js'
import type { McpServerRepository, McpServerRow } from '@spark/storage'

const PLAYWRIGHT_CONFIG = JSON.stringify({
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest', '--browser', 'chromium'],
})

interface MockStore {
  rows: Map<string, McpServerRow>
}

function makeMockRepo(store: MockStore): McpServerRepository {
  return {
    listAll: () =>
      Array.from(store.rows.values()).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    get: (id: string) => store.rows.get(id),
    findByScope: (scope: string) =>
      Array.from(store.rows.values())
        .filter((r) => r.scope === scope)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    create: ({ scope, name, configJson, enabled }: { id?: string; scope: string; name: string; configJson: string; enabled?: boolean }) => {
      const id = `mock-${store.rows.size + 1}-${Date.now()}`
      const now = new Date().toISOString()
      const row: McpServerRow = {
        id,
        scope,
        name,
        config_json: configJson,
        enabled: enabled === false ? 0 : 1,
        created_at: now,
        updated_at: now,
      }
      store.rows.set(id, row)
      return row
    },
    update: (id: string, fields: Partial<{ name: string; configJson: string; enabled: boolean }>) => {
      const row = store.rows.get(id)
      if (row == null) return undefined
      const next: McpServerRow = {
        ...row,
        name: fields.name ?? row.name,
        config_json: fields.configJson ?? row.config_json,
        enabled:
          fields.enabled === undefined ? row.enabled : fields.enabled ? 1 : 0,
        updated_at: new Date().toISOString(),
      }
      store.rows.set(id, next)
      return next
    },
    deleteById: (id: string) => store.rows.delete(id),
  } as unknown as McpServerRepository
}

function makeRow(overrides: Partial<McpServerRow> & Pick<McpServerRow, 'scope' | 'name'>): McpServerRow {
  return {
    id: overrides.id ?? `row-${Math.random().toString(36).slice(2)}`,
    scope: overrides.scope,
    name: overrides.name,
    config_json: overrides.config_json ?? PLAYWRIGHT_CONFIG,
    enabled: overrides.enabled ?? 1,
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
  }
}

describe('McpService — managed scope protection', () => {
  let store: MockStore
  let repo: McpServerRepository
  let service: McpService

  beforeEach(() => {
    store = { rows: new Map() }
    repo = makeMockRepo(store)
    service = new McpService(repo)
  })

  it('exposes the managed scope constant', () => {
    expect(MANAGED_MCP_SCOPE).toBe('managed')
    expect(PLAYWRIGHT_MCP_NAME).toBe('playwright')
  })

  describe('deleteServer', () => {
    it('allows deleting a user-scope server', () => {
      const user = store.rows.size > 0
        ? Array.from(store.rows.values())[0]
        : (() => {
            const row = makeRow({ scope: 'user', name: 'custom' })
            store.rows.set(row.id, row)
            return row
          })()
      void user // ensure row exists

      const userId = 'user-1'
      const userRow = makeRow({ id: userId, scope: 'user', name: 'custom' })
      store.rows.set(userId, userRow)

      expect(service.deleteServer(userId)).toBe(true)
      expect(store.rows.has(userId)).toBe(false)
    })

    it('throws when attempting to delete a managed server', () => {
      const managedId = 'managed-1'
      const managedRow = makeRow({
        id: managedId,
        scope: MANAGED_MCP_SCOPE,
        name: PLAYWRIGHT_MCP_NAME,
      })
      store.rows.set(managedId, managedRow)

      expect(() => service.deleteServer(managedId)).toThrow(/managed MCP server/)
      // Row must still exist
      expect(store.rows.has(managedId)).toBe(true)
    })

    it('returns false when deleting a non-existent id', () => {
      expect(service.deleteServer('nonexistent-id')).toBe(false)
    })
  })

  describe('updateServer', () => {
    it('allows config update on a managed server', () => {
      const managedId = 'managed-1'
      store.rows.set(
        managedId,
        makeRow({ id: managedId, scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME }),
      )
      const newConfig = JSON.stringify({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--headless'],
      })
      const updated = service.updateServer(managedId, { configJson: newConfig })
      expect(updated.configJson).toBe(newConfig)
    })

    it('allows toggling enabled on a managed server', () => {
      const managedId = 'managed-1'
      store.rows.set(
        managedId,
        makeRow({ id: managedId, scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME, enabled: 1 }),
      )
      const disabled = service.updateServer(managedId, { enabled: false })
      expect(disabled.enabled).toBe(false)

      const reEnabled = service.updateServer(managedId, { enabled: true })
      expect(reEnabled.enabled).toBe(true)
    })

    it('throws when attempting to rename a managed server', () => {
      const managedId = 'managed-1'
      store.rows.set(
        managedId,
        makeRow({ id: managedId, scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME }),
      )
      expect(() =>
        service.updateServer(managedId, { name: 'different-name' }),
      ).toThrow(/Cannot rename managed MCP server/)
    })

    it('allows same-name "rename" (idempotent) on managed server', () => {
      const managedId = 'managed-1'
      store.rows.set(
        managedId,
        makeRow({ id: managedId, scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME }),
      )
      expect(() =>
        service.updateServer(managedId, { name: PLAYWRIGHT_MCP_NAME }),
      ).not.toThrow()
    })

    it('allows renaming a user-scope server', () => {
      const userId = 'user-1'
      store.rows.set(userId, makeRow({ id: userId, scope: 'user', name: 'old-name' }))
      const updated = service.updateServer(userId, { name: 'new-name' })
      expect(updated.name).toBe('new-name')
    })

    it('throws when updating a non-existent server', () => {
      expect(() =>
        service.updateServer('nonexistent-id', { enabled: false }),
      ).toThrow(/not found/)
    })
  })

  describe('listServers', () => {
    it('includes managed servers in unfiltered listing', () => {
      store.rows.set(
        'm1',
        makeRow({ id: 'm1', scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME }),
      )
      store.rows.set('u1', makeRow({ id: 'u1', scope: 'user', name: 'custom' }))
      const all = service.listServers()
      expect(all).toHaveLength(2)
      expect(all.map((s) => s.scope)).toEqual(
        expect.arrayContaining(['managed', 'user']),
      )
    })

    it('filters by managed scope', () => {
      store.rows.set(
        'm1',
        makeRow({ id: 'm1', scope: MANAGED_MCP_SCOPE, name: PLAYWRIGHT_MCP_NAME }),
      )
      store.rows.set('u1', makeRow({ id: 'u1', scope: 'user', name: 'custom' }))
      const managedOnly = service.listServers({ scope: MANAGED_MCP_SCOPE })
      expect(managedOnly).toHaveLength(1)
      expect(managedOnly[0]?.name).toBe(PLAYWRIGHT_MCP_NAME)
    })
  })
})

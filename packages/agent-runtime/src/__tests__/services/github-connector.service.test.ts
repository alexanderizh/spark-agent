import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubConnectorService } from '../../services/github-connector.service.js'

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (scope: string, id: string) => `${scope}:${id}`,
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  deleteSecret: vi.fn(),
}))

type StoredRow = {
  id: string
  provider: string
  name: string
  auth_method: string
  status: string
  enabled: number
  config_json: string
  keystore_ref: string | null
  granted_scopes_json: string
  account_json: string | null
  last_sync_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function createRepo() {
  const rows = new Map<string, StoredRow>()

  const getByProvider = (provider: string): StoredRow | null =>
    [...rows.values()].find((row) => row.provider === provider) ?? null

  return {
    create(params: {
      id: string
      provider: string
      name: string
      authMethod: string
      status: string
      enabled?: boolean
      config: Record<string, unknown>
      keystoreRef?: string | null
      grantedScopes?: string[]
      account?: Record<string, unknown> | null
      lastSyncAt?: string | null
      lastError?: string | null
    }) {
      const now = new Date().toISOString()
      const row: StoredRow = {
        id: params.id,
        provider: params.provider,
        name: params.name,
        auth_method: params.authMethod,
        status: params.status,
        enabled: params.enabled === false ? 0 : 1,
        config_json: JSON.stringify(params.config),
        keystore_ref: params.keystoreRef ?? null,
        granted_scopes_json: JSON.stringify(params.grantedScopes ?? []),
        account_json: params.account != null ? JSON.stringify(params.account) : null,
        last_sync_at: params.lastSyncAt ?? null,
        last_error: params.lastError ?? null,
        created_at: now,
        updated_at: now,
      }
      rows.set(row.id, row)
      return row
    },
    getByProvider,
    update(
      id: string,
      fields: {
        name?: string
        authMethod?: string
        status?: string
        enabled?: boolean
        config?: Record<string, unknown>
        keystoreRef?: string | null
        grantedScopes?: string[]
        account?: Record<string, unknown> | null
        lastSyncAt?: string | null
        lastError?: string | null
      },
    ) {
      const current = rows.get(id)
      if (!current) return null
      const next: StoredRow = {
        ...current,
        ...(fields.name !== undefined ? { name: fields.name } : {}),
        ...(fields.authMethod !== undefined ? { auth_method: fields.authMethod } : {}),
        ...(fields.status !== undefined ? { status: fields.status } : {}),
        ...(fields.enabled !== undefined ? { enabled: fields.enabled ? 1 : 0 } : {}),
        ...(fields.config !== undefined ? { config_json: JSON.stringify(fields.config) } : {}),
        ...(fields.keystoreRef !== undefined ? { keystore_ref: fields.keystoreRef } : {}),
        ...(fields.grantedScopes !== undefined
          ? { granted_scopes_json: JSON.stringify(fields.grantedScopes) }
          : {}),
        ...(fields.account !== undefined
          ? { account_json: fields.account != null ? JSON.stringify(fields.account) : null }
          : {}),
        ...(fields.lastSyncAt !== undefined ? { last_sync_at: fields.lastSyncAt } : {}),
        ...(fields.lastError !== undefined ? { last_error: fields.lastError } : {}),
        updated_at: new Date().toISOString(),
      }
      rows.set(id, next)
      return next
    },
    delete(id: string) {
      return rows.delete(id)
    },
  }
}

describe('GitHubConnectorService', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, login: 'octocat', avatar_url: 'https://example.com/a.png' }),
      headers: new Headers({ 'x-oauth-scopes': 'repo, read:user' }),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('normalizes URL-based repo scopes and preserves disabled mcp_tools capability', async () => {
    const repo = createRepo()
    const service = new GitHubConnectorService(repo as never)

    const connection = await service.connect({
      token: 'github_pat_test',
      selectedRepos: [
        'https://github.com/OpenAI/Codex/',
        'owner/repo.git',
        'OWNER/repo/',
      ],
      enabledCapabilities: ['repositories'],
      allowWrites: false,
    })

    expect(connection.config.selectedRepos).toEqual(['openai/codex', 'owner/repo'])
    expect(connection.config.enabledCapabilities).toEqual(['repositories'])
    expect(service.getStatusForTools().mcpToolsEnabled).toBe(false)
  })
})

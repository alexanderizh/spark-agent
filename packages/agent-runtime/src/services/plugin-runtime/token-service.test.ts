import { describe, expect, it } from 'vitest'
import { RuntimeTokenService, type RuntimeSecretStore } from './token-service.js'

describe('RuntimeTokenService', () => {
  it('refreshes an expiring credential once for concurrent callers and persists rotation', async () => {
    const values = new Map<string, string>()
    const store: RuntimeSecretStore = {
      get: async (ref) => values.get(ref) ?? null,
      set: async (ref, value) => {
        values.set(ref, value)
      },
      delete: async (ref) => values.delete(ref),
    }
    const service = new RuntimeTokenService(store)
    const ref = service.createRef('spark.google', 'google', 'account-1')
    await service.save(ref, {
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: new Date(Date.now() + 1_000).toISOString(),
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    let refreshCount = 0
    const refresh = async () => {
      refreshCount += 1
      await Promise.resolve()
      return {
        accessToken: 'new-access',
        refreshToken: 'rotated-refresh',
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      }
    }
    const results = await Promise.all([
      service.withAccessToken(ref, async (token) => token, refresh),
      service.withAccessToken(ref, async (token) => token, refresh),
    ])

    expect(results).toEqual(['new-access', 'new-access'])
    expect(refreshCount).toBe(1)
    await expect(service.read(ref)).resolves.toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'rotated-refresh',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })
  })

  it('does not attempt refresh without a refresh token', async () => {
    const service = new RuntimeTokenService({
      get: async () =>
        JSON.stringify({
          accessToken: 'old-access',
          expiresAt: new Date(Date.now() - 1_000).toISOString(),
        }),
      set: async () => undefined,
      delete: async () => true,
    })
    const ref = service.createRef('spark.test', 'test', 'account')
    await expect(service.withAccessToken(ref, async (token) => token)).rejects.toMatchObject({
      code: 'AUTH_EXPIRED',
    })
  })

  it('migrates legacy plain-text connector tokens in the keystore on first authorized read', async () => {
    const values = new Map<string, string>([['legacy/github', 'github_pat_legacy-fixture']])
    const service = new RuntimeTokenService({
      get: async (ref) => values.get(ref) ?? null,
      set: async (ref, value) => {
        values.set(ref, value)
      },
      delete: async (ref) => values.delete(ref),
    })

    await expect(
      service.withAccessToken('legacy/github', async (token) => token, undefined, {
        allowLegacyPlainText: true,
      }),
    ).resolves.toBe('github_pat_legacy-fixture')
    expect(values.get('legacy/github')).toBe(
      JSON.stringify({ accessToken: 'github_pat_legacy-fixture', tokenType: 'Bearer' }),
    )
    await expect(service.read('legacy/github')).resolves.toMatchObject({
      accessToken: 'github_pat_legacy-fixture',
    })
  })
})
